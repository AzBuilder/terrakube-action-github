import {parse} from 'yaml'
import {Document, Resource} from './terrakube'

// Staged operations use a dedicated template administered in Terrakube.
export function savedPlanTemplate(value: unknown): number[] {
  if (typeof value !== 'string' || !value || value.length > 1_000_000)
    throw new Error('Saved-plan template is missing or too large')
  let flow: Record<string, unknown>[]
  try {
    const parsed = parse(Buffer.from(value, 'base64').toString('utf8'), {
      maxAliasCount: 0
    })
    flow = parsed?.flow
    if (!Array.isArray(flow) || flow.length !== 3) throw new Error()
    if (
      flow.some(
        (step, index) =>
          !step ||
          step.type !==
            ['terraformPlan', 'approval', 'terraformApply'][index] ||
          !Number.isSafeInteger(step.step) ||
          Number(step.step) < 1 ||
          step.ignoreError === true ||
          (index > 0 && Number(step.step) <= Number(flow[index - 1]?.step))
      ) ||
      flow[2]?.requireSavedPlan !== true
    )
      throw new Error()
  } catch {
    throw new Error(
      'Staged execution requires plan, approval and apply steps in order, with requireSavedPlan: true on apply'
    )
  }
  return flow.map(step => Number(step.step))
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
  const numbers = savedPlanTemplate(template.attributes.tcl)
  const steps = document.included || []
  if (
    steps.length !== 3 ||
    numbers.some(
      number =>
        steps.filter(step => step.attributes.stepNumber === number).length !== 1
    )
  )
    throw new Error('Saved run is missing the expected step results')
  const plan = steps.find(step => step.attributes.stepNumber === numbers[0])
  if (!['completed', 'noChanges'].includes(String(plan?.attributes.status)))
    throw new Error('Saved run has no successful plan step')
}
