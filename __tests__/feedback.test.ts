import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as github from '@actions/github'
import {
  commentBody,
  Feedback,
  newerRun,
  planSummary,
  structuredPlan,
  jobSummary
} from '../src/feedback'
import {JobResult} from '../src/runner'
import {config, job, sha} from './helpers'

const result: JobResult = {
  root: 'infra',
  workspace: 'example',
  workspaceId: 'ws',
  jobId: 'job-1',
  status: 'completed',
  revision: sha
}

test('plan summaries reject conflicting counts and ignore arbitrary log text', () => {
  assert.equal(
    planSummary([
      '\u001b[32mPlan: 1 to add, 2 to change, 3 to destroy.\u001b[0m'
    ]),
    'Plan: 1 to add, 2 to change, 3 to destroy.'
  )
  assert.equal(
    planSummary([
      'Plan: 1 to add, 0 to change, 0 to destroy.\nPlan: 2 to add, 0 to change, 0 to destroy.'
    ]),
    undefined
  )
  assert.equal(
    planSummary(['echo Plan: 1 to add, 0 to change, 0 to destroy.']),
    undefined
  )
})
test('full logs collapse and escape untrusted text, bounded below GitHub’s comment limit', () => {
  const body = commentBody(
    {...result, workspace: '<script>@everyone</script>'},
    '<!-- marker -->',
    20,
    1,
    [
      {
        name: '</summary>',
        text: '````\n</pre>@everyone\n' + '😀'.repeat(100_000)
      }
    ]
  )
  assert.ok(Buffer.byteLength(body) < 65_536)
  assert.ok(body.includes('<details>'))
  assert.ok(body.includes('&lt;/pre&gt;'))
  assert.ok(!body.includes('@everyone'))
  assert.ok(!body.includes('<script>'))
})
test('stale runs and earlier attempts cannot overwrite newer feedback', () => {
  assert.equal(newerRun('<!-- run:21:1 -->', 20, 10), true)
  assert.equal(newerRun('<!-- run:20:2 -->', 20, 1), true)
  assert.equal(newerRun('<!-- run:19:2 -->', 20, 1), false)
})

function setup(
  options: {
    comments?: {id: number; body: string; user: {login: string; id: number}}[]
    head?: string
    denied?: boolean
    authorId?: number
    failure?: Error
    identityFailure?: boolean
  } = {}
) {
  github.context.payload = {pull_request: {number: 1, head: {sha}}}
  github.context.runId = 20
  process.env.GITHUB_REPOSITORY = 'example/repo'
  process.env.GITHUB_RUN_ATTEMPT = '1'
  let updates = 0
  let creates = 0
  let body = ''
  let logReads = 0
  const api = {
    graphql: async () => {
      if (options.identityFailure) throw new Error('private token response')
      return {viewer: {databaseId: options.authorId || 1}}
    },
    rest: {
      pulls: {get: async () => ({data: {head: {sha: options.head || sha}}})},
      issues: {
        listComments: async () => {},
        getComment: async (request: {comment_id: number}) => ({
          data: options.comments?.find(
            comment => comment.id === request.comment_id
          )
        }),
        updateComment: async (request: {body: string}) => {
          if (options.failure) throw options.failure
          if (options.denied)
            throw Object.assign(new Error('private token response'), {
              status: 403
            })
          updates++
          body = request.body
        },
        createComment: async (request: {body: string}) => {
          if (options.failure) throw options.failure
          if (options.denied)
            throw Object.assign(new Error('private token response'), {
              status: 403
            })
          creates++
          body = request.body
        }
      }
    },
    paginate: async () => options.comments || []
  } as unknown as ReturnType<typeof github.getOctokit>
  const client = {
    logs: async () => {
      logReads++
      return 'Plan: 1 to add, 0 to change, 0 to destroy.'
    }
  }
  return {api, client, counts: () => ({updates, creates, body, logReads})}
}
test('summary mode posts status without fetching raw logs; reruns update one owned comment', async () => {
  const first = setup()
  await new Feedback(config(), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  assert.equal(first.counts().creates, 1)
  assert.equal(first.counts().logReads, 0)
  const second = setup({
    comments: [
      {
        id: 1,
        body: first.counts().body,
        user: {login: 'github-actions[bot]', id: 1}
      }
    ]
  })
  await new Feedback(config(), second.api).publish(
    result,
    job('completed'),
    second.client
  )
  assert.equal(second.counts().updates, 1)
  assert.equal(second.counts().creates, 0)
})
test('off and non-PR events avoid comments and log reads', async () => {
  const first = setup()
  await new Feedback(config({comment: 'off'}), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  github.context.payload = {}
  await new Feedback(config({comment: 'full'}), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  assert.equal(first.counts().creates, 0)
  assert.equal(first.counts().logReads, 0)
})
test('outdated PR revisions and newer-run comments skip updates and logs', async () => {
  const first = setup()
  await new Feedback(config(), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  for (const options of [
    {head: 'b'.repeat(40)},
    {
      comments: [
        {
          id: 1,
          body: first.counts().body.replace('run:20:1', 'run:21:1'),
          user: {login: 'github-actions[bot]', id: 1}
        }
      ]
    }
  ]) {
    const next = setup(options)
    await new Feedback(config({comment: 'full'}), next.api).publish(
      result,
      job('completed'),
      next.client
    )
    assert.equal(
      next.counts().creates + next.counts().updates + next.counts().logReads,
      0
    )
  }
})
test('user-authored marker lookalikes are not updated', async () => {
  const first = setup()
  await new Feedback(config(), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  const next = setup({
    comments: [
      {id: 1, body: first.counts().body, user: {login: 'someone', id: 2}}
    ]
  })
  await new Feedback(config(), next.api).publish(
    result,
    job('completed'),
    next.client
  )
  assert.equal(next.counts().updates, 0)
  assert.equal(next.counts().creates, 1)
})
test('missing comment permissions are non-fatal; full logs require opt-in', async () => {
  const next = setup({denied: true})
  await new Feedback(config({comment: 'full'}), next.api).publish(
    result,
    job('completed'),
    next.client
  )
  assert.equal(next.counts().logReads, 1)
  assert.equal(result.status, 'completed')
})

test('structured feedback counts replacements and separates outputs without exposing values', () => {
  const plan = structuredPlan({
    structuredOutputStatus: {state: 'PERSISTED'},
    planStructuredOutput: {
      step: [
        {
          address: 'thing.replace',
          action: 'replace',
          actions: ['delete', 'create'],
          before: {secret: 'PRIVATE'},
          after: {secret: 'PRIVATE'}
        },
        {address: 'thing.update', action: 'update'},
        {address: 'result', action: 'create', isOutputChange: true},
        {address: 'thing.same', action: 'no-op'}
      ]
    }
  })
  assert.match(plan || '', /1 to add, 1 to change, 1 to destroy/)
  assert.match(plan || '', /1 output change/)
  assert.match(plan || '', /thing.replace/)
  assert.doesNotMatch(plan || '', /PRIVATE|thing.same/)
})

test('large structured plans retain complete totals and bound the resource table', () => {
  const plan =
    structuredPlan({
      structuredOutputStatus: {state: 'PERSISTED'},
      planStructuredOutput: {
        step: Array.from({length: 10000}, (_, i) => ({
          address: `thing.example[${i}]`,
          action: 'create'
        }))
      }
    }) || ''
  assert.match(plan, /10000 to add/)
  assert.match(plan, /9900 more resource changes/)
  assert.ok(Buffer.byteLength(plan) < 21000)
})

test('structured feedback fails closed on partial, ambiguous and unsupported plan data', () => {
  assert.equal(
    structuredPlan({
      structuredOutputStatus: {state: 'PENDING'},
      planStructuredOutput: {step: []}
    }),
    undefined
  )
  assert.equal(
    structuredPlan({
      structuredOutputStatus: {state: 'PERSISTED'},
      planStructuredOutput: {one: [], two: []}
    }),
    undefined
  )
  assert.equal(
    structuredPlan({
      structuredOutputStatus: {state: 'PERSISTED'},
      planStructuredOutput: {step: [{address: 'x', action: 'unknown'}]}
    }),
    undefined
  )
  const plan =
    structuredPlan({
      structuredOutputStatus: {state: 'PERSISTED'},
      planStructuredOutput: {
        step: [{address: '<script>|@person', action: 'delete'}]
      }
    }) || ''
  assert.doesNotMatch(plan, /<script>|@person/)
  assert.match(plan, /&#124;/)
})

test('multi-workspace summaries stay below GitHub’s size limit', () => {
  const results = Array.from({length: 1000}, (_, i) => ({
    root: 'infra',
    workspace: 'workspace-' + i,
    status: 'completed',
    jobId: String(i)
  }))
  const body = jobSummary(results, '', () => 'x'.repeat(20000))
  assert.ok(Buffer.byteLength(body) < 1000000)
  assert.match(body, /Terrakube/)
})

test('custom app and service-account tokens update only their own comment', async () => {
  for (const [login, id] of [
    ['infra-app[bot]', 123],
    ['deployment-account', 456]
  ] as const) {
    const first = setup({authorId: id})
    await new Feedback(config(), first.api).publish(
      result,
      job('completed'),
      first.client
    )
    const next = setup({
      authorId: id,
      comments: [
        {
          id: 1,
          body: first.counts().body,
          user: {login: 'github-actions[bot]', id: 1}
        },
        {id: 2, body: first.counts().body, user: {login, id}}
      ]
    })
    await new Feedback(config(), next.api).publish(
      result,
      job('completed'),
      next.client
    )
    assert.equal(next.counts().updates, 1)
    assert.equal(next.counts().creates, 0)
  }
})

test('failure to resolve the authenticated author does not update another bot or create duplicates', async () => {
  const next = setup({identityFailure: true})
  await new Feedback(config(), next.api).publish(
    result,
    job('completed'),
    next.client
  )
  assert.equal(next.counts().updates + next.counts().creates, 0)
})

test('feedback errors report safe status and timeout details without exposing response text or credentials', async t => {
  const warnings: string[] = []
  t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    warnings.push(String(chunk))
    return true
  })
  for (const [failure, expected] of [
    [
      Object.assign(new Error('PRIVATE-TOKEN private response'), {status: 403}),
      /HTTP 403/
    ],
    [
      Object.assign(new Error('PRIVATE-TOKEN private response'), {
        name: 'TimeoutError'
      }),
      /timed out/
    ],
    [new Error('PRIVATE-TOKEN private response'), /GitHub request failed/],
    [
      new Error('Too many PR comments to locate an owned comment safely'),
      /Too many PR comments/
    ]
  ] as const) {
    const next = setup({failure})
    await new Feedback(config(), next.api).publish(
      result,
      job('completed'),
      next.client
    )
    assert.match(warnings.at(-1)!, expected)
    assert.doesNotMatch(
      warnings.at(-1)!,
      /PRIVATE|private response|check token permissions/
    )
    assert.equal(result.status, 'completed')
  }
})

test('feedback caches the authenticated identity and rechecks ownership before updating', async () => {
  const first = setup()
  await new Feedback(config(), first.api).publish(
    result,
    job('completed'),
    first.client
  )
  const comment = {
    id: 1,
    body: first.counts().body,
    user: {login: 'github-actions[bot]', id: 1}
  }
  const next = setup({comments: [comment]})
  let identityReads = 0
  const graphql = next.api.graphql
  Object.assign(next.api, {
    graphql: async () => {
      identityReads++
      return graphql('query { viewer { databaseId } }')
    }
  })
  const feedback = new Feedback(config(), next.api)
  await feedback.publish(result, job('completed'), next.client)
  Object.assign(next.api.rest.issues, {
    getComment: async () => ({
      data: {...comment, user: {login: 'github-actions[bot]', id: 999}}
    })
  })
  await feedback.publish(result, job('completed'), next.client)
  assert.equal(identityReads, 1)
  assert.equal(next.counts().updates, 1)
})
