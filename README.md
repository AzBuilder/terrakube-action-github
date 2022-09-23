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
        TERRAKUBE_TEMPLATE: "vulnerability-snyk"
        TERRAKUBE_REPOSITORY: "https://github.com/AzBuilder/terraform-sample-repository.git"
        TERRAKUBE_ENDPOINT: "https://terrakube.interal/service"
        GITHUB_TOKEN: "xxxx"
```

## Variables

| Variable                         | Usage                                              |
| -------------------------------- | -------------------------------------------------- |
| TERRAKUBE_TOKEN (*)              | Terrakube Personal Access Token                    |
| TERRAKUBE_REPOSITORY (*)         | Terrakube git repository                           |
| TERRAKUBE_TEMPLATE (*)           | Terrakube template name                            |
| TERRAKUBE_ENDPOINT (*)           | Terrakbue api endpoint                             |
| GITHUB_TOKEN (*)                 | Github Token                                       |

_(*) = required variable._

## Configuration

Create a file called "terrakube.json" and include the terraform.tfvars

```
{
	"organization": "simple",
	"workspace": "workspace_demo",
	"workspaceSrc": "https://github.com/AzBuilder/terraform-sample-repository.git",
	"terraform": "1.2.9",
	"folder": "/workspace2"
}
```

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

