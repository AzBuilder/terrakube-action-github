import * as core from '@actions/core'

export interface GitHubActionInput {
  token: string,
  terrakubeEndpoint: string,
  terrakubeRepository: string,
  terrakubeTemplate: string,
  terrakubeOrganization: string,
  terrakubeFolder: string,
  terrakubeSshKeyName: string,
  githubToken: string,
  showOutput: boolean,
  branch: string,
  ignoreSslError: boolean
}

export async function getActionInput(): Promise<any> {
  const terrakubeToken: string = core.getInput('terrakube_token', { required: true })
  core.debug(`Terrakube Token: ${terrakubeToken.substring(0, 10)}****`)

  const terrakubeEndpoint: string = core.getInput('terrakube_endpoint', { required: true })
  core.debug(`Terrakube Endpoint: ${terrakubeEndpoint}`)

  const terrakubeSshKeyName = core.getInput('terrakube_ssh_key_name', { required: false })
  const server_url = core.getInput('server_url', { required: true })
  const git_repository = core.getInput('git_repository', { required: true })

  let terrakubeRepository = "";
  if (terrakubeSshKeyName.length > 0) {
    terrakubeRepository = `git@${new URL(server_url).hostname}:${git_repository}.git`
  } else {
    terrakubeRepository = `${server_url}/${git_repository}.git`
  }

  core.debug(`Terrakube Repository: ${terrakubeRepository}`)

  const terrakubeTemplate: string = core.getInput('terrakube_template', { required: true })
  core.debug(`Terrakube Template: ${terrakubeTemplate}`)

  const terrakubeBranch: string = core.getInput('terrakube_branch', { required: true })
  core.debug(`Terrakube Branch: ${terrakubeBranch}`)

  const terrakubeFolder: string = core.getInput('terrakube_folder', { required: true })
  core.debug(`Terrakube Folder: ${terrakubeFolder}`)

  const terrakubeOrganization: string = core.getInput('terrakube_organization', { required: true })
  core.debug(`Terrakube Organization: ${terrakubeOrganization}`)

  const showOutput: boolean = core.getBooleanInput('show_output', { required: true })
  core.debug(`Show Output Job: ${terrakubeOrganization}`)

  const githubToken: string = core.getInput('github_token', { required: true })

  const ignoreSslError = core.getInput('ignore_ssl_error', { required: true });
  core.debug(`Ignore SSL Error: ${terrakubeOrganization}`);

  const terrakubeActionInput: GitHubActionInput = {
    token: terrakubeToken,
    terrakubeEndpoint: terrakubeEndpoint,
    terrakubeRepository: terrakubeRepository,
    terrakubeTemplate: terrakubeTemplate,
    terrakubeOrganization: terrakubeOrganization,
    terrakubeFolder: terrakubeFolder,
    terrakubeSshKeyName: terrakubeSshKeyName,
    githubToken: githubToken,
    showOutput: showOutput,
    branch: terrakubeBranch,
    ignoreSslError: ignoreSslError
  }

  return terrakubeActionInput
}