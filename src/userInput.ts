import * as core from '@actions/core'

export interface GitHubActionInput{
    token: string,
    terrakubeEndpoint: string,
    terrakubeRepository: string,
    terrakubeTemplate: string,
    terrakubeOrganization: string,
    terrakubeFolder: string,
    githubToken: string,
    showOutput: boolean,
    branch: string
  }
  
export async function getActionInput(): Promise<any>{
    const terrakubeToken: string = core.getInput('terrakube_token', { required: true })
    core.debug(`Terrakube Token: ${terrakubeToken.substring(0,10)}****`)

    const terrakubeEndpoint: string = core.getInput('terrakube_endpoint', { required: true })
    core.debug(`Terrakube Endpoint: ${terrakubeEndpoint}`)

    const terrakubeRepository: string = core.getInput('terrakube_repository', { required: true })
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

    const githubToken: string = core.getInput('token', { required: true })
  
    const terrakubeActionInput:GitHubActionInput = {
      token: terrakubeToken,
      terrakubeEndpoint: terrakubeEndpoint,
      terrakubeRepository: terrakubeRepository,
      terrakubeTemplate: terrakubeTemplate,
      terrakubeOrganization: terrakubeOrganization,
      terrakubeFolder: terrakubeFolder,
      githubToken: githubToken,
      showOutput: showOutput,
      branch: terrakubeBranch
    }
  
    return terrakubeActionInput
  }