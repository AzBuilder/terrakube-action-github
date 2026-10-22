import * as core from '@actions/core'

export function readVariables(): Record<string, string> {
  const names = core.getMultilineInput('TERRAKUBE_VARIABLE_NAMES')
  if (names.length > 100 || new Set(names).size !== names.length)
    throw new Error(
      'TERRAKUBE_VARIABLE_NAMES must contain at most 100 unique names'
    )
  const entries = names.map(name => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name))
      throw new Error(
        'TERRAKUBE_VARIABLE_NAMES must contain Terraform variable names without the TF_VAR_ prefix'
      )
    const value = process.env[`TF_VAR_${name}`]
    if (value === undefined)
      throw new Error(`Missing environment variable TF_VAR_${name}`)
    if (value.includes('\0'))
      throw new Error('Terraform variables cannot contain NUL characters')
    return [name, value] as const
  })
  const variables = Object.fromEntries(entries)
  if (Buffer.byteLength(JSON.stringify(variables), 'utf8') > 65_536)
    throw new Error('Per-run Terraform variables exceed 64 KiB')
  // Values may be multiline (for example, PEM keys). Mask each line as well.
  for (const value of Object.values(variables))
    for (const secret of [value, ...value.split(/\r?\n/)])
      if (secret) core.setSecret(secret)
  return variables
}
