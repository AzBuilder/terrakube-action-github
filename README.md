# terrakube-action-github

Integrate Terrakube with GitHub Actions is easy and you can handle your workspace from GitHub.

The GIT repository will represent a Terrakube Organization and each folder inside the repository will be a new workspace.

There is an example available in the following [link](https://github.com/AzBuilder/terraform-sample-repository)

## Configuration

Add the following snippet to the script section of your github actions file:

### Pull Request example

To run a terraform plan using Terrakube templates use the following example:
> File: .github/workflows/pull_request.yml
```yaml
name: Terrakube Plan

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  build:
    runs-on: ubuntu-latest
    name: "Running Terrakube Plan"
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - uses: AzBuilder/terrakube-action-github@main
        with:
          TERRAKUBE_TOKEN:  ${{ secrets.TERRAKUBE_PAT }} 
          TERRAKUBE_TEMPLATE: "Terraform-Plan"
          TERRAKUBE_ENDPOINT: ${{ secrets.TERRAKUBE_ENDPOINT }}  
          TERRAKUBE_BRANCH: ${{ github.head_ref }}
          TERRAKUBE_ORGANIZATION: "terrakube_organization_name"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SHOW_OUTPUT: true

```
> A new workspace will be created for each folder with the file "terrakube.json". For each PR only new folders or folders that has been updated will be evaluated inside Terrakube.

### Push Main branch

To run a terraform apply using Terrakube templates use the following example:
> File: .github/workflows/push_main.yml
```yaml
name: Terrakube Apply

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    name: "Running Terrakube Apply"
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - uses: AzBuilder/terrakube-action-github@main
        with:
          TERRAKUBE_TOKEN:  ${{ secrets.TERRAKUBE_PAT }} 
          TERRAKUBE_TEMPLATE: "Terraform-Plan/Apply"
          TERRAKUBE_ENDPOINT: ${{ secrets.TERRAKUBE_GITPOD }}  
          TERRAKUBE_BRANCH: "main"
          TERRAKUBE_ORGANIZATION: "terrakube_organization_name"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SHOW_OUTPUT: false

```

## Terrakube Variables

To define terrakube variables to connect to cloud providers it is recommended to use Global Variables inside the organization using the UI.
Terraform variables could be define inside a terraform.tfvars inside each folder or you can define inside the Terrakube UI after the workspace creation.


## GitHub Action Inputs

| Variable                         | Usage                                              |
| -------------------------------- | -------------------------------------------------- |
| TERRAKUBE_TOKEN (*)              | Terrakube Personal Access Token                    |
| TERRAKUBE_TEMPLATE (*)           | Terrakube template name                            |
| TERRAKUBE_ENDPOINT (*)           | Terrakbue api endpoint                             |
| TERRAKUBE_ORGANIZATION (*)       | Terrakbue organization                             |
| TERRAKUBE_BRANCH (*)             | Github Branch when running a job                   |
| TERRAKUBE_SSH_KEY_NAME (*)       | ssh key name define in the terrakube organization to connect to private repositories  |
| GITHUB_TOKEN (*)                 | Github Token                                       |
| SHOW_OUTPUT (*)                  | Show terrakube logs inside PR comments             |

_(*) = required variable._

## Terraform Version Configuration

Create a file called "terrakube.json" and include the terraform version that will be used for the job execution

```
{
	"terraform": "1.2.9"
}
```

## Build GitHub Action

To build the github action in your local machine use the following.

```bash
git clone https://github.com/AzBuilder/terrakube-action-github.git
yarn install
yarn build
```

## Support
If you’d like help with this github action, or you have an issue or feature request, let us know.

If you’re reporting an issue, please include:

- the version of the github action
- relevant logs and error messages
- steps to reproduce

