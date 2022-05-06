# terrakube-action-github

This is an example to show how easy is to integrate Terrakube with GitHub Actions.

## YAML Definition

Add the following snippet to the script section of your github actions file:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
       VERSION: ${{ github.event.release.tag_name }}
    steps:
    - uses: actions/checkout@v3
    - uses: AzBuilder/terrakube-action-github@1.0.0
      with:
        LOGIN_ENDPOINT: "https://login.microsoftonline.com"
        TERRAKUBE_TENANT_ID: "36857254-c824-409f-96f5-d3f2de37b016"
        TERRAKUBE_APPLICATION_ID: "36857254-c824-409f-96f5-d3f2de37b016"
        TERRAKUBE_APPLICATION_SECRET: "SuperSecret"
        TERRAKUBE_APPLICATION_SCOPE: "api://TerrakubeApp/.default"
        TERRAKUBE_ORGANIZATION: "terrakube"
        TERRAKUBE_WORKSPACE: "bitbucket"
        TERRAKUBE_TEMPLATE: "vulnerability-snyk"
        TERRAKUBE_ENDPOINT: "https://terrakube.interal/service"
```
## Variables

| Variable                         | Usage                                              |
| -------------------------------- | -------------------------------------------------- |
| LOGIN_ENDPOINT (*)               | Default values: https://login.microsoftonline.com  |
| TERRAKUBE_TENANT_ID (*)          | Azure AD Application tenant ID                     |
| TERRAKUBE_APPLICATION_ID (*)     | Azure AD Application tenant ID                     |
| TERRAKUBE_APPLICATION_SECRET (*) | Azure AD Application tenant ID                     |
| TERRAKUBE_APPLICATION_SCOPE      | Default value: api://Terrakube/.default            |
| TERRAKUBE_ORGANIZATION (*)       | Terrakube organization name                        |
| TERRAKUBE_WORKSPACE (*)          | Terrakube workspace name                           |
| TERRAKUBE_TEMPLATE (*)           | Terrakube template name                            |
| TERRAKUBE_ENDPOINT (*)           | Terrakbue api endpoint                             |

_(*) = required variable._

## Test Locally

This can be used to test the github action in your local machine.

```bash
git clone https://github.com/AzBuilder/terrakube-action-github.git
yarn install
```

After cloning the project update the file ***__tests__*** with the environment variales

```bash
yarn test
```

## Support
If you’d like help with this github action, or you have an issue or feature request, let us know.

If you’re reporting an issue, please include:

- the version of the github action
- relevant logs and error messages
- steps to reproduce

