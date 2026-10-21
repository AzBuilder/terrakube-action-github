import {Config} from '../src/userInput'
import {Document, Resource} from '../src/terrakube'

export const sha = 'a'.repeat(40)
export const config = (overrides: Partial<Config> = {}): Config => ({
  endpoint: 'https://terrakube.example',
  token: 'test-token',
  auth: 'token',
  audience: '',
  organization: 'example',
  template: 'Any template',
  branch: 'feature',
  commit: sha,
  repository: 'https://github.com/example/repo.git',
  roots: ['infra'],
  workspace: '',
  workspaceId: '',
  createWorkspace: false,
  sshKey: '',
  checkout: process.cwd(),
  timeoutMs: 1000,
  requestTimeoutMs: 1000,
  pollIntervalMs: 5,
  approval: 'wait',
  comment: 'summary',
  githubToken: '',
  uiUrl: 'https://ui.example',
  ignoreSslError: false,
  ...overrides
})

export const item = (
  type: string,
  id: string,
  attributes: Record<string, unknown> = {}
): Resource => ({type, id, attributes})
export const job = (
  status: string,
  steps = ['completed'],
  revision = sha
): Document => ({
  data: {
    ...item('job', 'job-1', {status, commitId: revision}),
    relationships: {
      step: {data: steps.map((_, i) => ({id: `step-${i}`, type: 'step'}))}
    }
  },
  included: steps.map((status, i) =>
    item('step', `step-${i}`, {
      status,
      name: 'Plan',
      output: 'https://terrakube.example/logs/1'
    })
  )
})
