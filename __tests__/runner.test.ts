import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isSuccess, jobStatus, runJobs} from '../src/runner'
import {Target} from '../src/targets'
import {Resource} from '../src/terrakube'
import {config, item, job, sha} from './helpers'

for (const status of ['completed', 'noChanges']) {
  test(`${status} succeeds with a verified revision`, () => {
    assert.deepEqual(jobStatus(job(status), config()), {status, done: true})
  })
}
for (const status of ['failed', 'cancelled', 'rejected']) {
  test(`${status} is a terminal failure`, () => {
    const state = jobStatus(job(status), config())
    assert.equal(state.status, status)
    assert.equal(state.done, true)
    assert.equal(
      isSuccess({root: 'infra', workspace: 'example', status: state.status}),
      false
    )
  })
}
test('a failed step overrides a completed job', () => {
  assert.equal(
    jobStatus(job('completed', ['failed']), config()).status,
    'failed'
  )
})
test('approval can wait or fail and is never approved by the action', () => {
  assert.deepEqual(
    jobStatus(job('waitingApproval', ['waitingApproval']), config()),
    {status: 'waitingApproval', done: false}
  )
  assert.deepEqual(
    jobStatus(job('waitingApproval'), config({approval: 'fail'})),
    {status: 'waitingApproval', done: true}
  )
})
test('success cannot hide unfinished steps or missing results', () => {
  assert.throws(
    () => jobStatus(job('completed', ['running']), config()),
    /unfinished/
  )
  assert.throws(
    () => jobStatus(job('completed', []), config()),
    /no step results/
  )
  assert.equal(
    jobStatus(job('noChanges', ['completed', 'notExecuted']), config()).done,
    true
  )
})
test('unsupported states and missing/mismatched executed revisions fail clearly', () => {
  assert.throws(() => jobStatus(job('unknown'), config()), /Unsupported/)
  assert.throws(
    () => jobStatus(job('completed', ['completed'], 'b'.repeat(40)), config()),
    /revision/
  )
  assert.throws(
    () => jobStatus(job('running', ['running'], ''), config()),
    /revision/
  )
  assert.equal(
    jobStatus(job('pending', ['notExecuted'], ''), config()).done,
    false
  )
})

const targets: Target[] = [
  {root: 'infra', name: 'one', iacType: 'terraform'},
  {root: 'other', name: 'two', iacType: 'tofu'}
]
function fakeClient() {
  return {
    checkJobVariables: async () => {},
    find: async (
      _route: string,
      type: string,
      name: string
    ): Promise<Resource | undefined> =>
      type === 'workspace'
        ? item(type, name, {
            name,
            source: config().repository,
            folder: name === 'one' ? 'infra' : 'other'
          })
        : item(type, type, {name}),
    orgRoute: () => '/api/v1/organization/org',
    workspace: async () =>
      item('workspace', 'one', {source: config().repository, folder: 'infra'}),
    createWorkspace: async () => {
      throw new Error('unexpected creation')
    },
    createJob: async (_org: string, id: string): Promise<string> =>
      id === 'one' ? 'job-1' : 'job-2',
    job: async (_org: string, id: string) =>
      job(id === 'job-1' ? 'failed' : 'completed')
  }
}
test('multiple roots retain failure, success and every ID; outputs arrive before polling', async () => {
  const client = fakeClient()
  let updates: string[] = []
  let polled = false
  client.job = async (_org, id) => {
    assert.ok(updates.includes(id))
    polled = true
    return job(id === 'job-1' ? 'failed' : 'completed')
  }
  const results = await runJobs(
    config(),
    targets,
    client,
    results => {
      updates = results.flatMap(result => result.jobId || [])
    },
    async () => {
      throw new Error('comment permission denied')
    }
  )
  assert.equal(polled, true)
  assert.deepEqual(
    results.map(result => result.status),
    ['failed', 'completed']
  )
  assert.deepEqual(updates, ['job-1', 'job-2'])
})
test('deadline retains identity and explains remote execution may continue', async () => {
  const client = fakeClient()
  client.job = async () => job('running', ['running'])
  let now = 0
  const [result] = await runJobs(
    config({timeoutMs: 10, pollIntervalMs: 10}),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {},
    async ms => {
      now += ms
    },
    () => now
  )
  assert.equal(result?.jobId, 'job-1')
  assert.equal(result?.status, 'timedOut')
  assert.equal(result?.remoteMayBeRunning, true)
  assert.match(result?.error || '', /may still be running/)
})
test('polling API failure retains job identity', async () => {
  const client = fakeClient()
  client.job = async () => {
    throw new Error('HTTP 403')
  }
  const [result] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(result?.jobId, 'job-1')
  assert.equal(result?.status, 'error')
  assert.match(result?.error || '', /HTTP 403/)
})
test('creation is never retried and ambiguous submission warns against resubmission', async () => {
  const client = fakeClient()
  let submissions = 0
  client.createJob = async () => {
    submissions++
    throw new Error('request timed out')
  }
  const [result] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(submissions, 1)
  assert.equal(result?.jobId, undefined)
  assert.equal(result?.remoteMayBeRunning, true)
})
test('repository mismatch fails before submitting a job', async () => {
  const client = fakeClient()
  client.find = async (_route, type, name) =>
    item(type, name, {
      name,
      source: 'https://github.com/other/repo',
      folder: 'infra'
    })
  let submissions = 0
  client.createJob = async () => {
    submissions++
    return 'unexpected'
  }
  const [result] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(submissions, 0)
  assert.match(result?.error || '', /repository/)
})
test('revision mismatch retains identity and cannot report success', async () => {
  const client = fakeClient()
  client.job = async () =>
    job('completed', ['completed'], sha.replace('a', 'b'))
  const [result] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(result?.status, 'error')
  assert.equal(result?.jobId, 'job-1')
})

test('missing workspace creation requires explicit opt-in and version metadata', async () => {
  const client = fakeClient()
  const find = client.find
  client.find = async (route, type, name) =>
    type === 'workspace' ? undefined : find(route, type, name)
  const [disabled] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.match(disabled?.error || '', /CREATE_WORKSPACE is disabled/)
  const [missingVersion] = await runJobs(
    config({createWorkspace: true}),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.match(missingVersion?.error || '', /requires a terraform version/)
})
test('approval fail mode preserves a paused job and its identity', async () => {
  const client = fakeClient()
  client.job = async () => job('waitingApproval', ['waitingApproval'])
  const [result] = await runJobs(
    config({approval: 'fail'}),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(result?.status, 'waitingApproval')
  assert.equal(result?.jobId, 'job-1')
  assert.equal(result?.remoteMayBeRunning, true)
})

test('a failed step does not imply that the remote job has stopped', async () => {
  const client = fakeClient()
  client.job = async () => job('running', ['failed'])
  const [result] = await runJobs(
    config(),
    targets.slice(0, 1),
    client,
    () => {},
    async () => {}
  )
  assert.equal(result?.status, 'failed')
  assert.equal(result?.remoteMayBeRunning, true)
})

test('completed jobs accept known skipped-step spellings without accepting unfinished or failed steps', () => {
  for (const skipped of ['NeverExecuted', 'notExecuted']) {
    assert.deepEqual(
      jobStatus(job('completed', ['completed', skipped]), config()),
      {status: 'completed', done: true}
    )
    assert.equal(
      jobStatus(job('completed', [skipped, 'failed']), config()).status,
      'failed'
    )
    assert.throws(
      () => jobStatus(job('completed', [skipped, 'pending']), config()),
      /unfinished/
    )
  }
})

test('unsupported variables fail before workspace creation or job submission', async () => {
  const client = fakeClient()
  client.checkJobVariables = async () => {
    throw new Error('Server lacks jobVariables support')
  }
  client.createWorkspace = async () => {
    throw new Error('unexpected workspace creation')
  }
  client.createJob = async () => {
    throw new Error('unexpected submission')
  }
  await assert.rejects(
    runJobs(
      config({variables: {key: 'private'}, createWorkspace: true}),
      targets,
      client,
      () => {},
      async () => {}
    ),
    /Server lacks jobVariables support/
  )
})
