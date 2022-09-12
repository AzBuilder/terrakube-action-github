import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as exec from '@actions/exec'
import { GitHubActionInput, getActionInput } from './userInput'
import { TerrakubeClient } from './terrakube'
import { readFile } from 'fs/promises'

async function run(): Promise<void> {
  try {
    const githubActionInput: GitHubActionInput = await getActionInput()
    const terrakubeClient = new TerrakubeClient(githubActionInput)

    const patterns = ['**/terrakube.json']
    const globber = await glob.create(patterns.join('\n'))
    const currentDirectory = await getCurrentDirectory();
    console.debug(`Processing: ${currentDirectory}`)
    for await (const file of globber.globGenerator()) {
      console.debug(`Processing: ${file}`)
      const terrakubeData = JSON.parse(await readFile(`${file}`, "utf8"));
      terrakubeData.respository = await getRepository();
      terrakubeData.folder = file.replace(currentDirectory,'')
      core.debug(`Loaded JSON: ${JSON.stringify(terrakubeData)}`)
      core.info(`Organization: ${terrakubeData.organization}`)
      core.info(`Workspace: ${terrakubeData.workspace}`)
      core.info(`Folder: ${terrakubeData.folder}`)

      Object.keys(terrakubeData.variables).forEach(key => {
        console.log('Key : ' + key + ', Value : ' + terrakubeData.variables[key])
      })

      core.info(`Running Worspace ${terrakubeData.workspace} with Template ${githubActionInput.terrakubeTemplate}`)
      const organizationId = await terrakubeClient.getOrganizationId(terrakubeData.organization);

      if (organizationId !== "") { 
        const workspaceId = await terrakubeClient.getWorkspaceId(organizationId,terrakubeData.workspace)

        if (workspaceId !== "") { 
          const templateId = await terrakubeClient.getTemplateId(organizationId, githubActionInput.terrakubeTemplate)

          const jobId = await terrakubeClient.getJobId(organizationId, workspaceId, templateId)

          Object.keys(terrakubeData.variables).forEach(key => {
            setupVariable(terrakubeClient, organizationId, workspaceId, key, terrakubeData.variables[key]);
          })

          
          core.debug(`JobId: ${jobId}`)
          core.setOutput(`Organization: ${terrakubeData.organization} Workspace: ${terrakubeData.workspace} Job`, jobId);
        } else {
          core.error(`Workspace not found: ${terrakubeData.workspace} in Organization: ${terrakubeData.organization}`)
        }
      } else {
        core.error(`Organization not found: ${terrakubeData.organization} in Endpoint: ${githubActionInput.terrakubeEndpoint}`)
      }
    }

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function setupVariable(terrakubeClient: TerrakubeClient, organizationId: string, workspaceId: string, key: string, value: string) {

}


async function getRepository(): Promise<any>{
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

async function getCurrentDirectory(): Promise<any>{
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