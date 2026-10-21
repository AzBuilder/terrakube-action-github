import {Config} from './userInput'
import {Document, sleep, TerrakubeClient} from './terrakube'
import {JobResult, jobStatus} from './runner'
import {Target, validateWorkspace} from './targets'
import {savedPlanTemplate, verifySavedRun} from './savedPlan'

type Client = Pick<
  TerrakubeClient,
  'find' | 'orgRoute' | 'workspace' | 'job' | 'transitionJob'
>

export async function continueRun(
  config: Config,
  targets: Target[],
  client: Client,
  update: (results: JobResult[]) => void,
  feedback: (result: JobResult, document?: Document) => Promise<void>,
  pause = sleep,
  now = Date.now
): Promise<JobResult[]> {
  if (targets.length !== 1 || !config.jobId || !config.commit)
    throw new Error(
      'Apply and discard require one target, an existing job ID and a commit'
    )
  const target = targets[0]!
  const result: JobResult = {
    root: target.root,
    workspace: target.name,
    jobId: config.jobId,
    requestedRevision: config.commit,
    status: 'pending'
  }
  const results = [result]
  update(results)
  let document: Document | undefined
  let deadline = Infinity
  let mutated = false
  try {
    const org = await client.find(
      '/api/v1/organization',
      'organization',
      config.organization
    )
    if (!org) throw new Error(`Organization not found: ${config.organization}`)
    const route = client.orgRoute(org.id)
    const template = await client.find(
      `${route}/template`,
      'template',
      config.template
    )
    if (!template) throw new Error(`Template not found: ${config.template}`)
    const numbers = savedPlanTemplate(template.attributes.tcl)
    const workspace = target.id
      ? await client.workspace(org.id, target.id)
      : await client.find(`${route}/workspace`, 'workspace', target.name)
    if (!workspace) throw new Error(`Workspace not found: ${target.name}`)
    validateWorkspace(workspace, target, config.repository)
    result.workspaceId = workspace.id
    result.workspace = String(workspace.attributes.name || target.name)
    if (config.uiUrl)
      result.jobUrl = `${config.uiUrl}/organizations/${encodeURIComponent(org.id)}/workspaces/${encodeURIComponent(workspace.id)}/runs/${encodeURIComponent(config.jobId)}`
    deadline = now() + config.timeoutMs
    document = await client.job(org.id, config.jobId, deadline)
    verifySavedRun(document, workspace.id, config.commit, template)
    result.revision = config.commit
    const status = String(document.data.attributes.status)
    if (status === 'waitingApproval') {
      const steps = document.included || []
      if (
        !['pending', 'waitingApproval'].includes(
          String(
            steps.find(step => step.attributes.stepNumber === numbers[1])
              ?.attributes.status
          )
        ) ||
        steps.find(step => step.attributes.stepNumber === numbers[2])
          ?.attributes.status !== 'pending'
      )
        throw new Error('Saved run is not paused before its apply step')
      mutated = true // A lost PATCH response must never result in a new submission.
      result.remoteMayBeRunning = true
      await client.transitionJob(
        org.id,
        config.jobId,
        config.operation === 'discard' ? 'rejected' : 'approved',
        deadline
      )
      document = await client.job(org.id, config.jobId, deadline)
    } else if (
      config.operation === 'discard' &&
      status !== 'rejected' &&
      status !== 'noChanges'
    ) {
      throw new Error('Only a run waiting for approval can be discarded')
    } else if (
      config.operation === 'apply' &&
      !['approved', 'running', 'completed', 'noChanges'].includes(status)
    ) {
      throw new Error(`Saved run cannot be applied from status ${status}`)
    }
    while (true) {
      if (now() >= deadline)
        throw new Error('Saved-run polling deadline exceeded')
      verifySavedRun(document, workspace.id, config.commit, template)
      if (
        config.operation === 'discard' &&
        document.data.attributes.status === 'rejected'
      ) {
        result.status = 'discarded'
        result.remoteMayBeRunning = false
        break
      }
      const state = jobStatus(document, {...config, approval: 'wait'})
      result.status = state.status
      result.remoteMayBeRunning = !state.done
      if (state.done) break
      update(results)
      await pause(
        Math.min(config.pollIntervalMs, Math.max(0, deadline - now()))
      )
      document = await client.job(org.id, config.jobId, deadline)
    }
  } catch (error) {
    result.status = now() >= deadline ? 'timedOut' : 'error'
    result.remoteMayBeRunning =
      mutated ||
      (!!document &&
        !['completed', 'noChanges', 'failed', 'rejected', 'cancelled'].includes(
          String(document.data.attributes.status)
        ))
    result.error = `${error instanceof Error ? error.message : 'Saved-run operation failed'}. Inspect the existing job before retrying.`
  }
  update(results)
  try {
    await feedback(result, document)
  } catch {
    // Feedback cannot change the result of an existing run.
  }
  return results
}
