import assert from 'node:assert/strict'
import {test} from 'node:test'
import {getActionInput} from '../src/userInput'

function inputs(values: Record<string, string> = {}) {
  for (const key of Object.keys(process.env))
    if (key.startsWith('INPUT_')) delete process.env[key]
  process.env.GITHUB_REPOSITORY = 'example/repo'
  for (const [name, value] of Object.entries({
    TERRAKUBE_ENDPOINT: 'https://terrakube.example',
    TERRAKUBE_TOKEN: 'test-token',
    TERRAKUBE_ORGANIZATION: 'example',
    TERRAKUBE_TEMPLATE: 'Plan',
    TERRAKUBE_BRANCH: 'main',
    ...values
  }))
    process.env[`INPUT_${name}`] = value
}
test('PAT and OIDC modes validate required credentials without a dummy PAT', () => {
  inputs()
  assert.equal(getActionInput().auth, 'token')
  inputs({TERRAKUBE_TOKEN: ''})
  assert.throws(getActionInput, /TOKEN is required/)
  inputs({
    TERRAKUBE_AUTH: 'oidc',
    TERRAKUBE_TOKEN: '',
    TERRAKUBE_OIDC_AUDIENCE: 'terrakube'
  })
  assert.equal(getActionInput().auth, 'oidc')
  inputs({TERRAKUBE_AUTH: 'oidc'})
  assert.throws(getActionInput, /Remove TERRAKUBE_TOKEN/)
})
test('summary is the default; explicit COMMENT_MODE overrides legacy SHOW_OUTPUT', () => {
  inputs()
  assert.equal(getActionInput().comment, 'summary')
  inputs({SHOW_OUTPUT: 'true'})
  assert.equal(getActionInput().comment, 'full')
  inputs({SHOW_OUTPUT: 'true', COMMENT_MODE: 'off'})
  assert.equal(getActionInput().comment, 'off')
  inputs({SHOW_OUTPUT: 'invalid legacy value', COMMENT_MODE: 'summary'})
  assert.equal(getActionInput().comment, 'summary')
  inputs({SHOW_OUTPUT: 'false'})
  assert.equal(getActionInput().comment, 'off')
})
test('rejects invalid limits, ambiguous targets, non-SHA revisions and insecure endpoints', () => {
  const invalid: Record<string, string>[] = [
    {TIMEOUT_SECONDS: '0'},
    {TIMEOUT_SECONDS: 'NaN'},
    {REQUEST_TIMEOUT_SECONDS: '-1'},
    {TERRAKUBE_COMMIT: 'main'},
    {TERRAKUBE_WORKSPACE_ID: 'id'},
    {
      TERRAKUBE_ROOT: 'infra',
      TERRAKUBE_WORKSPACE_ID: 'id',
      TERRAKUBE_WORKSPACE: 'name'
    },
    {TERRAKUBE_ENDPOINT: 'http://terrakube.example'},
    {TERRAKUBE_ENDPOINT: 'https://user:password@terrakube.example'},
    {TERRAKUBE_ENDPOINT: 'https://terrakube.example/?token=secret'}
  ]
  for (const values of invalid) {
    inputs(values)
    assert.throws(getActionInput)
  }
})

test('staged operations require explicit identity and apply/discard require a saved job ID', () => {
  const target = {
    TERRAKUBE_ROOT: 'infra',
    TERRAKUBE_WORKSPACE: 'example',
    TERRAKUBE_COMMIT: 'a'.repeat(40)
  }
  const invalid: Record<string, string>[] = [
    {TERRAKUBE_OPERATION: 'plan'},
    {...target, TERRAKUBE_OPERATION: 'apply'},
    {...target, TERRAKUBE_OPERATION: 'discard', TERRAKUBE_JOB_ID: 'bad'},
    {...target, TERRAKUBE_OPERATION: 'plan', CREATE_WORKSPACE: 'true'},
    {TERRAKUBE_JOB_ID: '42'}
  ]
  for (const values of invalid) {
    inputs(values)
    assert.throws(getActionInput)
  }
  inputs({
    ...target,
    TERRAKUBE_OPERATION: 'apply',
    TERRAKUBE_JOB_ID: '42',
    TERRAKUBE_TEMPLATE: 'Plan and apply'
  })
  assert.equal(getActionInput().operation, 'apply')
})

test('new workspace branch comes from the repository default, PR base, or explicit input', async () => {
  const {context} = await import('@actions/github')
  const previous = context.payload
  try {
    inputs({TERRAKUBE_BRANCH: 'feature/pr'})
    context.payload = {
      repository: {
        name: 'repo',
        owner: {login: 'example', name: 'example'},
        default_branch: 'trunk'
      },
      pull_request: {
        number: 1,
        base: {ref: 'release'},
        head: {ref: 'feature/pr'}
      }
    }
    assert.equal(getActionInput().branch, 'feature/pr')
    assert.equal(getActionInput().workspaceBranch, 'trunk')
    context.payload = {pull_request: {number: 1, base: {ref: 'release'}}}
    assert.equal(getActionInput().workspaceBranch, 'release')
    inputs({TERRAKUBE_WORKSPACE_BRANCH: 'stable'})
    assert.equal(getActionInput().workspaceBranch, 'stable')
    inputs()
    context.payload = {}
    assert.equal(getActionInput().workspaceBranch, 'main')
  } finally {
    context.payload = previous
  }
})
