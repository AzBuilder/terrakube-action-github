import * as core from '@actions/core'
import {setTimeout as delay} from 'node:timers/promises'
import {Config} from './userInput'

export class Credentials {
  private token = ''
  private expiresAt = 0
  private readonly secrets = new Set<string>()

  constructor(
    private readonly config: Pick<Config, 'auth' | 'token' | 'audience'> &
      Partial<Pick<Config, 'variables'>>,
    private readonly getIDToken = core.getIDToken,
    private readonly now = Date.now,
    private readonly pause = (ms: number, signal?: AbortSignal) =>
      delay(ms, undefined, {signal})
  ) {
    for (const value of Object.values(config.variables || {}))
      for (const secret of [value, ...value.split(/\r?\n/)])
        if (secret) {
          this.secrets.add(secret)
          this.secrets.add(JSON.stringify(secret).slice(1, -1))
        }
    if (config.token) {
      core.setSecret(config.token)
      this.secrets.add(config.token)
    }
  }

  redact(text: string): string {
    for (const token of [...this.secrets].sort((a, b) => b.length - a.length))
      text = text.replaceAll(token, '***')
    return text
  }

  async get(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.config.auth === 'token') return this.config.token
    if (this.token && this.now() < this.expiresAt - 60_000) return this.token
    // JWT claims are used only to schedule renewal. Terrakube verifies the signature and claims.
    let token: string | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted()
      try {
        token = await this.getIDToken(this.config.audience)
        signal?.throwIfAborted()
        break
      } catch {
        signal?.throwIfAborted()
        if (attempt < 2) await this.pause(1000 * 2 ** attempt, signal)
      }
    }
    if (token === undefined) {
      // Keep polling through a failed proactive renewal, allowing for clock skew.
      if (this.token && this.now() < this.expiresAt - 10_000) return this.token
      throw new Error(
        'Could not obtain a GitHub OIDC token; check id-token: write permissions and issuer availability'
      )
    }
    core.setSecret(token)
    this.secrets.add(token)
    let exp: unknown
    try {
      exp = (
        JSON.parse(
          Buffer.from(token.split('.')[1] || '', 'base64url').toString()
        ) as {exp?: unknown}
      ).exp
    } catch {
      throw new Error('GitHub returned an invalid OIDC token')
    }
    if (
      typeof exp !== 'number' ||
      !Number.isFinite(exp) ||
      exp * 1000 <= this.now() + 60_000
    ) {
      throw new Error('GitHub OIDC token is expired or too close to expiry')
    }
    this.token = token
    this.expiresAt = exp * 1000
    return token
  }
}
