import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import { GitHubActionInput } from './userInput';

export class TerrakubeClient {

    private httpClient: httpm.HttpClient;
    private authenticationToken: string;
    private gitHubActionInput: GitHubActionInput;

    constructor(gitHubActionInput: GitHubActionInput) {
        this.httpClient = new httpm.HttpClient();
        this.gitHubActionInput = gitHubActionInput;
        this.authenticationToken = 'empty'

        core.info(`Creating Terrakube CLient....`)
        core.info(`Endpoint: ${gitHubActionInput.terrakubeEndpoint}`)
        core.info(`Repository: ${gitHubActionInput.terrakubeRepository}`)
        core.info(`Template: ${gitHubActionInput.terrakubeTemplate}`)
    }

    async getOrganizationId(organizationName: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = this.gitHubActionInput.token
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${organizationName}`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${organizationName}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.debug(`Response size: ${terrakubeResponse.data.length}`)

        if (terrakubeResponse.data.length === 0) { 
            return ""
        }else{
            core.debug(`Organization Id: ${terrakubeResponse.data[0].id}`)

            return terrakubeResponse.data[0].id
        }
    }

    async getWorkspaceId(organizationId: string, workspaceName: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = this.authenticationToken = this.gitHubActionInput.token
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${workspaceName}"`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${workspaceName}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.debug(`Response size: ${terrakubeResponse.data.length}`)

        if (terrakubeResponse.data.length === 0) { 
            return ""
        }else{
            core.info(`Workspace Id: ${terrakubeResponse.data[0].id}`)

        return terrakubeResponse.data[0].id
        }
    }

    async getTemplateId(organizationId: string, templateName: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = this.authenticationToken = this.gitHubActionInput.token
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${templateName}`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${templateName}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.debug(`Response size: ${terrakubeResponse.data.length}`)

        if (terrakubeResponse.data.length === 0) { 
            return ""
        }else{
            core.info(`Template Id: ${terrakubeResponse.data[0].id}`)

            return terrakubeResponse.data[0].id
        }
    
    }

    async getVariableId(organizationId: string, workspaceId: string, variableName: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = this.authenticationToken = this.gitHubActionInput.token
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workkspace/${workspaceId}/variable?filter[variable]=key==${variableName}`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workkspace/${workspaceId}/variable?filter[variable]=key==${variableName}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.debug(`Response size: ${terrakubeResponse.data.length}`)

        if (terrakubeResponse.data.length === 0) { 
            return ""
        }else{
            core.info(`Variable Id: ${terrakubeResponse.data[0].id}`)

            return terrakubeResponse.data[0].id
        }
    
    }

    async getJobId(organizationId: string, workspaceId: string, templateId: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = this.authenticationToken = this.gitHubActionInput.token
        }

        const requestBody = {
            "data": {
              "type": "job",
              "attributes": {
                "templateReference": templateId
              },
              "relationships":{
                  "workspace":{
                      "data":{
                          "type": "workspace",
                          "id": workspaceId
                      }
                  }
              }
            }
          }

        core.debug(`POST ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job`)
        core.debug(`${JSON.stringify(requestBody)}`)

        const response: httpm.HttpClientResponse = await this.httpClient.post(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/job`,
            JSON.stringify(requestBody),
            {
                'Authorization': `Bearer ${this.authenticationToken}`,
                'Content-Type': 'application/vnd.api+json'
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.debug(JSON.stringify(terrakubeResponse))

        return terrakubeResponse.data.id
    }


}