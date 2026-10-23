import assert from 'node:assert/strict'
import {test} from 'node:test'
import {continueRun} from '../src/operations'
import {runJobs} from '../src/runner'
import {savedPlanTemplate} from '../src/savedPlan'
import {config, item, job, sha} from './helpers'

const tcl = Buffer.from(
  `flow:
  - type: terraformPlan
    step: 100
  - type: approval
    team: deploy
    step: 200
  - type: terraformApply
    step: 300
    requireSavedPlan: true
`
).toString('base64')
const targets = [
  {root: 'infra', name: 'example', iacType: 'terraform' as const}
]

function savedJob(status = 'waitingApproval') {
  const document = job(status, ['completed', 'waitingApproval', 'pending'])
  document.data.attributes.tcl = tcl
  document.data.attributes.templateReference = 'template'
  document.data.relationships!.workspace = {
    data: {id: 'workspace', type: 'workspace'}
  }
  document.included!.forEach((step, i) => {
    step.attributes.stepNumber = (i + 1) * 100
    if (status === 'completed') step.attributes.status = 'completed'
    if (status === 'noChanges')
      step.attributes.status = i ? 'notExecuted' : 'noChanges'
    if (status === 'rejected' && i === 1) step.attributes.status = 'rejected'
  })
  return document
}

function setup(templateTcl = tcl) {
  let document = savedJob()
  const transitions: string[] = []
  const client = {
    checkJobVariables: async () => {},
    find: async (_route: string, type: string) =>
      type === 'organization'
        ? item(type, 'org')
        : type === 'template'
          ? item(type, 'template', {name: 'Plan and apply', tcl: templateTcl})
          : item(type, 'workspace', {
              name: 'example',
              source: config().repository,
              folder: 'infra'
            }),
    orgRoute: () => '/api/v1/organization/org',
    workspace: async () =>
      item('workspace', 'workspace', {
        name: 'example',
        source: config().repository,
        folder: 'infra'
      }),
    job: async (_org: string, id: string) => {
      assert.equal(id, '42')
      return document
    },
    transitionJob: async (
      _org: string,
      id: string,
      status: 'approved' | 'rejected'
    ) => {
      assert.equal(id, '42')
      transitions.push(status)
      document = savedJob(status === 'approved' ? 'completed' : 'rejected')
    }
  }
  const settings = config({
    operation: 'apply',
    jobId: '42',
    workspace: 'example'
  })
  const run = (overrides = {}) =>
    continueRun(
      {...settings, ...overrides},
      targets,
      client,
      () => {},
      async () => {}
    )
  return {
    client,
    run,
    transitions,
    setDocument: (value: ReturnType<typeof savedJob>) => {
      document = value
    }
  }
}

test('staged plan validates its template and returns the saved job at its gate', async () => {
  const {client} = setup()
  let submitted: string | undefined
  const result = await runJobs(
    config({operation: 'plan', workspace: 'example'}),
    targets,
    {
      ...client,
      createWorkspace: async () => {
        throw new Error('unexpected creation')
      },
      createJob: async (_org, _workspace, template) => {
        submitted = template
        return '42'
      }
    },
    () => {},
    async () => {}
  )
  assert.equal(submitted, 'template')
  assert.equal(result[0]?.status, 'planned')
  assert.equal(result[0]?.error, undefined)
  assert.equal(result[0]?.jobId, '42')
})

test('unsafe templates cannot be submitted as staged plans', () => {
  for (const text of [
    'flow: []',
    Buffer.from(tcl, 'base64')
      .toString()
      .replace('requireSavedPlan: true', 'requireSavedPlan: false'),
    Buffer.from(tcl, 'base64')
      .toString()
      .replace('type: approval', 'type: terraformApply'),
    Buffer.from(tcl, 'base64').toString().replace('step: 200', 'step: 50')
  ])
    assert.throws(() => savedPlanTemplate(Buffer.from(text).toString('base64')))
})

test('apply continues the same verified run and never submits another job', async () => {
  const {run, transitions} = setup()
  const [result] = await run()
  assert.deepEqual(transitions, ['approved'])
  assert.equal(result?.jobId, '42')
  assert.equal(result?.revision, sha)
  assert.equal(result?.status, 'completed')
})

test('a completed apply can be retried without applying again', async () => {
  const {run, transitions, setDocument} = setup()
  setDocument(savedJob('completed'))
  assert.equal((await run())[0]?.status, 'completed')
  assert.deepEqual(transitions, [])
})

test('no-change plans require no apply and do not authorize a transition', async () => {
  const {run, transitions, setDocument} = setup()
  setDocument(savedJob('noChanges'))
  assert.equal((await run())[0]?.status, 'noChanges')
  assert.deepEqual(transitions, [])
})

test('wrong workspace, revision, missing plan and unsafe saved templates fail before approval', async () => {
  for (const corrupt of [
    (d: ReturnType<typeof savedJob>) => {
      d.data.attributes.commitId = 'b'.repeat(40)
    },
    (d: ReturnType<typeof savedJob>) => {
      d.data.relationships!.workspace = {
        data: {type: 'workspace', id: 'another'}
      }
    },
    (d: ReturnType<typeof savedJob>) => {
      d.data.attributes.templateReference = 'another-template'
    },
    (d: ReturnType<typeof savedJob>) => {
      d.included![0]!.attributes.status = 'failed'
    },
    (d: ReturnType<typeof savedJob>) => {
      d.included![2]!.attributes.status = 'running'
    }
  ]) {
    const {run, transitions, setDocument} = setup()
    const document = savedJob()
    corrupt(document)
    setDocument(document)
    assert.equal((await run())[0]?.status, 'error')
    assert.deepEqual(transitions, [])
  }
})

test('discard rejects the existing paused run and is idempotent', async () => {
  const {run, transitions} = setup()
  assert.equal((await run({operation: 'discard'}))[0]?.status, 'discarded')
  assert.equal((await run({operation: 'discard'}))[0]?.status, 'discarded')
  assert.deepEqual(transitions, ['rejected'])
})

test('discard refuses to cancel a run that has started applying', async () => {
  const {run, transitions, setDocument} = setup()
  const document = savedJob('running')
  document.included![1]!.attributes.status = 'completed'
  document.included![2]!.attributes.status = 'running'
  setDocument(document)
  assert.equal((await run({operation: 'discard'}))[0]?.status, 'error')
  assert.deepEqual(transitions, [])
})

test('a lost approval response retains identity and does not retry the mutation', async () => {
  const {client, run, transitions} = setup()
  client.transitionJob = async (_org, _id, status) => {
    transitions.push(status)
    throw new Error('request timed out')
  }
  const [result] = await run()
  assert.equal(result?.jobId, '42')
  assert.equal(result?.remoteMayBeRunning, true)
  assert.equal(result?.status, 'error')
  assert.deepEqual(transitions, ['approved'])
})

test('a resumed run has a bounded polling deadline', async () => {
  const {client} = setup()
  client.transitionJob = async () => {}
  let now = 0
  const [result] = await continueRun(
    config({
      operation: 'apply',
      jobId: '42',
      timeoutMs: 10,
      pollIntervalMs: 10
    }),
    targets,
    client,
    () => {},
    async () => {},
    async ms => {
      now += ms
    },
    () => now
  )
  assert.equal(result?.status, 'timedOut')
  assert.equal(result?.jobId, '42')
})

const hookTcl = Buffer.from(
  `flow:
  - type: customScripts
    step: 50
  - type: terraformPlan
    step: 100
  - type: policyEvaluation
    step: 150
  - type: approval
    step: 200
  - type: customScripts
    step: 250
  - type: terraformApply
    step: 300
    requireSavedPlan: true
  - type: customScripts
    step: 350
`
).toString('base64')

function hookJob() {
  const document = savedJob()
  document.included = [50, 100, 150, 200, 250, 300, 350].map(number =>
    item('step', `step-${number}`, {
      stepNumber: number,
      status: number < 200 ? 'completed' : 'pending'
    })
  )
  return document
}

test('staged templates allow scanning, policy and notification hooks around the approval boundary', async () => {
  assert.deepEqual(savedPlanTemplate(hookTcl), {
    plan: 100,
    approval: 200,
    apply: 300,
    steps: [50, 100, 150, 200, 250, 300, 350]
  })
  const {run, setDocument, transitions, client} = setup(hookTcl)
  setDocument(hookJob())
  const [plan] = await runJobs(
    config({operation: 'plan'}),
    targets,
    {
      ...client,
      createWorkspace: async () => {
        throw new Error('unexpected creation')
      },
      createJob: async () => '42'
    },
    () => {},
    async () => {}
  )
  assert.equal(plan?.status, 'planned')
  client.transitionJob = async (_org, _id, status) => {
    transitions.push(status)
    const complete = hookJob()
    complete.data.attributes.status = 'completed'
    complete.included!.forEach(step => {
      step.attributes.status = 'completed'
    })
    setDocument(complete)
  }
  assert.equal((await run())[0]?.status, 'completed')
  assert.deepEqual(transitions, ['approved'])
})

test('hooks cannot bypass policy success or start after the gate before approval', async () => {
  for (const [number, status] of [
    [150, 'failed'],
    [150, 'pending'],
    [150, 'NeverExecuted'],
    [250, 'running'],
    [350, 'completed']
  ] as const) {
    const {run, setDocument, transitions} = setup(hookTcl)
    const document = hookJob()
    document.included!.find(
      step => step.attributes.stepNumber === number
    )!.attributes.status = status
    setDocument(document)
    assert.equal((await run())[0]?.status, 'error')
    assert.deepEqual(transitions, [])
  }
})

test('missing or duplicate hook results cannot authorize an apply', async () => {
  for (const corrupt of [
    (d: ReturnType<typeof hookJob>) => {
      d.included!.splice(2, 1)
    },
    (d: ReturnType<typeof hookJob>) => {
      d.included![2]!.attributes.stepNumber = 100
    }
  ]) {
    const {run, setDocument, transitions} = setup(hookTcl)
    const document = hookJob()
    corrupt(document)
    setDocument(document)
    assert.equal((await run())[0]?.status, 'error')
    assert.deepEqual(transitions, [])
  }
})

test('extra hooks cannot introduce duplicate gates, additional plans, unguarded applies or destroys', () => {
  const source = Buffer.from(hookTcl, 'base64').toString()
  for (const text of [
    source.replace('type: policyEvaluation', 'type: terraformApply'),
    source.replace('type: customScripts', 'type: approval'),
    source.replace('type: policyEvaluation', 'type: terraformPlan'),
    source.replace('type: customScripts', 'type: terraformDestroy'),
    source.replace('type: customScripts', 'type: terraformPlanDestroy'),
    source.replace('step: 150', 'step: 100'),
    source.replace('step: 150', 'step: 150\n    ignoreError: true'),
    source.replace('requireSavedPlan: true', 'requireSavedPlan: false')
  ])
    assert.throws(() => savedPlanTemplate(Buffer.from(text).toString('base64')))
})
