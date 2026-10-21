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
