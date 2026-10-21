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
  const pool = agent.get(settings.endpoint)
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
test('refuses external log URLs and does not follow credential-bearing redirects', async () => {
  const {client, pool, close} = setup()
  pool
    .intercept({path: '/logs'})
    .reply(302, '', {headers: {location: 'https://untrusted.example/log'}})
    .times(3)
  try {
    await assert.rejects(
      client.logs('https://untrusted.example/log'),
      /external/
    )
    await assert.rejects(
      client.logs('https://terrakube.example/logs'),
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
    .intercept({path: '/logs'})
    .reply(200, 'log')
    .times(2)
  try {
    await client.logs('/logs')
    now += 241_000
    await client.logs('/logs')
    assert.equal(issued, 2)
  } finally {
    await client.close()
    await agent.close()
  }
})

test('raw logs redact known PAT and GitHub credentials', async () => {
  const {client, pool, close} = setup({githubToken: 'github-test-token'})
  pool.intercept({path: '/logs'}).reply(200, 'test-token github-test-token')
  try {
    assert.equal(await client.logs('/logs'), '*** ***')
  } finally {
    await close()
  }
})
test('oversized log responses are truncated and oversized API documents fail', async () => {
  const {client, pool, close} = setup()
  pool.intercept({path: '/logs'}).reply(200, 'x'.repeat(200_000))
  pool
    .intercept({path: '/api/v1/organization/org/job/job-1?include=step'})
    .reply(200, 'x'.repeat(8_000_001))
  try {
    assert.match(await client.logs('/logs'), /Log truncated/)
    await assert.rejects(
      client.job('org', 'job-1', Date.now() + 1000),
      /exceeded 8 MB/
    )
  } finally {
    await close()
  }
})
