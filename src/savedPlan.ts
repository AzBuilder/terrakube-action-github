import {parse} from 'yaml'
import {Document, Resource} from './terrakube'

export interface SavedPlanTemplate {
  plan: number
  approval: number
  apply: number
  steps: number[]
}

// Hooks may surround the plan and apply, but the approval boundary stays unique.
export function savedPlanTemplate(value: unknown): SavedPlanTemplate {
  if (typeof value !== 'string' || !value || value.length > 1_000_000)
    throw new Error('Saved-plan template is missing or too large')
  try {
    const parsed = parse(Buffer.from(value, 'base64').toString('utf8'), {
      maxAliasCount: 0
    })
    const flow: Record<string, unknown>[] = parsed?.flow
    if (!Array.isArray(flow) || flow.length < 3) throw new Error()
    if (
      flow.some(
        (step, index) =>
          !step ||
          typeof step.type !== 'string' ||
          !step.type ||
          ['terraformDestroy', 'terraformPlanDestroy'].includes(step.type) ||
          !Number.isSafeInteger(step.step) ||
          Number(step.step) < 1 ||
          step.ignoreError === true ||
          (index > 0 && Number(step.step) <= Number(flow[index - 1]?.step))
      )
    )
      throw new Error()
    const required = ['terraformPlan', 'approval', 'terraformApply'].map(
      type => {
        const matches = flow.filter(step => step.type === type)
        if (matches.length !== 1) throw new Error()
        return matches[0]!
      }
    )
    const [plan, approval, apply] = required.map(step => Number(step.step)) as [
      number,
      number,
      number
    ]
    if (
      plan >= approval ||
      approval >= apply ||
      required[2]!.requireSavedPlan !== true
    )
      throw new Error()
    return {plan, approval, apply, steps: flow.map(step => Number(step.step))}
  } catch {
    throw new Error(
      'Staged execution requires one plan, approval and apply in order, with requireSavedPlan: true on apply and no ignored errors or destroy steps'
    )
  }
}

export function verifySavedRun(
  document: Document,
  workspaceId: string,
  commit: string,
  template: Resource
): void {
  const ref = document.data.relationships?.workspace?.data
  if (
    !ref ||
    Array.isArray(ref) ||
    ref.type !== 'workspace' ||
    ref.id !== workspaceId
  )
    throw new Error('Saved run does not belong to the requested workspace')
  if (document.data.attributes.commitId !== commit)
    throw new Error('Saved run revision differs from TERRAKUBE_COMMIT')
  if (document.data.attributes.templateReference !== template.id)
    throw new Error('Saved run does not use the requested template')
  const contract = savedPlanTemplate(template.attributes.tcl)
  const steps = document.included || []
  const numbers = new Set(steps.map(step => step.attributes.stepNumber))
  if (
    steps.length !== contract.steps.length ||
    numbers.size !== contract.steps.length ||
    contract.steps.some(number => !numbers.has(number))
  )
    throw new Error('Saved run is missing the expected step results')
  const plan = steps.find(step => step.attributes.stepNumber === contract.plan)
  if (!['completed', 'noChanges'].includes(String(plan?.attributes.status)))
    throw new Error('Saved run has no successful plan step')
}

export function verifyApprovalGate(
  document: Document,
  contract: SavedPlanTemplate
): void {
  const steps = document.included || []
  if (
    document.data.attributes.status !== 'waitingApproval' ||
    steps.some(step => {
      const number = Number(step.attributes.stepNumber)
      const status = String(step.attributes.status)
      if (number < contract.approval)
        return !['completed', 'noChanges'].includes(status)
      if (number === contract.approval)
        return !['pending', 'waitingApproval'].includes(status)
      return status !== 'pending'
    })
  )
    throw new Error(
      'Saved run is not paused at its approval gate with successful preceding steps'
    )
}
