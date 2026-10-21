import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Credentials} from '../src/auth'
import {config} from './helpers'

const jwt = (exp: number): string =>
  `header.${Buffer.from(JSON.stringify({exp})).toString('base64url')}.signature`
test('PAT authentication does not request a GitHub OIDC token', async () => {
  const credentials = new Credentials(config(), async () => {
    throw new Error('unexpected OIDC call')
  })
  assert.equal(await credentials.get(), 'test-token')
})
test('OIDC uses the configured audience and refreshes before expiry', async () => {
  let now = 1_000_000
  let calls = 0
  const credentials = new Credentials(
    config({auth: 'oidc', token: '', audience: 'terrakube'}),
    async audience => {
      assert.equal(audience, 'terrakube')
      calls++
      return jwt(now / 1000 + 300)
    },
    () => now
  )
  const first = await credentials.get()
  assert.equal(await credentials.get(), first)
  assert.equal(calls, 1)
  now += 241_000
  assert.notEqual(await credentials.get(), first)
  assert.equal(calls, 2)
})
test('invalid and expired OIDC credentials fail without falling back to PAT', async () => {
  for (const token of ['not-a-jwt', jwt(0)]) {
    await assert.rejects(
      new Credentials(
        config({auth: 'oidc', token: ''}),
        async () => token
      ).get(),
      /OIDC token/
    )
  }
})

test('redaction covers both current and retired OIDC credentials', async () => {
  let now = 1_000_000
  const credentials = new Credentials(
    config({auth: 'oidc', token: ''}),
    async () => jwt(now / 1000 + 300),
    () => now
  )
  const first = await credentials.get()
  now += 241_000
  const second = await credentials.get()
  assert.equal(
    credentials.redact(`first=${first} second=${second}`),
    'first=*** second=***'
  )
})
