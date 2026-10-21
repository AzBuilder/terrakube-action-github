import * as core from '@actions/core'
import {getActionInput} from './userInput'
import {TerrakubeClient} from './terrakube'
import {discoverTargets} from './targets'
import {isSuccess, JobResult, runJobs} from './runner'
import {escape, Feedback, resultMarkdown} from './feedback'

export function outputs(results: JobResult[]): void {
  const jobs = results.filter(result => result.jobId)
  core.setOutput('JOB_ID', jobs.length === 1 ? jobs[0]?.jobId : '')
  core.setOutput('JOB_IDS', JSON.stringify(jobs.map(result => result.jobId)))
  core.setOutput('JOB_URL', jobs.length === 1 ? jobs[0]?.jobUrl || '' : '')
  core.setOutput(
    'STATUS',
    !results.length
      ? 'skipped'
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
      const feedback = new Feedback(config)
      results = await runJobs(
        config,
        targets,
        runClient,
        current => {
          results = current
          outputs(results)
        },
        (result, document) => feedback.publish(result, document, runClient)
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
        .addRaw(
          `# Terrakube\n\n${results.length ? results.map(resultMarkdown).join('\n') : failure ? escape(failure) : 'No workspaces selected.'}\n`
        )
        .write()
    } catch {
      core.warning('Could not write the GitHub job summary')
    }
    await client?.close()
  }
  if (failure) core.setFailed(failure)
}

run().catch(() => core.setFailed('Terrakube action failed unexpectedly'))
