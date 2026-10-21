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

test('OIDC acquisition retries network failures with bounded backoff', async () => {
  let calls = 0
  const waits: number[] = []
  const credentials = new Credentials(
    config({auth: 'oidc', token: ''}),
    async () => {
      if (++calls < 3) throw new Error('temporary transport failure')
      return jwt(1300)
    },
    () => 1_000_000,
    async ms => {
      waits.push(ms)
    }
  )
  assert.equal(await credentials.get(), jwt(1300))
  assert.equal(calls, 3)
  assert.deepEqual(waits, [1000, 2000])
})

test('failed proactive renewal uses a still-valid token but never an expiring or expired one', async () => {
  let now = 1_000_000
  let calls = 0
  const credentials = new Credentials(
    config({auth: 'oidc', token: ''}),
    async () => {
      if (++calls === 1) return jwt(1300)
      throw new Error('private upstream response')
    },
    () => now,
    async () => {}
  )
  const first = await credentials.get()
  now += 241_000
  assert.equal(await credentials.get(), first)
  assert.equal(calls, 4)
  for (now of [1_291_000, 1_301_000]) {
    await assert.rejects(
      credentials.get(),
      /Could not obtain a GitHub OIDC token/
    )
  }
  assert.equal(calls, 10)
})

test('failed initial OIDC acquisition does not leak errors or fall back to a PAT', async () => {
  let calls = 0
  const credentials = new Credentials(
    config({auth: 'oidc', token: 'unused-pat'}),
    async () => {
      calls++
      throw new Error('private upstream response')
    },
    Date.now,
    async () => {}
  )
  await assert.rejects(credentials.get(), {
    message:
      'Could not obtain a GitHub OIDC token; check id-token: write permissions and issuer availability'
  })
  assert.equal(calls, 3)
})

test('aborting credential acquisition prevents subsequent retries', async () => {
  let calls = 0
  const controller = new AbortController()
  const credentials = new Credentials(
    config({auth: 'oidc', token: ''}),
    async () => {
      calls++
      controller.abort()
      throw new Error('network failure')
    },
    Date.now,
    async () => {
      assert.fail('must not back off after cancellation')
    }
  )
  await assert.rejects(credentials.get(controller.signal), {name: 'AbortError'})
  assert.equal(calls, 1)
})
