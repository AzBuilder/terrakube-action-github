import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fetch, MockAgent} from 'undici'
import {TerrakubeClient} from '../src/terrakube'
import {Credentials} from '../src/auth'
import {config, item, job, sha} from './helpers'

function setup(overrides = {}) {
  const settings = config(overrides)
  const agent = new MockAgent()
  agent.disableNetConnect()
  const client = new TerrakubeClient(
    settings,
    new Credentials(settings),
    (url, options) => fetch(url, {...options, dispatcher: agent}),
    async () => {}
  )
  const pool = agent.get(new URL(settings.endpoint).origin)
  return {
    client,
    pool,
    agent,
    close: async () => {
      await client.close()
      await agent.close()
    }
  }
}

test('saved-run mutations accept no-content responses and are never retried', async () => {
  const {client, pool, close, agent} = setup()
  pool
    .intercept({
      method: 'PATCH',
      path: '/api/v1/organization/org/job/42',
      body: JSON.stringify({
        data: {type: 'job', id: '42', attributes: {status: 'approved'}}
      })
    })
    .reply(204)
  pool
    .intercept({method: 'PATCH', path: '/api/v1/organization/org/job/43'})
    .reply(503)
  try {
    await client.transitionJob('org', '42', 'approved', Date.now() + 5000)
    await assert.rejects(
      client.transitionJob('org', '43', 'rejected', Date.now() + 5000),
      /HTTP 503/
    )
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})

test('quotes and encodes filter literals without query injection', async () => {
  const {client, pool, close} = setup()
  const name = "Plan's & apply=1"
  pool
    .intercept({
      path: (path: string) => {
        const url = new URL(path, config().endpoint)
        assert.equal(
          url.searchParams.get('filter[template]'),
          "name=='Plan\\'s & apply=1'"
        )
        assert.equal([...url.searchParams].length, 1)
        return true
      }
    })
    .reply(200, {data: [item('template', 'id', {name})]})
  try {
    assert.equal((await client.find('/templates', 'template', name))?.id, 'id')
  } finally {
    await close()
  }
})
test('retries eligible reads but rejects permanent API errors without leaking the body', async () => {
  const {client, pool, close} = setup()
  pool
    .intercept({path: '/templates?filter%5Btemplate%5D=name%3D%3D%27Plan%27'})
    .reply(503, 'private details')
    .times(2)
  pool
    .intercept({path: '/templates?filter%5Btemplate%5D=name%3D%3D%27Plan%27'})
    .reply(403, 'secret response')
  try {
    await assert.rejects(client.find('/templates', 'template', 'Plan'), {
      message: 'Terrakube GET returned HTTP 403'
    })
  } finally {
    await close()
  }
})
test('read retries are bounded', async () => {
  const {client, pool, close, agent} = setup()
  pool
    .intercept({path: '/x?filter%5Btemplate%5D=name%3D%3D%27Plan%27'})
    .reply(503)
    .times(3)
  try {
    await assert.rejects(client.find('/x', 'template', 'Plan'), /HTTP 503/)
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})
test('submits immutable revision separately from branch and does not retry POST', async () => {
  const {client, pool, close, agent} = setup()
  pool
    .intercept({
      method: 'POST',
      path: '/api/v1/organization/org/job',
      body: (body: string) => {
        const request = JSON.parse(body)
        assert.equal(request.data.attributes.commitId, sha)
        assert.equal(request.data.attributes.overrideBranch, 'feature')
        assert.equal(
          request.data.attributes.templateReference,
          'arbitrary-template'
        )
        return true
      }
    })
    .reply(503, 'unavailable')
  try {
    await assert.rejects(
      client.createJob('org', 'ws', 'arbitrary-template'),
      /HTTP 503/
    )
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})
for (const [name, data] of [
  [
    'ambiguous',
    {
      data: [
        item('template', '1', {name: 'Plan'}),
        item('template', '2', {name: 'Plan'})
      ]
    }
  ],
  ['API errors', {errors: [{detail: 'secret'}]}],
  ['malformed', {data: {id: '1'}}],
  ['invalid JSON', 'not json']
] as const) {
  test(`rejects ${name} responses`, async () => {
    const {client, pool, close} = setup()
    pool
      .intercept({path: '/x?filter%5Btemplate%5D=name%3D%3D%27Plan%27'})
      .reply(200, data)
    try {
      await assert.rejects(client.find('/x', 'template', 'Plan'))
    } finally {
      await close()
    }
  })
}
test('timeout covers delayed responses and preserves a bounded request', async () => {
  const {client, pool, close} = setup({requestTimeoutMs: 10})
  pool
    .intercept({path: '/x?filter%5Btemplate%5D=name%3D%3D%27Plan%27'})
    .reply(200, {data: []})
    .delay(100)
  try {
    await assert.rejects(client.find('/x', 'template', 'Plan'), /timed out/)
  } finally {
    await close()
  }
})
test('polling respects an already-exhausted deadline', async () => {
  const {client, close} = setup()
  try {
    await assert.rejects(client.job('org', 'id', Date.now() - 1), /deadline/)
  } finally {
    await close()
  }
})
test('rejects non-log URLs and does not follow credential-bearing redirects', async () => {
  const {client, pool, close} = setup()
  pool
    .intercept({path: '/tfoutput/v1/organization/org/job/1/step/step-1'})
    .reply(302, '', {headers: {location: 'https://untrusted.example/log'}})
    .times(3)
  try {
    await assert.rejects(
      client.logs('https://untrusted.example/log'),
      /Invalid Terrakube log path/
    )
    await assert.rejects(
      client.logs(
        'https://terrakube.example/tfoutput/v1/organization/org/job/1/step/step-1'
      ),
      /connection failed/
    )
  } finally {
    await close()
  }
})
test('job reads require included step results and return only this job’s steps', async () => {
  const {client, pool, close} = setup()
  const document = job('completed')
  document.included?.push(
    item('organization', 'other', {}),
    item('step', 'unrelated', {status: 'failed'})
  )
  pool
    .intercept({path: '/api/v1/organization/org/job/job-1?include=step'})
    .reply(200, document)
  try {
    assert.equal(
      (await client.job('org', 'job-1', Date.now() + 1000)).included?.length,
      1
    )
  } finally {
    await close()
  }
})
test('OIDC renewal also applies to log requests', async () => {
  let now = 1_000_000
  let issued = 0
  const settings = config({auth: 'oidc', token: '', audience: 'terrakube'})
  const credentials = new Credentials(
    settings,
    async () => {
      issued++
      return `header.${Buffer.from(JSON.stringify({exp: now / 1000 + 300})).toString('base64url')}.signature`
    },
    () => now
  )
  const agent = new MockAgent()
  agent.disableNetConnect()
  const client = new TerrakubeClient(settings, credentials, (url, options) =>
    fetch(url, {...options, dispatcher: agent})
  )
  agent
    .get(settings.endpoint)
    .intercept({path: '/tfoutput/v1/organization/org/job/1/step/step-1'})
    .reply(200, 'log')
    .times(2)
  try {
    await client.logs('/tfoutput/v1/organization/org/job/1/step/step-1')
    now += 241_000
    await client.logs('/tfoutput/v1/organization/org/job/1/step/step-1')
    assert.equal(issued, 2)
  } finally {
    await client.close()
    await agent.close()
  }
})

test('raw logs redact known PAT and GitHub credentials', async () => {
  const {client, pool, close} = setup({githubToken: 'github-test-token'})
  pool
    .intercept({path: '/tfoutput/v1/organization/org/job/1/step/step-1'})
    .reply(200, 'test-token github-test-token')
  try {
    assert.equal(
      await client.logs('/tfoutput/v1/organization/org/job/1/step/step-1'),
      '*** ***'
    )
  } finally {
    await close()
  }
})
test('oversized log responses are truncated and oversized API documents fail', async () => {
  const {client, pool, close} = setup()
  pool
    .intercept({path: '/tfoutput/v1/organization/org/job/1/step/step-1'})
    .reply(200, 'x'.repeat(200_000))
  pool
    .intercept({path: '/api/v1/organization/org/job/job-1?include=step'})
    .reply(200, 'x'.repeat(8_000_001))
  try {
    assert.match(
      await client.logs('/tfoutput/v1/organization/org/job/1/step/step-1'),
      /Log truncated/
    )
    await assert.rejects(
      client.job('org', 'job-1', Date.now() + 1000),
      /exceeded 8 MB/
    )
  } finally {
    await close()
  }
})

test('context requests use JSON while job requests use JSON:API', async () => {
  const {client, pool, close, agent} = setup()
  const context = {structuredOutputStatus: {state: 'PERSISTED'}}
  pool
    .intercept({path: '/context/v1/42', headers: {accept: 'application/json'}})
    .reply(200, context)
  pool
    .intercept({
      path: '/api/v1/organization/org/job/job-1?include=step',
      headers: {accept: 'application/vnd.api+json'}
    })
    .reply(200, job('completed'))
  try {
    assert.deepEqual(await client.context('42'), context)
    assert.equal(
      (await client.job('org', 'job-1', Date.now() + 1000)).data.id,
      'job-1'
    )
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})

for (const endpoint of [
  'https://terrakube.example',
  'https://terrakube.example/gateway'
]) {
  test(`canonical log URLs are routed through ${endpoint} with the correct path and media type`, async () => {
    const {client, pool, close, agent} = setup({endpoint})
    const route = '/tfoutput/v1/organization/org/job/42/step/step-1'
    const prefix = new URL(endpoint).pathname.replace(/\/$/, '')
    const outputs = [
      `https://public.example${route}?download=1`,
      `https://public.example/another-prefix${route}?download=1`,
      `${endpoint}${route}?download=1`,
      `${route}?download=1`,
      `${route.slice(1)}?download=1`
    ]
    pool
      .intercept({
        path: `${prefix}${route}?download=1`,
        headers: {
          authorization: 'Bearer test-token',
          accept: 'application/octet-stream'
        }
      })
      .reply(200, 'saved output')
      .times(outputs.length)
    try {
      for (const output of outputs)
        assert.equal(await client.logs(output), 'saved output')
      agent.assertNoPendingInterceptors()
    } finally {
      await close()
    }
  })
}

test('log URL parsing rejects non-log routes, credentials and traversal before making a request', async () => {
  const {client, close} = setup({endpoint: 'https://terrakube.example/gateway'})
  const route = '/tfoutput/v1/organization/org/job/42/step/step-1'
  try {
    for (const output of [
      'https://public.example/api/v1/organization',
      `https://user:secret@public.example${route}`,
      `file:///tmp${route}`,
      `${route}/../../other`,
      `${route}%2f..%2fother`,
      `${route}/stream`,
      `${route}#fragment`
    ])
      await assert.rejects(client.logs(output), /Invalid Terrakube log/)
  } finally {
    await close()
  }
})

test('workspace creation uses a durable branch while jobs execute the requested feature branch', async () => {
  const {client, pool, close, agent} = setup({
    branch: 'feature/pr',
    workspaceBranch: 'trunk'
  })
  pool
    .intercept({
      method: 'POST',
      path: '/api/v1/organization/org/workspace',
      body: (raw: string) => {
        assert.equal(JSON.parse(raw).data.attributes.branch, 'trunk')
        return true
      }
    })
    .reply(201, {data: item('workspace', 'ws')})
  pool
    .intercept({
      method: 'POST',
      path: '/api/v1/organization/org/job',
      body: (raw: string) => {
        assert.equal(
          JSON.parse(raw).data.attributes.overrideBranch,
          'feature/pr'
        )
        assert.equal(JSON.parse(raw).data.attributes.commitId, sha)
        return true
      }
    })
    .reply(201, {data: item('job', '42')})
  try {
    await client.createWorkspace(
      'org',
      'example',
      'infra',
      '1.14.0',
      'terraform'
    )
    assert.equal(await client.createJob('org', 'ws', 'template'), '42')
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})

test('submits raw variables only after checking the server capability', async () => {
  const variables = {
    private_key: 'first\nsecond\n',
    empty: '',
    labels: '["a","b"]'
  }
  const {client, pool, agent, close} = setup({variables})
  pool
    .intercept({
      path: '/execution/v1/capabilities',
      headers: {accept: 'application/json'}
    })
    .reply(200, {jobVariables: true})
  pool
    .intercept({
      method: 'POST',
      path: '/api/v1/organization/org/job',
      body: (body: string) => {
        const data = JSON.parse(body).data
        assert.deepEqual(data.attributes.variables, variables)
        assert.equal(data.attributes.commitId, sha)
        return true
      }
    })
    .reply(201, {data: {id: '42', type: 'job'}})
  try {
    assert.equal(await client.createJob('org', 'workspace', 'template'), '42')
    agent.assertNoPendingInterceptors()
  } finally {
    await close()
  }
})

test('does not submit variables when server support is absent, malformed or cannot be verified', async () => {
  for (const [status, body] of [
    [404, 'not found'],
    [200, {}],
    [200, {jobVariables: false}],
    [200, 'invalid JSON'],
    [503, 'unavailable']
  ] as const) {
    const {client, pool, close} = setup({variables: {key: 'private-value'}})
    pool
      .intercept({path: '/execution/v1/capabilities'})
      .reply(status, body)
      .persist()
    try {
      await assert.rejects(
        client.createJob('org', 'workspace', 'template'),
        /no job was submitted/
      )
    } finally {
      await close()
    }
  }
})

test('redacts multiline forwarded variables in logs and structured context', async () => {
  const {client, pool, close} = setup({
    variables: {key: 'private-first\nprivate-second'}
  })
  pool
    .intercept({path: '/tfoutput/v1/organization/org/job/42/step/step-1'})
    .reply(200, 'private-first\nprivate-second\nprivate-second')
  try {
    assert.equal(
      await client.logs('/tfoutput/v1/organization/org/job/42/step/step-1'),
      '***\n***'
    )
  } finally {
    await close()
  }
})
