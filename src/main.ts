import * as core from '@actions/core'
import {getActionInput} from './userInput'
import {TerrakubeClient} from './terrakube'
import {discoverTargets} from './targets'
import {isSuccess, JobResult, runJobs} from './runner'
import {Feedback, jobSummary} from './feedback'
import {continueRun} from './operations'

export function outputs(results: JobResult[]): void {
  const jobs = results.filter(result => result.jobId)
  core.setOutput('JOB_ID', jobs.length === 1 ? jobs[0]?.jobId : '')
  core.setOutput('JOB_IDS', JSON.stringify(jobs.map(result => result.jobId)))
  core.setOutput('JOB_URL', jobs.length === 1 ? jobs[0]?.jobUrl || '' : '')
  core.setOutput(
    'HAS_CHANGES',
    results.some(result => result.status === 'planned')
      ? 'true'
      : results.length && results.every(result => result.status === 'noChanges')
        ? 'false'
        : ''
  )
  core.setOutput(
    'STATUS',
    !results.length
      ? 'skipped'
      : results.some(result => result.status === 'planned')
        ? 'planned'
        : results.every(isSuccess)
          ? 'completed'
          : results.some(result =>
                ['pending', 'running', 'queue', 'approved'].includes(
                  result.status
                )
              )
            ? 'running'
            : 'failed'
  )
  core.setOutput('JOBS', JSON.stringify(results))
}

async function run(): Promise<void> {
  let client: TerrakubeClient | undefined
  let results: JobResult[] = []
  let failure = ''
  let feedback: Feedback | undefined
  try {
    const config = getActionInput()
    const targets = await discoverTargets(config)
    if (!config.commit)
      core.warning(
        'TERRAKUBE_COMMIT is unset; execution follows the branch tip without revision verification'
      )
    if (!targets.length)
      core.info('No changes under discovered Terraform roots')
    else {
      const runClient = new TerrakubeClient(config)
      client = runClient
      const reporting = new Feedback(config)
      feedback = reporting
      const execute =
        config.operation === 'apply' || config.operation === 'discard'
          ? continueRun
          : runJobs
      results = await execute(
        config,
        targets,
        runClient,
        current => {
          results = current
          outputs(results)
        },
        async (result, document) => {
          await reporting.collect(result, runClient)
          await reporting.publish(result, document, runClient)
        }
      )
    }
    if (results.some(result => !isSuccess(result)))
      failure =
        'One or more Terrakube runs did not succeed. See the job summary and JOBS output.'
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Terrakube action failed'
  } finally {
    outputs(results)
    if (failure) core.setOutput('STATUS', 'failed')
    try {
      await core.summary
        .addRaw(jobSummary(results, failure, id => feedback?.planFor(id) || ''))
        .write()
    } catch {
      core.warning('Could not write the GitHub job summary')
    }
    await client?.close()
  }
  if (failure) core.setFailed(failure)
}

run().catch(() => core.setFailed('Terrakube action failed unexpectedly'))
