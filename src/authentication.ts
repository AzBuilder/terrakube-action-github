import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import * as qs from 'query-string'

interface AzureAdToken {
  token_type: string,
  expires_in: number,
  ext_expires_in: number,
  access_token: string,
  error?: string,
  scope?: string
}

export async function getAuthenticationToken(loginEndpoint: string, terrakubeTenantId: string, terrakubeApplicationId: string, terrakubeApplicationSecret: string, terrakubeScope: string): Promise<any> {
  const httpClient = new httpm.HttpClient()

  core.info('Generating Azure Ad Body')
  core.info(`grant_type=client_credentials&client_id=${terrakubeApplicationId}&client_secret=${terrakubeApplicationSecret.substring(0, 3)}XXXXXXXX&scope=${encodeURIComponent(terrakubeScope)}`)

  const postData = qs.stringify({
    'grant_type': 'client_credentials',
    'client_id': terrakubeApplicationId,
    'scope': terrakubeScope,
    'client_secret': terrakubeApplicationSecret
  });

  const res: httpm.HttpClientResponse = await httpClient.post(
    `${loginEndpoint}/${terrakubeTenantId}/oauth2/v2.0/token`,
    postData,
    { 'content-type': 'application/x-www-form-urlencoded' }
  )

  core.debug('Azure Ad Response received')

  const body: string = await res.readBody()
  const azureAdToken: AzureAdToken = JSON.parse(body)

  if (typeof azureAdToken.error === "undefined") {
    core.debug(`Returning new Token ${azureAdToken.access_token.substring(0, 25)}XXXXXX`)
    return azureAdToken.access_token
  } else {
    core.debug(azureAdToken.error)
  }
}