import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as httpm from '@actions/http-client'
import * as github from '@actions/github'
import { GitHubActionInput, getActionInput } from './userInput'
import { TerrakubeClient } from './terrakube'
import { readFile } from 'fs/promises'
import path from 'path'

async function run(): Promise<void> {
  try {
    const githubActionInput: GitHubActionInput = await getActionInput()
    const terrakubeClient = new TerrakubeClient(githubActionInput)

    const patterns = ['**/terrakube.json']
    const globber = await glob.create(patterns.join('\n'))

    core.info(`Changed Directory: ${githubActionInput.terrakubeFolder}`)
    for await (const file of globber.globGenerator()) {
      const terrakubeData = JSON.parse(await readFile(`${file}`, "utf8"))

      const workspaceFolder = path.basename(path.dirname(file))
      const isFolderChanged = githubActionInput.terrakubeFolder.split(" ").indexOf(workspaceFolder) > -1;
      core.info(`Folder ${workspaceFolder} was_changed: ${isFolderChanged}`);
      const workspaceName = terrakubeData.workspace && terrakubeData.workspace.trim() !== ""
          ? terrakubeData.workspace : workspaceFolder;


      //Folder with terrakube.json file change
      if (isFolderChanged) {
        core.startGroup(`Execute Workspace ${workspaceName}`);

        console.debug(`Processing: ${file}`)


        core.debug(`Loaded JSON: ${JSON.stringify(terrakubeData)}`)
        core.info(`Organization: ${githubActionInput.terrakubeOrganization}`)
        core.info(`Workspace: ${workspaceName}`)
        core.info(`Folder: /${workspaceFolder}`)
        core.info(`Branch: ${githubActionInput.branch}`)

        core.info(`Running Workspace ${workspaceName} with Template ${githubActionInput.terrakubeTemplate}`)
        core.info(`Checking if workspace ${workspaceName}`)
        const organizationId = await terrakubeClient.getOrganizationId(githubActionInput.terrakubeOrganization);


        if (organizationId !== "") {
          let workspaceId = await terrakubeClient.getWorkspaceId(organizationId, workspaceName)
          if (workspaceId === "") {
            core.info(`Creating new workspace ${workspaceName}`)

            let sshId = ""
            if (githubActionInput.terrakubeSshKeyName !== "") {
              core.info(`Searching SSH ${githubActionInput.terrakubeSshKeyName}`)
              sshId = await terrakubeClient.getSshId(organizationId, githubActionInput.terrakubeSshKeyName)
              core.info(`Ssh Id: ${sshId}`)
            }

            workspaceId = await terrakubeClient.createWorkspace(organizationId, workspaceName, terrakubeData.terraform, `/${workspaceName}`, githubActionInput.terrakubeRepository, githubActionInput.branch, sshId)
          }

          core.info(`Searching template ${githubActionInput.terrakubeTemplate}`)
          const templateId = await terrakubeClient.getTemplateId(organizationId, githubActionInput.terrakubeTemplate)

          if (templateId !== "") {
            core.info(`Using template id ${templateId}`)

            core.info(`Creating new job: `)
            const jobId = await terrakubeClient.createJobId(organizationId, workspaceId, templateId)
            core.debug(`JobId: ${jobId}`)


            await checkTerrakubeLogs(terrakubeClient, githubActionInput.githubToken, organizationId, jobId, workspaceName, githubActionInput.showOutput)

          } else {
            core.error(`Template not found: ${githubActionInput.terrakubeTemplate} in Organization: ${githubActionInput.terrakubeOrganization}`)
          }


        } else {
          core.error(`Organization not found: ${githubActionInput.terrakubeOrganization} in Endpoint: ${githubActionInput.terrakubeEndpoint}`)
        }
        core.endGroup();
      }

    }


  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkTerrakubeLogs(terrakubeClient: TerrakubeClient, githubToken: string, organizationId: string, jobId: string, workspaceFolder: string, show_output: boolean) {
  let jobResponse = await terrakubeClient.getJobData(organizationId, jobId)
  let jobResponseJson = JSON.parse(jobResponse)

  while (jobResponseJson.data.attributes.status !== "completed" && jobResponseJson.data.attributes.status !== "failed") {
    await sleep(5000)
    jobResponse = await terrakubeClient.getJobData(organizationId, jobId)
    jobResponseJson = JSON.parse(jobResponse)
    core.debug("Waiting for job information...")

  }

  core.info(`${jobResponse}`)
  core.info(`${JSON.stringify(jobResponseJson.included)}`)
  const httpClient = terrakubeClient.getHttpClient();
  const jobSteps = jobResponseJson.included
  core.info(`${Object.keys(jobSteps).length}`)

  let finalComment = `## Workspace: \`${workspaceFolder}\` Status: \`${jobResponseJson.data.attributes.status.toUpperCase()}\` \n`;
  for (let index = 0; index < Object.keys(jobSteps).length; index++) {

    core.startGroup(`Running ${jobSteps[index].attributes.name}`)

    const response: httpm.HttpClientResponse = await httpClient.get(`${jobSteps[index].attributes.output}`, {
      'Authorization': `Bearer ${terrakubeClient.getAuthToken()}`
  });

    let body: string = await response.readBody()
    core.info(body)
    core.endGroup()

    //const convert = new Convert();
    //const commentBody = `Logs from step: ${jobSteps[index].attributes.name} \`\`\`\n${convert.toHtml(body)}\n\`\`\` `

    if (show_output) {
      body = body.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      body = body.replace(/^(\s*)\+/gm, '+$1');
      const commentBody = `\n ## Logs: ${jobSteps[index].attributes.name} status ${jobSteps[index].attributes.status} \n \`\`\`diff\n${body}\n\`\`\` `;
      finalComment = finalComment.concat(commentBody)
    }

  }

  if (show_output) {
    core.info("Setup Octoki client")
    const octokit = github.getOctokit(githubToken)

    core.info("Getting payload")
    const pull_request = github.context.payload;

    core.info("Send message")
    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: pull_request.number,
      body: `${finalComment}`
    });
  }

  if (jobResponseJson.data.attributes.status === "completed") {
    return true
  } else {
    return false
  }


}

async function setupVariable(terrakubeClient: TerrakubeClient, organizationId: string, workspaceId: string, key: string, value: string) {

  const variableId = await terrakubeClient.getVariableId(organizationId, workspaceId, key)

  if (variableId === "") {
    await terrakubeClient.createVariable(organizationId, workspaceId, key, value)
    return true
  } else {
    const variableData = await terrakubeClient.getVariableById(organizationId, workspaceId, variableId)

    if (variableData.data.attributes.value === value) {
      return false
    } else {
      await terrakubeClient.updateVariableById(organizationId, workspaceId, variableId, value)
      return true
    }
  }
}

run()