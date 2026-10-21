import * as core from '@actions/core'
import * as github from '@actions/github'

export interface Config {
  endpoint: string
  token: string
  auth: 'token' | 'oidc'
  audience: string
  organization: string
  template: string
  branch: string
  commit: string
  repository: string
  roots: string[]
  workspace: string
  workspaceId: string
  createWorkspace: boolean
  sshKey: string
  checkout: string
  timeoutMs: number
  requestTimeoutMs: number
  pollIntervalMs: number
  approval: 'wait' | 'fail'
  comment: 'off' | 'summary' | 'full'
  githubToken: string
  uiUrl: string
  ignoreSslError: boolean
}

function choice<T extends string>(
  name: string,
  values: readonly T[],
  fallback: T
): T {
  const value = core.getInput(name) || fallback
  if (!values.includes(value as T))
    throw new Error(`${name} must be ${values.join(' or ')}`)
  return value as T
}

function seconds(name: string, fallback: number, maximum: number): number {
  const value = Number(core.getInput(name) || fallback)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(
      `${name} must be an integer between 1 and ${maximum} seconds`
    )
  }
  return value * 1000
}

export function httpUrl(value: string, name: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be an HTTPS URL without credentials, query or fragment`
    )
  }
  return url.href.replace(/\/$/, '')
}

export function getActionInput(): Config {
  const token = core.getInput('TERRAKUBE_TOKEN')
  const githubToken = core.getInput('GITHUB_TOKEN')
  if (token) core.setSecret(token)
  if (githubToken) core.setSecret(githubToken)
  const auth = choice('TERRAKUBE_AUTH', ['token', 'oidc'], 'token')
  if (auth === 'token' && !token)
    throw new Error('TERRAKUBE_TOKEN is required for token authentication')
  if (auth === 'oidc' && token)
    throw new Error('Remove TERRAKUBE_TOKEN when using OIDC authentication')
  const audience = core.getInput('TERRAKUBE_OIDC_AUDIENCE')
  if (auth === 'oidc' && !audience)
    throw new Error(
      'TERRAKUBE_OIDC_AUDIENCE is required for OIDC authentication'
    )
  const commit = core.getInput('TERRAKUBE_COMMIT')
  if (commit && !/^[a-f\d]{40}$/i.test(commit))
    throw new Error('TERRAKUBE_COMMIT must be a full 40-character commit SHA')
  const roots = core.getMultilineInput('TERRAKUBE_ROOT')
  const workspace = core.getInput('TERRAKUBE_WORKSPACE')
  const workspaceId = core.getInput('TERRAKUBE_WORKSPACE_ID')
  if ((workspace || workspaceId) && roots.length !== 1)
    throw new Error(
      'Explicit workspace targeting requires exactly one TERRAKUBE_ROOT'
    )
  if (workspace && workspaceId)
    throw new Error(
      'Use TERRAKUBE_WORKSPACE or TERRAKUBE_WORKSPACE_ID, not both'
    )
  const legacy = core.getInput('SHOW_OUTPUT')
  const comment = choice(
    'COMMENT_MODE',
    ['off', 'summary', 'full'],
    !core.getInput('COMMENT_MODE') && legacy
      ? core.getBooleanInput('SHOW_OUTPUT')
        ? 'full'
        : 'off'
      : 'summary'
  )
  if (legacy)
    core.warning(
      'SHOW_OUTPUT is deprecated; COMMENT_MODE takes precedence when set. Use full only if publishing logs is intended.'
    )
  const ignoreSslError = core.getInput('IGNORE_SSL_ERROR')
    ? core.getBooleanInput('IGNORE_SSL_ERROR')
    : false
  if (ignoreSslError)
    core.warning(
      'TLS certificate verification is disabled for Terrakube requests. Prefer NODE_EXTRA_CA_CERTS for private CAs.'
    )
  const sshKey = core.getInput('TERRAKUBE_SSH_KEY_NAME')
  const server = new URL(github.context.serverUrl)
  return {
    endpoint: httpUrl(
      core.getInput('TERRAKUBE_ENDPOINT', {required: true}),
      'TERRAKUBE_ENDPOINT'
    ),
    token,
    auth,
    audience,
    organization: core.getInput('TERRAKUBE_ORGANIZATION', {required: true}),
    template: core.getInput('TERRAKUBE_TEMPLATE', {required: true}),
    branch:
      core.getInput('TERRAKUBE_BRANCH') ||
      github.context.payload.pull_request?.head?.ref ||
      github.context.ref.replace(/^refs\/heads\//, '') ||
      'main',
    commit: commit.toLowerCase(),
    repository: sshKey
      ? `git@${server.hostname}:${github.context.repo.owner}/${github.context.repo.repo}.git`
      : `${server.origin}/${github.context.repo.owner}/${github.context.repo.repo}.git`,
    roots,
    workspace,
    workspaceId,
    createWorkspace: core.getInput('CREATE_WORKSPACE')
      ? core.getBooleanInput('CREATE_WORKSPACE')
      : false,
    sshKey,
    checkout: process.env.GITHUB_WORKSPACE || process.cwd(),
    timeoutMs: seconds('TIMEOUT_SECONDS', 3600, 86400),
    requestTimeoutMs: seconds('REQUEST_TIMEOUT_SECONDS', 30, 300),
    pollIntervalMs: seconds('POLL_INTERVAL_SECONDS', 5, 300),
    approval: choice('APPROVAL_MODE', ['wait', 'fail'], 'wait'),
    comment,
    githubToken,
    uiUrl: core.getInput('TERRAKUBE_UI_URL')
      ? httpUrl(core.getInput('TERRAKUBE_UI_URL'), 'TERRAKUBE_UI_URL')
      : '',
    ignoreSslError
  }
}
