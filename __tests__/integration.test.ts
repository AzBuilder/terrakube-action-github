import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {once} from 'node:events'
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:https'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {item, job, sha} from './helpers'

// Public test credentials; trusted only by the isolated child processes below.
const certificate = fileURLToPath(
  new URL('./fixtures/localhost.test-cert.pem', import.meta.url)
)
const key = fileURLToPath(
  new URL('./fixtures/localhost.test-key.pem', import.meta.url)
)

function output(contents: string, name: string): string {
  const matches = [
    ...contents.matchAll(
      new RegExp(`^${name}<<[^\\r\\n]+\\r?\\n([^\\r\\n]*)`, 'gm')
    )
  ]
  return matches.at(-1)?.[1] || ''
}

async function execute(
  options: {
    status?: string
    revision?: string
    oidc?: boolean
    roots?: string[]
    trusted?: boolean
    apiError?: boolean
  } = {}
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'terrakube-http-'))
  const roots = options.roots || ['infra']
  let submissions = 0
  let logReads = 0
  let tokenRequests = 0
  let serverError: unknown
  const token = options.oidc
    ? `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 300})).toString('base64url')}.signature`
    : 'bundle-test-token'
  const server = createServer(
    {cert: await readFile(certificate), key: await readFile(key)},
    async (request, response) => {
      const url = new URL(request.url || '/', 'https://localhost')
      const send = (body: unknown, status = 200) => {
        response.writeHead(status, {'content-type': 'application/vnd.api+json'})
        response.end(JSON.stringify(body))
      }
      try {
        if (url.pathname === '/oidc') {
          tokenRequests++
          assert.equal(
            request.headers.authorization,
            'Bearer oidc-request-token'
          )
          assert.equal(url.searchParams.get('audience'), 'api://terrakube')
          send({value: token})
          return
        }
        assert.equal(request.headers.authorization, `Bearer ${token}`)
        if (options.apiError) {
          send({errors: [{detail: 'private-server-details'}]}, 403)
          return
        }
        if (url.pathname.endsWith('/organization')) {
          send({data: [item('organization', 'org', {name: 'example'})]})
          return
        }
        if (url.pathname.endsWith('/template')) {
          send({data: [item('template', 'template', {name: 'Plan'})]})
          return
        }
        if (url.pathname.endsWith('/workspace')) {
          const name = url.searchParams
            .get('filter[workspace]')
            ?.match(/^name=='(.*)'$/)?.[1]
          assert.ok(name && roots.includes(name))
          send({
            data: [
              item('workspace', name, {
                name,
                folder: name,
                source: 'https://github.com/example/repo.git'
              })
            ]
          })
          return
        }
        if (request.method === 'POST' && url.pathname.endsWith('/job')) {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString())
          assert.equal(body.data.attributes.commitId, sha)
          assert.equal(body.data.attributes.overrideBranch, 'feature')
          assert.equal(body.data.attributes.templateReference, 'template')
          submissions++
          send({data: item('job', `job-${submissions}`)})
          return
        }
        if (url.pathname.includes('/job/')) {
          const id = url.pathname.split('/').at(-1) || ''
          const document = job(
            options.status || 'completed',
            ['completed'],
            options.revision || sha
          )
          document.data.id = id
          send(document)
          return
        }
        if (url.pathname.includes('/logs')) {
          logReads++
          send('raw-private-log')
          return
        }
        send({errors: []}, 404)
      } catch (error) {
        serverError = error
        send({errors: []}, 500)
      }
    }
  )
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const endpoint = `https://127.0.0.1:${address.port}`
    await cp(
      new URL('../dist', import.meta.url),
      path.join(directory, 'dist'),
      {recursive: true}
    )
    for (const root of roots) await mkdir(path.join(directory, root))
    const outputs = path.join(directory, 'outputs')
    const summary = path.join(directory, 'summary')
    await writeFile(outputs, '')
    await writeFile(summary, '')
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('INPUT_'))
    )
    Object.assign(env, {
      GITHUB_WORKSPACE: directory,
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_EVENT_PATH: '',
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
      NODE_EXTRA_CA_CERTS: options.trusted === false ? '' : certificate,
      NO_PROXY: '127.0.0.1',
      no_proxy: '127.0.0.1',
      INPUT_TERRAKUBE_ENDPOINT: endpoint,
      INPUT_TERRAKUBE_ORGANIZATION: 'example',
      INPUT_TERRAKUBE_TEMPLATE: 'Plan',
      INPUT_TERRAKUBE_TOKEN: options.oidc ? '' : token,
      INPUT_TERRAKUBE_AUTH: options.oidc ? 'oidc' : 'token',
      INPUT_TERRAKUBE_OIDC_AUDIENCE: options.oidc ? 'api://terrakube' : '',
      INPUT_TERRAKUBE_ROOT: roots.join('\n'),
      INPUT_TERRAKUBE_BRANCH: 'feature',
      INPUT_TERRAKUBE_COMMIT: sha,
      INPUT_COMMENT_MODE: 'off',
      ACTIONS_ID_TOKEN_REQUEST_URL: `${endpoint}/oidc?request=1`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token'
    })
    let code = 0
    let stdout = ''
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [path.join(directory, 'dist/index.js')],
        {cwd: directory, env, timeout: 15_000}
      )
      stdout = result.stdout
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'number' &&
        'stdout' in error
      ))
        throw error
      code = error.code
      stdout = String(error.stdout)
    }
    if (serverError) throw serverError
    return {
      code,
      stdout,
      outputs: await readFile(outputs, 'utf8'),
      summary: await readFile(summary, 'utf8'),
      submissions,
      logReads,
      tokenRequests
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, {recursive: true, force: true})
  }
}

for (const status of [
  'completed',
  'noChanges',
  'failed',
  'cancelled',
  'rejected'
]) {
  test(`standalone action reports ${status} through the HTTPS API`, async () => {
    const result = await execute({status})
    assert.equal(
      result.code,
      ['completed', 'noChanges'].includes(status) ? 0 : 1
    )
    assert.deepEqual(JSON.parse(output(result.outputs, 'JOB_IDS')), ['job-1'])
    assert.equal(JSON.parse(output(result.outputs, 'JOBS'))[0].status, status)
    assert.match(result.summary, new RegExp(status))
    assert.equal(result.submissions, 1)
    assert.equal(result.logReads, 0)
    assert.doesNotMatch(result.stdout, /raw-private-log/)
  })
}
test('standalone action obtains an OIDC credential through the GitHub toolkit', async () => {
  const result = await execute({oidc: true})
  assert.equal(result.code, 0)
  assert.equal(result.tokenRequests, 1)
  assert.equal(result.submissions, 1)
})
test('standalone action preserves every submitted job in a multi-root execution', async () => {
  const result = await execute({roots: ['infra', 'other']})
  assert.equal(result.code, 0)
  assert.equal(output(result.outputs, 'JOB_ID'), '')
  assert.deepEqual(JSON.parse(output(result.outputs, 'JOB_IDS')), [
    'job-1',
    'job-2'
  ])
  assert.equal(JSON.parse(output(result.outputs, 'JOBS')).length, 2)
})
test('standalone action fails revision mismatches without losing job identity', async () => {
  const result = await execute({revision: 'b'.repeat(40)})
  assert.equal(result.code, 1)
  assert.equal(output(result.outputs, 'JOB_ID'), 'job-1')
  assert.match(result.summary, /differs from TERRAKUBE_COMMIT/)
})
test('standalone action rejects untrusted TLS certificates and unsuccessful API responses', async () => {
  for (const options of [{trusted: false}, {apiError: true}]) {
    const result = await execute(options)
    assert.equal(result.code, 1)
    assert.equal(result.submissions, 0)
    assert.equal(output(result.outputs, 'STATUS'), 'failed')
    assert.doesNotMatch(
      result.stdout + result.summary,
      /private-server-details/
    )
  }
})
