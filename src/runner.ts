import {Config} from './userInput'
import {Document, sleep, TerrakubeClient} from './terrakube'
import {Target, validateWorkspace} from './targets'

export interface JobResult {
  root: string
  workspace: string
  workspaceId?: string
  jobId?: string
  jobUrl?: string
  status: string
  requestedRevision?: string
  revision?: string
  error?: string
  remoteMayBeRunning?: boolean
}

const successes = new Set(['completed', 'noChanges'])
const failures = new Set(['failed', 'cancelled', 'rejected'])
const active = new Set([
  'pending',
  'approved',
  'queue',
  'running',
  'waitingApproval'
])

export function jobStatus(
  document: Document,
  config: Pick<Config, 'approval' | 'commit'>
): {status: string; done: boolean} {
  const status = document.data.attributes.status
  if (
    typeof status !== 'string' ||
    (!successes.has(status) && !failures.has(status) && !active.has(status))
  )
    throw new Error(`Unsupported Terrakube job status: ${String(status)}`)
  const steps = document.included || []
  if (steps.some(step => failures.has(String(step.attributes.status))))
    return {status: 'failed', done: true}
  if (failures.has(status)) return {status, done: true}
  const paused =
    status === 'waitingApproval' ||
    steps.some(step => step.attributes.status === 'waitingApproval')
  if (paused)
    return {status: 'waitingApproval', done: config.approval === 'fail'}
  if (config.commit && (status === 'running' || successes.has(status))) {
    const revision = document.data.attributes.commitId
    if (
      typeof revision !== 'string' ||
      revision.toLowerCase() !== config.commit
    )
      throw new Error(
        'Executed revision is missing or differs from TERRAKUBE_COMMIT; inspect the remote job before proceeding'
      )
  }
  if (successes.has(status)) {
    if (!steps.length) throw new Error('Completed job has no step results')
    if (
      steps.some(
        step =>
          !successes.has(String(step.attributes.status)) &&
          step.attributes.status !== 'notExecuted'
      )
    )
      throw new Error(
        'Completed job contains unfinished or unsupported step states'
      )
    return {status, done: true}
  }
  return {status, done: false}
}

export const isSuccess = (result: JobResult): boolean =>
  successes.has(result.status)

type Client = Pick<
  TerrakubeClient,
  'find' | 'orgRoute' | 'workspace' | 'createWorkspace' | 'createJob' | 'job'
>

export async function runJobs(
  config: Config,
  targets: Target[],
  client: Client,
  update: (results: JobResult[]) => void,
  feedback: (result: JobResult, document?: Document) => Promise<void>,
  pause = sleep,
  now = Date.now
): Promise<JobResult[]> {
  const results: JobResult[] = []
  const organization = await client.find(
    '/api/v1/organization',
    'organization',
    config.organization
  )
  if (!organization)
    throw new Error(`Organization not found: ${config.organization}`)
  const route = client.orgRoute(organization.id)
  const template = await client.find(
    `${route}/template`,
    'template',
    config.template
  )
  if (!template) throw new Error(`Template not found: ${config.template}`)
  for (const target of targets) {
    const result: JobResult = {
      root: target.root,
      workspace: target.name,
      requestedRevision: config.commit || undefined,
      status: 'pending'
    }
    results.push(result)
    let document: Document | undefined
    let submissionStarted = false
    let deadline = Infinity
    try {
      let workspace = target.id
        ? await client.workspace(organization.id, target.id)
        : await client.find(`${route}/workspace`, 'workspace', target.name)
      if (!workspace) {
        if (!config.createWorkspace)
          throw new Error(
            `Workspace ${target.name} not found; CREATE_WORKSPACE is disabled`
          )
        if (!target.version?.trim())
          throw new Error(
            `Workspace creation requires a terraform version in ${target.root}/terrakube.json`
          )
        let sshId: string | undefined
        if (config.sshKey) {
          const ssh = await client.find(`${route}/ssh`, 'ssh', config.sshKey)
          if (!ssh) throw new Error(`SSH key not found: ${config.sshKey}`)
          sshId = ssh.id
        }
        workspace = await client.createWorkspace(
          organization.id,
          target.name,
          target.root === '.' ? '/' : target.root,
          target.version,
          target.iacType,
          sshId
        )
      }
      validateWorkspace(workspace, target, config.repository)
      result.workspaceId = workspace.id
      result.workspace = String(workspace.attributes.name || target.name)
      submissionStarted = true
      deadline = now() + config.timeoutMs
      result.jobId = await client.createJob(
        organization.id,
        workspace.id,
        template.id,
        deadline
      )
      result.remoteMayBeRunning = true
      if (config.uiUrl)
        result.jobUrl = `${config.uiUrl}/organizations/${encodeURIComponent(organization.id)}/workspaces/${encodeURIComponent(workspace.id)}/runs/${encodeURIComponent(result.jobId)}`
      update(results) // Persist identity before polling, log access or comments can fail.
      while (true) {
        if (now() >= deadline) {
          result.status = 'timedOut'
          throw new Error('Polling deadline exceeded')
        }
        document = await client.job(organization.id, result.jobId, deadline)
        if (typeof document.data.attributes.commitId === 'string')
          result.revision = document.data.attributes.commitId
        const state = jobStatus(document, config)
        result.status = state.status
        if (state.done) {
          result.remoteMayBeRunning =
            !successes.has(String(document.data.attributes.status)) &&
            !failures.has(String(document.data.attributes.status))
          if (state.status === 'waitingApproval')
            result.error =
              'Job is waiting for approval in Terrakube; the action will not approve it'
          break
        }
        await pause(
          Math.min(config.pollIntervalMs, Math.max(0, deadline - now()))
        )
      }
    } catch (error) {
      result.status = now() >= deadline ? 'timedOut' : 'error'
      result.remoteMayBeRunning = submissionStarted
      result.error = `${error instanceof Error ? error.message : 'Terrakube execution failed'}${submissionStarted ? '. The remote job may still be running; inspect Terrakube before submitting again.' : ''}`
    }
    update(results)
    // Feedback errors must never change the execution result or stop other roots.
    try {
      await feedback(result, document)
    } catch {
      /* Reported by the feedback caller. */
    }
  }
  return results
}
