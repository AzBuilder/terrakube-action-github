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

export function resultMarkdown(result: JobResult): string {
  const job = result.jobUrl
    ? `<a href="${escape(result.jobUrl)}">Job ${escape((result.jobId || '').slice(0, 128))}</a>`
    : result.jobId
      ? `Job ${escape(result.jobId.slice(0, 128))}`
      : 'No job ID available'
  return `### Terrakube: ${escape(result.workspace.slice(0, 200))}\n\nStatus: **${escape(result.status)}** · Root: <code>${escape(result.root.slice(0, 500))}</code>\n\nRevision: <code>${escape((result.revision || result.requestedRevision || 'not reported').slice(0, 128))}</code> · ${job}\n${result.error ? `\n${escape(result.error.slice(0, 2000))}\n` : ''}${result.remoteMayBeRunning ? '\nThe remote job may still be running or waiting for approval.\n' : ''}`
}

export function commentBody(
  result: JobResult,
  marker: string,
  runId: number,
  attempt: number,
  logs: {name: string; text: string}[]
): string {
  const header = `${marker}\n<!-- run:${runId}:${attempt} -->\n${resultMarkdown(result)}`
  const summary =
    result.status === 'noChanges'
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
  private readonly octokit?: Octokit
  private deadline = Infinity

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
      const body = commentBody(result, marker, runId, attempt, logs)
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
