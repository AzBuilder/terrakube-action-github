import * as core from '@actions/core'

export interface GitHubActionInput{
    loginEndpoint: string,
    tenantId: string,
    applicationId: string,
    applicationSecret: string
    scope: string,
    terrakubeEndpoint: string,
    organization: string,
    workspace: string,
    template: string
  }
  
export async function getActionInput(): Promise<any>{
    const loginEndpoint: string = core.getInput('login_endpoint', { required: true })
    core.info(`Login Endpoint: ${loginEndpoint}`)
  
    const terrakubeTenantId: string = core.getInput('terrakube_tenant_id', { required: true })
    core.info(`Tenant Id: ${terrakubeTenantId}`)
  
    const terrakubeApplicationId: string = core.getInput('terrakube_application_id', { required: true })
    core.info(`Application Id: ${terrakubeApplicationId}`)
  
    const terrakubeApplicationSecret: string = core.getInput('terrakube_application_secret', { required: true })
    core.info(`Secret: ${terrakubeApplicationSecret.substring(0,5)}XXXXXXX`)

    const terrakubeEndpoint: string = core.getInput('terrakube_endpoint', { required: true })
    core.info(`Terrakube Endpoint: ${terrakubeEndpoint}`)

    const terrakubeApplicationScope: string = core.getInput('terrakube_application_scope', { required: true })
    core.info(`Terrakube Scope: ${terrakubeApplicationScope}`)

    const terrakubeOrganization: string = core.getInput('terrakube_organization', { required: true })
    core.info(`Terrakube Organization: ${terrakubeOrganization}`)

    const terrakubeWorkspace: string = core.getInput('terrakube_workspace', { required: true })
    core.info(`Terrakube Workspace: ${terrakubeWorkspace}`)

    const terrakubeTemplate: string = core.getInput('terrakube_template', { required: true })
    core.info(`Terrakube Template: ${terrakubeTemplate}`)
  
    const terrakubeActionInput:GitHubActionInput = {
      loginEndpoint: loginEndpoint,
      tenantId: terrakubeTenantId,
      applicationId: terrakubeApplicationId,
      applicationSecret: terrakubeApplicationSecret,
      scope: terrakubeApplicationScope,
      terrakubeEndpoint: terrakubeEndpoint,
      organization: terrakubeOrganization,
      workspace: terrakubeWorkspace,
      template: terrakubeTemplate
    }
  
    return terrakubeActionInput
  }