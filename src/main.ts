import * as core from '@actions/core'
import { wait } from './wait'
import { GitHubActionInput, getActionInput } from './userInput'
import { TerrakubeClient } from './terrakube'

async function run(): Promise<void> {
  try {
    const ms: string = core.getInput('milliseconds')
    core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true

    core.debug(new Date().toTimeString())
    await wait(parseInt(ms, 10))
    core.debug(new Date().toTimeString())

    core.setOutput('time', new Date().toTimeString())

    const githubActionInput: GitHubActionInput = await getActionInput()
    const terrakubeClient = new TerrakubeClient(githubActionInput)
    const organizationId = await terrakubeClient.getOrganizationId()
    const workspaceId = await terrakubeClient.getWorkspaceId(organizationId)
    const templateId = await terrakubeClient.getTemplateId(organizationId)
    const jobId = await terrakubeClient.getJobId(organizationId, workspaceId, templateId)

    core.setOutput('Job', jobId)

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()