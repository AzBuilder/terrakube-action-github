import * as core from '@actions/core'
import {Config} from './userInput'

export class Credentials {
  private token = ''
  private expiresAt = 0
  private readonly secrets = new Set<string>()

  constructor(
    private readonly config: Pick<Config, 'auth' | 'token' | 'audience'>,
    private readonly getIDToken = core.getIDToken,
    private readonly now = Date.now
  ) {
    if (config.token) {
      core.setSecret(config.token)
      this.secrets.add(config.token)
    }
  }

  redact(text: string): string {
    for (const token of this.secrets) text = text.replaceAll(token, '***')
    return text
  }

  async get(): Promise<string> {
    if (this.config.auth === 'token') return this.config.token
    if (this.token && this.now() < this.expiresAt - 60_000) return this.token
    // JWT claims are used only to schedule renewal. Terrakube verifies the signature and claims.
    let token: string
    try {
      token = await this.getIDToken(this.config.audience)
    } catch {
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
