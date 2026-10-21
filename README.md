# Terrakube GitHub Action

Run Terrakube templates from GitHub Actions. The action waits for execution, reports failures, and writes a job summary. It supports PAT and GitHub OIDC authentication, explicit workspace selection, and PR comments.

Version 2 requires **Terrakube 2.34.0 or later**.

## Usage

Run a plan against an existing workspace:

```yaml
name: Terrakube plan
on: pull_request
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: terrakube-${{ github.event.pull_request.number }}-example
  cancel-in-progress: true
jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 65
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - uses: terrakube-io/terrakube-action-github@v2.0.0
        id: terrakube
        with:
          TERRAKUBE_ENDPOINT: https://api.terrakube.example
          TERRAKUBE_ORGANIZATION: example
          TERRAKUBE_TEMPLATE: Terraform-Plan
          TERRAKUBE_TOKEN: ${{ secrets.TERRAKUBE_PAT }}
          TERRAKUBE_ROOT: infrastructure/example
          TERRAKUBE_WORKSPACE: example
          TERRAKUBE_UI_URL: https://terrakube.example
```

For stronger supply-chain protection, pin actions to a full commit SHA. Only run templates and repository code trusted to use the workspace's credentials. Fork PRs may lack credentials, comment permissions, or a commit reachable from the workspace repository. Do not check out untrusted PR code in a privileged `pull_request_target` workflow.

The action runs on Node 24 and includes its dependencies. Self-hosted runners need Node 24 action support (runner v2.327.1 or newer). Git is needed for change discovery. HTTPS proxy settings and `NODE_EXTRA_CA_CERTS` are supported.

## Inputs

| Input                     | Description                                                             | Default                                            |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `TERRAKUBE_ENDPOINT`      | Required HTTPS URL of the Terrakube API service                         |                                                    |
| `TERRAKUBE_ORGANIZATION`  | Required organization name                                              |                                                    |
| `TERRAKUBE_TEMPLATE`      | Required template name                                                  |                                                    |
| `TERRAKUBE_AUTH`          | `token` or `oidc`                                                       | `token`                                            |
| `TERRAKUBE_TOKEN`         | PAT; required for token authentication                                  |                                                    |
| `TERRAKUBE_OIDC_AUDIENCE` | Audience; required for OIDC authentication                              |                                                    |
| `TERRAKUBE_ROOT`          | Repository-relative root, or newline-separated roots                    | Change discovery                                   |
| `TERRAKUBE_WORKSPACE`     | Workspace name; requires one explicit root                              | Name in `terrakube.json`, otherwise directory name |
| `TERRAKUBE_WORKSPACE_ID`  | Workspace ID instead of a name; requires one explicit root              |                                                    |
| `TERRAKUBE_BRANCH`        | Branch to clone                                                         | PR head branch or current ref                      |
| `TERRAKUBE_COMMIT`        | Full commit SHA to execute and verify                                   | PR head SHA or event SHA                           |
| `CREATE_WORKSPACE`        | Allow creating missing workspaces                                       | `false`                                            |
| `TERRAKUBE_SSH_KEY_NAME`  | Existing SSH key for workspace creation and SSH repository matching     |                                                    |
| `TIMEOUT_SECONDS`         | Execution deadline per job, from submission through polling; 1–86400    | `3600`                                             |
| `REQUEST_TIMEOUT_SECONDS` | Request deadline, including response body; 1–300                        | `30`                                               |
| `POLL_INTERVAL_SECONDS`   | Delay between status reads; 1–300                                       | `5`                                                |
| `APPROVAL_MODE`           | `wait` for manual approval, or `fail` at an approval pause              | `wait`                                             |
| `COMMENT_MODE`            | `off`, `summary`, or `full`                                             | `summary`                                          |
| `GITHUB_TOKEN`            | Token for PR feedback                                                   | `${{ github.token }}`                              |
| `TERRAKUBE_UI_URL`        | Optional HTTPS UI URL for job links                                     |                                                    |
| `IGNORE_SSL_ERROR`        | Disable endpoint certificate verification; prefer `NODE_EXTRA_CA_CERTS` | `false`                                            |
| `SHOW_OUTPUT`             | Deprecated: `true` selects full logs, `false` disables comments         |                                                    |

An explicit `COMMENT_MODE` takes precedence over `SHOW_OUTPUT`. Token and OIDC authentication are mutually exclusive. Workspace name and ID inputs are mutually exclusive.

## Workspaces

Set `TERRAKUBE_ROOT` to run a root regardless of changed files. Use `.` for the repository root, or a YAML multiline string for several roots. An explicit existing workspace needs no `terrakube.json`.

Without explicit roots, the action discovers `terrakube.json` files. On PRs and pushes it selects roots containing changed files, including subdirectories. Use `fetch-depth: 0` with checkout for discovery. New branches and manual events select all discovered roots. Shared-module changes outside a root do not select that root; use explicit roots for those workflows.

Repository and root settings on existing workspaces must match the workflow. SSH and HTTPS URLs for the same repository are accepted. The action does not rewrite workspace settings. Roots execute sequentially, retain separate results, and fail the action if any run fails.

To create missing workspaces, set `CREATE_WORKSPACE: 'true'` and supply configuration in each root:

```json
{
  "workspace": "example",
  "terraform": "1.9.0",
  "iacType": "tofu"
}
```

`workspace` defaults to the directory name. `terraform` is required for creation and selects the Terraform/OpenTofu version. `iacType` is `terraform` (default) or `tofu`. Existing workspaces keep their engine and version. Templates are selected by name without restrictions.

## OIDC authentication

Grant the workflow `id-token: write`, remove `TERRAKUBE_TOKEN`, and set:

```yaml
TERRAKUBE_AUTH: oidc
TERRAKUBE_OIDC_AUDIENCE: api://terrakube
```

Configure a Terrakube federated credential with the GitHub issuer (`https://token.actions.githubusercontent.com` on GitHub.com), the same audience, and restrictive claims for the trusted repository and workflow. Match the actual `sub` value: subjects differ for PRs, branches and environments. Federated claim conditions use exact matching.

The federated credential's name must match the group of a Terrakube team with access to the organization, workspace, template and job operations. Workspace creation requires workspace management permission. The action never approves jobs and does not need approval permission.

Tokens come from `@actions/core.getIDToken` and are renewed 60 seconds before expiry. There is no PAT fallback. See [GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc).

OIDC relies on Terrakube's federated audience, external-token and scoped RBAC handling. Configure the issuer, audience, claim conditions and team permissions before enabling OIDC.

## Execution

The commit SHA is submitted as `job.commitId`, separately from `overrideBranch`. The action checks the server-reported revision; it fails if the revision is missing or different. Checkout should contain the same revision. An explicitly empty `TERRAKUBE_COMMIT` selects branch-tip execution and disables revision verification.

`completed` and `noChanges` succeed unless a step failed. Failed, cancelled and rejected jobs fail the action. Approval pauses follow `APPROVAL_MODE`; the action never approves automatically. Unknown states, unfinished successful results, ambiguous lookups and API errors fail clearly.

Eligible GET failures receive at most two retries. POST requests are not retried. Requests and polling have separate deadlines. The toolkit's OIDC request cannot be cancelled by the action and may finish after the authentication wait expires; set a workflow `timeout-minutes` as an additional limit.

**Stopping the action does not cancel the remote job.** Check the retained job ID before resubmitting. A lost submission response can leave a running job without a returned ID.

Revision verification relies on the server's report.

## Outputs

| Output    | Description                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `JOB_ID`  | Submitted ID when exactly one job exists; empty for multiple jobs                                                                  |
| `JOB_IDS` | JSON array of every submitted ID, written after each submission                                                                    |
| `JOB_URL` | Single-job link when `TERRAKUBE_UI_URL` is set                                                                                     |
| `STATUS`  | `running`, `completed`, `failed` or `skipped`                                                                                      |
| `JOBS`    | JSON array of results with root, workspace, job ID, status, requested/reported revision, errors and whether execution may continue |

Outputs retain submitted IDs after failures. Use `if: always()` in later steps to inspect failed runs. A job summary is written for successful, failed and skipped executions.

## PR feedback

`summary` posts status, revision and an optional job link without fetching logs. `off` skips comments and log requests. `full` publishes collapsed logs and a plan summary when unambiguous. Full logs can contain sensitive infrastructure details; enable them only when suitable for the PR's audience. Known action credentials are redacted, but arbitrary secrets in plan output cannot be detected reliably.

The action updates one marked `github-actions[bot]` comment per API/organization/workspace. Use the default GitHub token for comment ownership. Stale PR heads, older runs and older retry attempts are skipped. Workflows writing the same comment must share a concurrency group: GitHub comment updates are not atomic. Cancelling a workflow leaves remote jobs unchanged.

Feedback has a deadline of three request-timeout periods, examines at most 1,000 comments, fetches at most eight step logs, and caps comment size below GitHub's limit. Logs must come from the API origin; redirects are refused. Logs are not printed to the Actions console. Non-PR events skip comments, and comment errors do not change the execution result.

## Development

Use Node 24:

```sh
npm ci
npm run check
npm run build
npm run check-bundle
```

Commit `dist/` and `package-lock.json` with source changes. CI checks types, lint, formatting, tests and bundle consistency. Tests exercise the standalone bundle against an isolated HTTPS service and cover API errors, authentication, polling, workspace selection and PR feedback. No production credentials are needed.
