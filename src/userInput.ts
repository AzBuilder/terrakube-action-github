import * as core from '@actions/core'

export interface GitHubActionInput{
    token: string,
    terrakubeEndpoint: string,
    terrakubeRepository: string,
    terrakubeTemplate: string,
    githubToken: string
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

    const githubToken: string = core.getInput('token', { required: true })
  
    const terrakubeActionInput:GitHubActionInput = {
      token: terrakubeToken,
      terrakubeEndpoint: terrakubeEndpoint,
      terrakubeRepository: terrakubeRepository,
      terrakubeTemplate: terrakubeTemplate,
      githubToken: githubToken
    }
  
    return terrakubeActionInput
  }