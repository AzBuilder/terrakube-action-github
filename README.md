# Terrakube GitHub Action

Run Terrakube templates from GitHub Actions. The action waits for execution, reports failures, and writes a job summary. It supports PAT and GitHub OIDC authentication, explicit workspace selection, and PR comments.

Version 2 requires **Terrakube 2.34.0 or later**.

**Self-hosted runners must use Actions runner v2.327.1 or later for the bundled Node 24 runtime.** No separate Node installation is needed. See [GitHub’s Node 24 action requirements](https://github.com/actions/setup-node#breaking-changes-in-v5).

## Usage

Choose [OIDC](#oidc) or a [personal access token](#token). Both examples run a plan against an existing workspace.

### OIDC

This workflow plans changes from a pull request using GitHub OIDC. Follow the [Terrakube setup](#github-oidc) below, then replace the example URLs, organization, template and workspace with your own values. No Terrakube token secret is needed.

```yaml
name: Terrakube plan
on: pull_request
permissions:
  contents: read
  pull-requests: write
  id-token: write
concurrency:
  group: terrakube-${{ github.event.pull_request.number }}-example
  cancel-in-progress: true
jobs:
  plan:
    if: github.event.pull_request.head.repo.full_name == github.repository
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
          TERRAKUBE_AUTH: oidc
          TERRAKUBE_OIDC_AUDIENCE: api://terrakube
          TERRAKUBE_ROOT: infrastructure/example
          TERRAKUBE_WORKSPACE: example
          TERRAKUBE_UI_URL: https://terrakube.example
```

### Token

Create a Terrakube PAT and store it as the GitHub Actions secret `TERRAKUBE_PAT`. See [token setup](#personal-access-token) for access requirements. Replace the example URLs, organization, template and workspace with your own values.

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
    if: github.event.pull_request.head.repo.full_name == github.repository
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
          TERRAKUBE_AUTH: token
          TERRAKUBE_TOKEN: ${{ secrets.TERRAKUBE_PAT }}
          TERRAKUBE_ROOT: infrastructure/example
          TERRAKUBE_WORKSPACE: example
          TERRAKUBE_UI_URL: https://terrakube.example
```

For stronger supply-chain protection, pin actions to a full commit SHA. Only run templates and repository code trusted to use the workspace's credentials. Fork PRs may lack credentials, comment permissions, or a commit reachable from the workspace repository. Do not check out untrusted PR code in a privileged `pull_request_target` workflow.

Selecting a plan template does not make the execution identity read-only. Keep PR credentials separate from production apply credentials, including the provider credentials available to the Terrakube executor.

The action runs on Node 24 and includes its dependencies. Git is needed for change discovery. HTTPS proxy settings and `NODE_EXTRA_CA_CERTS` are supported.

## Inputs

| Input                        | Description                                                             | Default                                            |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `TERRAKUBE_ENDPOINT`         | Required HTTPS URL of the Terrakube API service                         |                                                    |
| `TERRAKUBE_ORGANIZATION`     | Required organization name                                              |                                                    |
| `TERRAKUBE_TEMPLATE`         | Required template name                                                  |                                                    |
| `TERRAKUBE_AUTH`             | `token` or `oidc`                                                       | `token`                                            |
| `TERRAKUBE_TOKEN`            | PAT; required for token authentication                                  |                                                    |
| `TERRAKUBE_OIDC_AUDIENCE`    | Audience; required for OIDC authentication                              |                                                    |
| `TERRAKUBE_ROOT`             | Repository-relative root, or newline-separated roots                    | Change discovery                                   |
| `TERRAKUBE_WORKSPACE`        | Workspace name; requires one explicit root                              | Name in `terrakube.json`, otherwise directory name |
| `TERRAKUBE_WORKSPACE_ID`     | Workspace ID instead of a name; requires one explicit root              |                                                    |
| `TERRAKUBE_BRANCH`           | Branch to execute                                                       | PR head branch or current ref                      |
| `TERRAKUBE_WORKSPACE_BRANCH` | Default branch for newly created workspaces                             | Repository default, PR base, or `main`             |
| `TERRAKUBE_COMMIT`           | Full commit SHA to execute and verify                                   | PR head SHA or event SHA                           |
| `TERRAKUBE_VARIABLE_NAMES`   | Names to forward from `TF_VAR_<name>`, one per line                     |                                                    |
| `CREATE_WORKSPACE`           | Allow creating missing workspaces                                       | `false`                                            |
| `TERRAKUBE_SSH_KEY_NAME`     | Existing SSH key for workspace creation and SSH repository matching     |                                                    |
| `TIMEOUT_SECONDS`            | Execution deadline per job, from submission through polling; 1–86400    | `3600`                                             |
| `REQUEST_TIMEOUT_SECONDS`    | Request deadline, including response body; 1–300                        | `30`                                               |
| `POLL_INTERVAL_SECONDS`      | Delay between status reads; 1–300                                       | `5`                                                |
| `APPROVAL_MODE`              | `wait` for manual approval, or `fail` at an approval pause              | `wait`                                             |
| `COMMENT_MODE`               | `off`, `summary`, or `full`                                             | `summary`                                          |
| `GITHUB_TOKEN`               | Token for PR feedback                                                   | `${{ github.token }}`                              |
| `TERRAKUBE_UI_URL`           | Optional HTTPS UI URL for job links                                     |                                                    |
| `IGNORE_SSL_ERROR`           | Disable endpoint certificate verification; prefer `NODE_EXTRA_CA_CERTS` | `false`                                            |
| `SHOW_OUTPUT`                | Deprecated: `true` selects full logs, `false` disables comments         |                                                    |

`TERRAKUBE_OPERATION` defaults to `run`. Set it to `plan`, `apply` or `discard` for the staged workflow below. All staged operations require one explicit root, an existing workspace and a full commit SHA. Apply and discard also require a numeric `TERRAKUBE_JOB_ID`.

An explicit `COMMENT_MODE` takes precedence over `SHOW_OUTPUT`. Token and OIDC authentication are mutually exclusive. Workspace name and ID inputs are mutually exclusive.

## Per-run Terraform variables

Set `TERRAKUBE_VARIABLE_NAMES` to the names you want to forward, without the
`TF_VAR_` prefix. Only those variables leave the runner. For example, add this to
an action step that already specifies its endpoint, authentication, template,
root and workspace:

```yaml
env:
  TF_VAR_snowflake_private_key: ${{ secrets.SNOWFLAKE_PRIVATE_KEY }}
  TF_VAR_snowflake_account: ${{ vars.SNOWFLAKE_ACCOUNT }}
with:
  TERRAKUBE_VARIABLE_NAMES: |
    snowflake_private_key
    snowflake_account
```

This requires backend support advertised by `/execution/v1/capabilities`
(`jobVariables: true`); the action refuses to submit when support cannot be
verified.

Use one explicit root and workspace. Values belong to that job and do not update
workspace variables. Supply them on `run` or `plan`; `apply` resumes the same job
and saved plan without accepting new values. A missing environment variable fails
before submission; a defined empty string is valid. The limit is 100 names and
64 KiB of JSON-encoded values.

Values use ordinary [`TF_VAR_*` syntax](https://developer.hashicorp.com/terraform/language/values/variables#environment-variables): strings are raw, including PEM newlines;
complex values use Terraform expressions such as `TF_VAR_regions: '["eu-west-1"]'`.
Do not wrap strings in literal HCL quotes as a TFE run-variable helper might do.
The backend passes them as `TF_VAR_*`, replacing matching workspace or template
variables. Terraform variable files and explicit CLI `-var` arguments still take
precedence.

Read secrets before the action step. GitHub environment secrets are available
only to jobs referencing that environment after its approval rules pass; a
separate approval job does not make them available to the plan job. Secrets
from AWS Secrets Manager can be loaded in the plan job and forwarded this way. Mark secret Terraform inputs `sensitive = true`; Terraform
can still store them in plan and state files, so protect Terrakube storage too.

## Workspaces

Set `TERRAKUBE_ROOT` to run a root regardless of changed files. Use `.` for the repository root, or a YAML multiline string for several roots. An explicit existing workspace needs no `terrakube.json`.

Without explicit roots, the action discovers `terrakube.json` files. On PRs and pushes it selects roots containing changed files, including subdirectories. Use `fetch-depth: 0` with checkout for discovery. For example, when omitting `TERRAKUBE_ROOT`, configure checkout as follows:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    fetch-depth: 0
    persist-credentials: false
```

New branches and manual events select all discovered roots. Shared-module changes outside a root do not select that root; use explicit roots for those workflows.

Repository and root settings on existing workspaces must match the workflow. SSH and HTTPS URLs for the same repository are accepted. The action does not rewrite workspace settings. Roots execute sequentially, retain separate results, and fail the action if any run fails.

To create missing workspaces, set `CREATE_WORKSPACE: 'true'` and supply configuration in each root. New workspaces track the repository's default branch, falling back to the PR base branch or `main`. Set `TERRAKUBE_WORKSPACE_BRANCH` to choose another durable default. `TERRAKUBE_BRANCH` only selects the branch for the current job; existing workspace defaults are unchanged.

Example `terrakube.json`:

```json
{
  "workspace": "example",
  "terraform": "1.9.0",
  "iacType": "tofu"
}
```

`workspace` defaults to the directory name. `terraform` is required for creation and selects the Terraform/OpenTofu version. `iacType` is `terraform` (default) or `tofu`. Existing workspaces keep their engine and version. Templates are selected by name without restrictions.

## Authentication

The action authenticates to the Terrakube API. Terrakube still needs its own VCS credentials to clone a private repository, and its executor needs provider credentials to run Terraform or OpenTofu. Checkout credentials and the action's OIDC token do not configure those connections.

### GitHub OIDC

To give the PR workflow access to Terrakube:

- Create a team such as `github-actions-plan` in the target organization. Grant it access to the intended workspace, permission to read the template, and permission to create and view plan jobs. Keep production apply credentials separate.
- Ask a Terrakube superuser to open **Organization settings → Federated Credentials** and add a credential. Set its **Team name** to `github-actions-plan`, exactly matching the team above. Federated trust is instance-wide, so check that the same team name does not grant unintended access in other organizations.
- Set **Issuer URL** to `https://token.actions.githubusercontent.com` for GitHub.com and **Audience** to `api://terrakube`, matching the workflow's `TERRAKUBE_OIDC_AUDIENCE`.
- Add exact claim conditions: `repository` = `example/infrastructure` (your GitHub owner/repository) and `event_name` = `pull_request` for the usage example. Use a separate credential for deployment, restricted to the main branch or protected environment. Wildcards are not supported.
- Check that the workspace points to the same repository and root as the workflow, has VCS access to clone the repository, and has the provider credentials needed to plan. Confirm the named template exists, then open a trusted PR to test the connection.

If you restrict access by `sub`, match the actual GitHub subject. Name-based examples are `repo:example/infrastructure:pull_request` for PRs and `repo:example/infrastructure:environment:production` for the production environment below. Immutable or customized subjects differ. See [GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) and [Terrakube's federated identity guide](https://docs.terrakube.io/user-guide/organizations/federated-identity).

Grant the workflow `id-token: write` and omit `TERRAKUBE_TOKEN`. Tokens are renewed 60 seconds before expiry. Failed token requests are retried within the request deadline; a failed renewal can keep using the previous token while it has more than 10 seconds left. Expired tokens are never reused, and authentication failures do not fall back to a PAT.

### Personal access token

Create a Terrakube PAT with access to the intended workspace and job operations, then store it as the GitHub Actions secret `TERRAKUBE_PAT`. Use it with `TERRAKUBE_AUTH: token` as shown in the [token workflow](#token).

Token authentication does not need `id-token: write`. `GITHUB_TOKEN` is used for PR feedback and cannot replace a Terrakube PAT.

## Plan and apply with GitHub approval

Use `TERRAKUBE_OPERATION: plan` to prepare a saved plan, then `apply` with its `JOB_ID` after GitHub approves the production job. Both invocations must name the same template and existing workspace, and use the same commit. The plan stays in Terrakube; nothing needs uploading to GitHub as a plan artifact.

Create a dedicated Terrakube template containing one plan, one approval and one apply, in that order:

```yaml
flow:
  - type: terraformPlan
    step: 100
  - type: approval
    team: github-actions-apply
    step: 200
  - type: terraformApply
    step: 300
    requireSavedPlan: true
```

You can add policy evaluation, scanning, cost estimation or notification steps around this sequence. Use unique, increasing step numbers and keep `requireSavedPlan: true` on apply. Before releasing approval, the action requires every preceding step to have succeeded and every following step to be pending. Additional plan, approval, apply or destroy steps and `ignoreError: true` are rejected.

The approval step holds the run until the GitHub-approved apply job releases it through the API. There is no second human approval in Terrakube. Keep this template unchanged while plans are pending: the action checks the template reference and step sequence, but the API does not expose the job's private workflow snapshot. The executor fails if the saved plan cannot be loaded; Terraform/OpenTofu rejects a stale plan.

```yaml
name: Terrakube deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  id-token: write
concurrency:
  group: terrakube-production-example
  cancel-in-progress: false
jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 65
    outputs:
      job-id: ${{ steps.terrakube.outputs.JOB_ID }}
      has-changes: ${{ steps.terrakube.outputs.HAS_CHANGES }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
      - uses: terrakube-io/terrakube-action-github@v2.0.0
        id: terrakube
        with:
          TERRAKUBE_OPERATION: plan
          TERRAKUBE_ENDPOINT: https://api.terrakube.example
          TERRAKUBE_ORGANIZATION: example
          TERRAKUBE_TEMPLATE: GitHub Plan and Apply
          TERRAKUBE_AUTH: oidc
          TERRAKUBE_OIDC_AUDIENCE: api://terrakube
          TERRAKUBE_ROOT: infrastructure/example
          TERRAKUBE_WORKSPACE: example
          TERRAKUBE_COMMIT: ${{ github.sha }}
          TERRAKUBE_UI_URL: https://terrakube.example
  apply:
    needs: plan
    if: needs.plan.outputs.has-changes == 'true'
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 65
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
      - uses: terrakube-io/terrakube-action-github@v2.0.0
        with:
          TERRAKUBE_OPERATION: apply
          TERRAKUBE_JOB_ID: ${{ needs.plan.outputs.job-id }}
          TERRAKUBE_ENDPOINT: https://api.terrakube.example
          TERRAKUBE_ORGANIZATION: example
          TERRAKUBE_TEMPLATE: GitHub Plan and Apply
          TERRAKUBE_AUTH: oidc
          TERRAKUBE_OIDC_AUDIENCE: api://terrakube
          TERRAKUBE_ROOT: infrastructure/example
          TERRAKUBE_WORKSPACE: example
          TERRAKUBE_COMMIT: ${{ github.sha }}
          TERRAKUBE_UI_URL: https://terrakube.example
```

Configure required reviewers and branch restrictions on GitHub's `production` environment before running this workflow. Give the plan identity plan-only permissions. Map a separate OIDC credential to the apply team, restricted to the repository, main branch and production environment. GitHub requests that identity only after the environment gate passes. Environment reviewer availability depends on your [GitHub plan](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

A no-change plan skips apply. `TERRAKUBE_OPERATION: discard`, with the same job ID, template, workspace and commit, rejects a paused run without applying it. Discard requires Terrakube approval permission too; do not give that permission to the plan identity merely to automate cleanup. If GitHub approval is denied or the workflow is cancelled, discard the held run in Terrakube or through a separately authorized cleanup workflow before starting another deployment.

Keep dependent deployments in this workflow, with `needs: apply` and an explicit no-change path where appropriate. For example, schemachange must wait for Terraform to succeed. Keep one workflow concurrency group across the whole deployment. GitHub keeps only one pending run per group by default; use its [queue configuration](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) if every deployment must run.

GitHub concurrency does not lock a Terrakube workspace. Configure remote job serialization and state locking, and resolve outstanding jobs before retrying. For shared modules, set roots explicitly so module changes run affected workspaces. Use a bounded matrix only for independent workspaces.

## Execution

The commit SHA is submitted as `job.commitId`, separately from `overrideBranch`. The action checks the server-reported revision; it fails if the revision is missing or different. Checkout should contain the same revision. An explicitly empty `TERRAKUBE_COMMIT` selects branch-tip execution and disables revision verification.

`completed` and `noChanges` succeed unless a step failed. Failed, cancelled and rejected jobs fail the action. `run` follows `APPROVAL_MODE` at a pause. `plan` returns successfully with `STATUS: planned` at its gate; only an explicit `apply` invocation releases that saved run. Unknown states, unfinished successful results, ambiguous lookups and API errors fail clearly.

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

`HAS_CHANGES` is intended for `TERRAKUBE_OPERATION: plan`: it is `true` when a staged plan is ready to apply and `false` for `noChanges`. Standard `run` executions that finish as `completed` leave it empty, even if a plan found changes. `STATUS` can also be `planned`; a successful discard has `status: discarded` in `JOBS`.

Outputs retain submitted IDs after failures. Use `if: always()` in later steps to inspect failed runs. A job summary is written for successful, failed and skipped executions.

To keep a recovery record, add these steps after the action step with `id: terrakube`:

```yaml
- name: Write Terrakube job record
  if: always()
  env:
    TERRAKUBE_JOBS: ${{ steps.terrakube.outputs.JOBS }}
  shell: bash
  run: printf '%s\n' "$TERRAKUBE_JOBS" > "$RUNNER_TEMP/terrakube-jobs.json"
- uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
  if: always()
  with:
    name: terrakube-jobs-${{ github.run_id }}-${{ github.run_attempt }}
    path: ${{ runner.temp }}/terrakube-jobs.json
    retention-days: 30
```

The record contains job results and IDs, without fetching plan logs. A cancelled runner may not reach these steps; use the action's summary and Terrakube job history when recovering a run.

## PR feedback

`summary` posts status, revision, a job link and structured plan changes when available, without fetching raw logs. The same structured plan appears in the GitHub job summary, including when comments are off. Resource values are never copied into the table. Tables show at most 100 resource changes within a 20 KB row budget; totals include every change and omitted rows link back to Terrakube. Multiple plan steps or unavailable structured data are not reported as zero changes. `off` skips comments and log requests. `full` publishes collapsed logs and a plan summary when unambiguous. Full logs can contain sensitive infrastructure details; enable them only when suitable for the PR's audience. Known action credentials are redacted, but arbitrary secrets in plan output cannot be detected reliably.

The action updates one marked comment per API/organization/workspace for the authenticated GitHub identity, including custom GitHub Apps and service accounts. It leaves other authors’ comments alone. Stale PR heads, older runs and older retry attempts are skipped. Workflows writing the same comment must share a concurrency group: GitHub comment updates are not atomic. Cancelling a workflow leaves remote jobs unchanged.

Feedback has a deadline of three request-timeout periods, examines at most 1,000 comments, fetches at most eight step logs, and caps comment size below GitHub's limit. Canonical step log URLs are routed through `TERRAKUBE_ENDPOINT`, including its path prefix, so runners can use an internal API address. Only Terrakube log paths are accepted; credentials are never sent to the host named in the step URL, and redirects are refused. Logs are not printed to the Actions console. Non-PR events skip comments, and comment errors do not change the execution result.

## Development

Use Node 24:

```sh
npm ci
npm run check
npm run build
npm run check-bundle
```

Commit `dist/` and `package-lock.json` with source changes. CI checks types, lint, formatting, tests and bundle consistency. Tests exercise the standalone bundle against an isolated HTTPS service and cover API errors, authentication, polling, workspace selection and PR feedback. No production credentials are needed.
