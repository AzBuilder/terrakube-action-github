import * as core from '@actions/core'
import * as github from '@actions/github'
import {createHash} from 'node:crypto'
import {stripVTControlCharacters} from 'node:util'
import {Config} from './userInput'
import {Document, TerrakubeClient} from './terrakube'
import {JobResult} from './runner'

export const escape = (value: string): string =>
  value.replace(
    /[&<>"'`@]/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
        '@': '&#64;'
      })[char] || char
  )

export function planSummary(logs: string[]): string | undefined {
  const summaries: string[] = []
  for (const log of logs) {
    for (const match of stripVTControlCharacters(log).matchAll(
      /^\s*(Plan: \d+ to add, \d+ to change, \d+ to destroy\.|No changes\. (?:Your infrastructure matches the configuration\.|Infrastructure is up-to-date\.))\s*$/gm
    )) {
      if (match[1]) summaries.push(match[1])
    }
  }
  return summaries.length === 1 ? summaries[0] : undefined
}

export function structuredPlan(
  context: Record<string, unknown>
): string | undefined {
  const status = context.structuredOutputStatus as {state?: unknown} | undefined
  if (status?.state !== 'PERSISTED') return
  const byStep = context.planStructuredOutput
  if (!byStep || typeof byStep !== 'object' || Array.isArray(byStep)) return
  const steps = Object.values(byStep)
  // A combined count for multiple plans could count the same resource twice.
  if (steps.length !== 1 || !Array.isArray(steps[0])) return
  let add = 0,
    change = 0,
    destroy = 0,
    imports = 0,
    outputs = 0,
    total = 0,
    shown = 0
  let rows = ''
  const icons: Record<string, string> = {
    create: '🟢',
    update: '🔵',
    delete: '🔴',
    replace: '🟠',
    import: '⬇️',
    read: '⚪'
  }
  for (const value of steps[0]) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.address !== 'string'
    )
      return
    const actions = value.actions
    let action = value.action
    if (
      Array.isArray(actions) &&
      actions.includes('create') &&
      actions.includes('delete')
    )
      action = 'replace'
    if (action === 'no-op') continue
    if (!Object.hasOwn(icons, action)) return
    if (value.isOutputChange === true) {
      outputs++
      continue
    }
    if (action === 'create' || action === 'replace') add++
    if (action === 'update') change++
    if (action === 'delete' || action === 'replace') destroy++
    if (action === 'import') imports++
    total++
    const address = escape(value.address.slice(0, 300))
      .replace(/\|/g, '&#124;')
      .replace(/[\r\n]/g, ' ')
    const row = `| ${icons[action]} | <code>${address}</code> | ${action} |\n`
    if (shown < 100 && Buffer.byteLength(rows + row) <= 20_000) {
      rows += row
      shown++
    }
  }
  return `\n**Plan: ${add} to add, ${change} to change, ${destroy} to destroy.${imports ? ` ${imports} to import.` : ''}**\n${outputs ? `\n${outputs} output change(s); values are shown only in Terrakube.\n` : ''}${rows ? `\n| | Resource | Action |\n|---|---|---|\n${rows}` : ''}${total > shown ? `\n${total - shown} more resource changes; see the Terrakube job for the complete plan.\n` : ''}`
}

export function resultMarkdown(result: JobResult, plan = ''): string {
  const job = result.jobUrl
    ? `<a href="${escape(result.jobUrl)}">Job ${escape((result.jobId || '').slice(0, 128))}</a>`
    : result.jobId
      ? `Job ${escape(result.jobId.slice(0, 128))}`
      : 'No job ID available'
  return `### Terrakube: ${escape(result.workspace.slice(0, 200))}\n\nStatus: **${escape(result.status)}** · Root: <code>${escape(result.root.slice(0, 500))}</code>\n\nRevision: <code>${escape((result.revision || result.requestedRevision || 'not reported').slice(0, 128))}</code> · ${job}\n${result.error ? `\n${escape(result.error.slice(0, 2000))}\n` : ''}${result.remoteMayBeRunning ? '\nThe remote job may still be running or waiting for approval.\n' : ''}${plan}`
}

export function jobSummary(
  results: JobResult[],
  failure: string,
  planFor: (id?: string) => string
): string {
  let body = '# Terrakube\n\n'
  if (!results.length)
    return body + (failure ? escape(failure) : 'No workspaces selected.')
  for (const [index, result] of results.entries()) {
    let block = resultMarkdown(result, planFor(result.jobId)) + '\n'
    if (Buffer.byteLength(body + block) > 900_000)
      block = resultMarkdown(result) + '\n'
    if (Buffer.byteLength(body + block) > 900_000)
      return (
        body +
        `\n${results.length - index} more workspace results; see JOBS output and Terrakube.\n`
      )
    body += block
  }
  return body
}

export function commentBody(
  result: JobResult,
  marker: string,
  runId: number,
  attempt: number,
  logs: {name: string; text: string}[],
  plan = ''
): string {
  const header = `${marker}\n<!-- run:${runId}:${attempt} -->\n${resultMarkdown(result, plan)}`
  const summary = plan
    ? undefined
    : result.status === 'noChanges'
      ? 'No changes.'
      : planSummary(logs.map(log => log.text))
  let body = `${header}${summary ? `\n**${escape(summary)}**\n` : ''}`
  const limit = 60_000
  for (const log of logs) {
    const open = `\n<details><summary>${escape(log.name.slice(0, 200))}</summary>\n\n<pre>`
    const close = '</pre>\n</details>\n'
    const text = escape(stripVTControlCharacters(log.text))
    const remaining = limit - Buffer.byteLength(body + open + close) - 200
    if (remaining <= 0) break
    // Bound bytes as well as characters; preserve complete HTML entities and UTF-8 characters.
    let snippet = ''
    let length = 0
    for (const part of text.match(/&[^;]+;|[^&]/gu) || []) {
      length += Buffer.byteLength(part)
      if (length > remaining) break
      snippet += part
    }
    body += `${open}${snippet}${snippet.length < text.length ? '\n[Truncated; see Terrakube for full output.]' : ''}${close}`
  }
  return body
}

export function newerRun(
  body: string,
  runId: number,
  attempt: number
): boolean {
  const match = body.match(/<!-- run:(\d+):(\d+) -->/)
  return (
    !!match &&
    (Number(match[1]) > runId ||
      (Number(match[1]) === runId && Number(match[2]) > attempt))
  )
}

type Octokit = ReturnType<typeof github.getOctokit>

export class Feedback {
  private readonly plans = new Map<string, string>()
  private readonly octokit?: Octokit
  private deadline = Infinity

  planFor(id?: string): string {
    return id ? this.plans.get(id) || '' : ''
  }

  async collect(
    result: JobResult,
    client: Pick<TerrakubeClient, 'context'>
  ): Promise<void> {
    if (
      !result.jobId ||
      !['planned', 'completed', 'noChanges'].includes(result.status)
    )
      return
    if (result.status === 'noChanges') {
      this.plans.set(result.jobId, '\n**No changes.**\n')
      return
    }
    try {
      const plan = structuredPlan(
        await client.context(
          result.jobId,
          Date.now() + this.config.requestTimeoutMs
        )
      )
      this.plans.set(
        result.jobId,
        plan ||
          '\nStructured plan details are unavailable; review the plan in Terrakube.\n'
      )
    } catch {
      this.plans.set(
        result.jobId,
        '\nStructured plan details are unavailable; review the plan in Terrakube.\n'
      )
      core.warning(
        'Structured plan details could not be read; execution status is unchanged'
      )
    }
  }

  constructor(
    private readonly config: Config,
    octokit?: Octokit
  ) {
    this.octokit =
      octokit ||
      (config.githubToken ? github.getOctokit(config.githubToken) : undefined)
    if (this.octokit && !octokit) {
      this.octokit.hook.wrap('request', async (request, options) => {
        const timeout = Math.min(
          config.requestTimeoutMs,
          this.deadline - Date.now()
        )
        if (timeout <= 0) throw new Error('PR feedback deadline exceeded')
        return request({
          ...options,
          request: {...options.request, signal: AbortSignal.timeout(timeout)}
        })
      })
    }
  }

  async publish(
    result: JobResult,
    document: Document | undefined,
    client: Pick<TerrakubeClient, 'logs'>
  ): Promise<void> {
    const pr = github.context.payload.pull_request
    if (this.config.comment === 'off' || !pr) return
    if (!this.octokit) {
      core.warning('PR feedback skipped: GITHUB_TOKEN is not set')
      return
    }
    this.deadline = Date.now() + this.config.requestTimeoutMs * 3
    try {
      const repo = github.context.repo
      const issue_number = pr.number
      if (!Number.isInteger(issue_number))
        throw new Error('PR number is unavailable')
      const {data: current} = await this.octokit.rest.pulls.get({
        ...repo,
        pull_number: issue_number
      })
      // Never let an older checkout update feedback for a newer PR revision.
      if (
        current.head.sha !== pr.head.sha ||
        (this.config.commit && this.config.commit !== current.head.sha)
      )
        return
      const marker = `<!-- terrakube-action:${createHash('sha256')
        .update(
          JSON.stringify([
            this.config.endpoint,
            this.config.organization,
            result.workspaceId || result.workspace
          ])
        )
        .digest('hex')} -->`
      let pages = 0
      const comments = await this.octokit.paginate(
        this.octokit.rest.issues.listComments,
        {...repo, issue_number, per_page: 100},
        (response, done) => {
          if (++pages >= 10 && response.headers.link?.includes('rel="next"')) {
            done()
            throw new Error(
              'Too many PR comments to locate an owned comment safely'
            )
          }
          return response.data
        }
      )
      const owned = comments.filter(
        comment =>
          comment.user?.login === 'github-actions[bot]' &&
          comment.body?.startsWith(marker)
      )
      const runId = github.context.runId
      const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1)
      if (owned.some(comment => newerRun(comment.body || '', runId, attempt)))
        return
      const logs: {name: string; text: string}[] = []
      if (this.config.comment === 'full') {
        let bytes = 0
        for (const step of (document?.included || []).slice(0, 8)) {
          const output = step.attributes.output
          if (typeof output !== 'string' || !output || bytes >= 128_000)
            continue
          try {
            if (Date.now() >= this.deadline) break
            const text = await client.logs(output, this.deadline)
            logs.push({name: String(step.attributes.name || 'Step'), text})
            bytes += Buffer.byteLength(text)
          } catch {
            core.warning(
              'A Terrakube step log could not be retrieved; job status is unchanged'
            )
          }
        }
      }
      const body = commentBody(
        result,
        marker,
        runId,
        attempt,
        logs,
        this.planFor(result.jobId)
      )
      // Re-check the PR after log reads. Workflow concurrency provides serialization across writers.
      const {data: latest} = await this.octokit.rest.pulls.get({
        ...repo,
        pull_number: issue_number
      })
      if (latest.head.sha !== current.head.sha) return
      const existing = owned[0]
      if (existing) {
        const {data: fresh} = await this.octokit.rest.issues.getComment({
          ...repo,
          comment_id: existing.id
        })
        if (newerRun(fresh.body || '', runId, attempt)) return
        await this.octokit.rest.issues.updateComment({
          ...repo,
          comment_id: existing.id,
          body
        })
      } else {
        await this.octokit.rest.issues.createComment({
          ...repo,
          issue_number,
          body
        })
      }
    } catch {
      core.warning(
        'PR feedback could not be updated; check token permissions. Terrakube execution status is unchanged.'
      )
    }
  }
}
