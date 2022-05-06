import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import { getAuthenticationToken } from './authentication'
import { GitHubActionInput } from './userInput';

export class TerrakubeClient {

    private httpClient: httpm.HttpClient;
    private authenticationToken: string;
    private gitHubActionInput: GitHubActionInput;

    constructor(gitHubActionInput: GitHubActionInput) {
        this.httpClient = new httpm.HttpClient();
        this.gitHubActionInput = gitHubActionInput;
        this.authenticationToken = 'empty'
    }

    async getOrganizationId(): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = await getAuthenticationToken(
                this.gitHubActionInput.loginEndpoint,
                this.gitHubActionInput.tenantId,
                this.gitHubActionInput.applicationId,
                this.gitHubActionInput.applicationSecret,
                this.gitHubActionInput.scope)
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${this.gitHubActionInput.organization}`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization?filter[organization]=name==${this.gitHubActionInput.organization}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.info(`Organization Id: ${terrakubeResponse.data[0].id}`)

        return terrakubeResponse.data[0].id
    }

    async getWorkspaceId(organizationId: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = await getAuthenticationToken(
                this.gitHubActionInput.loginEndpoint,
                this.gitHubActionInput.tenantId,
                this.gitHubActionInput.applicationId,
                this.gitHubActionInput.applicationSecret,
                this.gitHubActionInput.scope)
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${this.gitHubActionInput.workspace}"`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/workspace?filter[workspace]=name==${this.gitHubActionInput.workspace}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.info(`Workspace Id: ${terrakubeResponse.data[0].id}`)

        return terrakubeResponse.data[0].id
    }

    async getTemplateId(organizationId: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = await getAuthenticationToken(
                this.gitHubActionInput.loginEndpoint,
                this.gitHubActionInput.tenantId,
                this.gitHubActionInput.applicationId,
                this.gitHubActionInput.applicationSecret,
                this.gitHubActionInput.scope)
        }

        core.debug(`GET ${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${this.gitHubActionInput.template}`)

        const response: httpm.HttpClientResponse = await this.httpClient.get(
            `${this.gitHubActionInput.terrakubeEndpoint}/api/v1/organization/${organizationId}/template?filter[template]=name==${this.gitHubActionInput.template}`,
            {
                'Authorization': `Bearer ${this.authenticationToken}`
            }
        )

        const body: string = await response.readBody()
        const terrakubeResponse = JSON.parse(body)

        core.info(`Template Id: ${terrakubeResponse.data[0].id}`)

        return terrakubeResponse.data[0].id
    }

    async getJobId(organizationId: string, workspaceId: string, templateId: string): Promise<any> {
        if (this.authenticationToken === 'empty') {
            this.authenticationToken = await getAuthenticationToken(
                this.gitHubActionInput.loginEndpoint,
                this.gitHubActionInput.tenantId,
                this.gitHubActionInput.applicationId,
                this.gitHubActionInput.applicationSecret,
                this.gitHubActionInput.scope)
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