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
        TERRAKUBE_TOKEN: "xxxxxx" # Terrakube Personal Access Token
        TERRAKUBE_ORGANIZATION: "terrakube"
        TERRAKUBE_WORKSPACE: "bitbucket"
        TERRAKUBE_TEMPLATE: "vulnerability-snyk"
        TERRAKUBE_ENDPOINT: "https://terrakube.interal/service"
```
## Variables

| Variable                         | Usage                                              |
| -------------------------------- | -------------------------------------------------- |
| TERRAKUBE_TOKEN (*)              | Terrakube Personal Access Token                    |
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

