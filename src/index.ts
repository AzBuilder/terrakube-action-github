import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as exec from '@actions/exec'
import * as httpm from '@actions/http-client'
import * as github from '@actions/github'
import Convert from 'ansi-to-html'
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
    const currentDirectory = await getCurrentDirectory()
    console.debug(`Processing: ${currentDirectory}`)
    core.info(`Changed Directory: ${githubActionInput.terrakubeFolder}`)
    for await (const file of globber.globGenerator()) {
      const terrakubeData = JSON.parse(await readFile(`${file}`, "utf8"))

      const parentFolder = path.basename(path.dirname(file))
      core.info(`Folder ${parentFolder} change: ${githubActionInput.terrakubeFolder.split(" ").indexOf(parentFolder)}`)

      //Folder with terrakube.json file change
      if (githubActionInput.terrakubeFolder.split(" ").indexOf(parentFolder) > -1) {
        core.startGroup(`Execute Workspace ${parentFolder}`)

        console.debug(`Processing: ${file}`)


        core.debug(`Loaded JSON: ${JSON.stringify(terrakubeData)}`)
        core.info(`Organization: ${githubActionInput.terrakubeOrganization}`)
        core.info(`Workspace: ${parentFolder}`)
        core.info(`Folder: /${parentFolder}`)
        core.info(`Branch: ${githubActionInput.branch}`)

        core.info(`Running Workspace ${parentFolder} with Template ${githubActionInput.terrakubeTemplate}`)
        core.info(`Checking if workspace ${parentFolder}`)
        const organizationId = await terrakubeClient.getOrganizationId(githubActionInput.terrakubeOrganization);


        if (organizationId !== "") {
          //let updateJob = false

          let workspaceId = await terrakubeClient.getWorkspaceId(organizationId, parentFolder)

          if (workspaceId === "") {
            core.info(`Creating new workspace ${parentFolder}`)
            workspaceId = await terrakubeClient.createWorkspace(organizationId, parentFolder, terrakubeData.terraform, `/${parentFolder}`, githubActionInput.terrakubeRepository, githubActionInput.branch)
            //updateJob = true
          }

          core.info(`Searching template ${githubActionInput.terrakubeTemplate}`)
          const templateId = await terrakubeClient.getTemplateId(organizationId, githubActionInput.terrakubeTemplate)

          if (templateId !== "") {
            core.info(`Using template id ${templateId}`)
            /*
            for await (const key of Object.keys(terrakubeData.variables)) {
              const updateVar = await setupVariable(
                terrakubeClient,
                organizationId,
                workspaceId,
                key,
                terrakubeData.variables[key]
              )
  
              if (updateVar && !updateJob) {
                updateJob = true;
              }
            }*/

            //core.info(`Update Job: ${updateJob}`)
            //if (updateJob) {
            core.info(`Creating new job: `)
            const jobId = await terrakubeClient.createJobId(organizationId, workspaceId, templateId)
            core.debug(`JobId: ${jobId}`)


            await checkTerrakubeLogs(terrakubeClient, githubActionInput.githubToken, organizationId, jobId)

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

async function checkTerrakubeLogs(terrakubeClient: TerrakubeClient, githubToken: string, organizationId: string, jobId: string) {
  let jobRunning = true

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
  const httpClient = new httpm.HttpClient();
  const jobSteps = jobResponseJson.included
  core.info(`${Object.keys(jobSteps).length}`)

  let finalComment = ""
  const convert = new Convert();
  for (let index = 0; index < Object.keys(jobSteps).length; index++) {

    core.startGroup(`Running ${jobSteps[index].attributes.name}`)


    const response: httpm.HttpClientResponse = await httpClient.get(`${jobSteps[index].attributes.output}`)

    const body: string = await response.readBody()
    core.info(body)
    core.endGroup()

    const convert = new Convert();
    const commentBody = `Running ${jobSteps[index].attributes.name} \n${convert.toHtml(body)}\n `

    finalComment = finalComment.concat(commentBody)
  }

  core.info("Setup client")
  const octokit = github.getOctokit(githubToken)

  core.info("Getting payload")
  const pull_request = github.context.payload;



  core.info("Send message")
  await octokit.rest.issues.createComment({
    ...github.context.repo,
    issue_number: pull_request.number,
    body: `${finalComment}`
  });

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


async function getRepository(): Promise<any> {
  let repository = '';
  let errorGitCommand = '';

  let options: exec.ExecOptions = {};
  options.listeners = {
    stdout: (data: Buffer) => {
      repository += data.toString();
    },
    stderr: (data: Buffer) => {
      errorGitCommand += data.toString();
    }
  };

  await exec.exec('git', ['config', '--get', 'remote.origin.url'], options);

  return repository;
}

async function getCurrentDirectory(): Promise<any> {
  let repository = '';
  let errorGitCommand = '';

  let options: exec.ExecOptions = {};
  options.listeners = {
    stdout: (data: Buffer) => {
      repository += data.toString();
    },
    stderr: (data: Buffer) => {
      errorGitCommand += data.toString();
    }
  };

  await exec.exec('pwd', [], options);

  return repository;
}

run()