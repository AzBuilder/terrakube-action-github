import * as glob from '@actions/glob'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile, realpath} from 'node:fs/promises'
import path from 'node:path'
import * as github from '@actions/github'
import {Config} from './userInput'
import {Resource} from './terrakube'

export interface Target {
  root: string
  name: string
  id?: string
  version?: string
  iacType: 'terraform' | 'tofu'
}

export function normalizeRoot(value: string): string {
  const root =
    value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.'
  if (
    path.posix.isAbsolute(root) ||
    /^[a-z]:/i.test(root) ||
    root.split('/').some(part => part === '..' || part === '') ||
    root.includes('\0')
  ) {
    throw new Error(`Root must be a repository-relative path: ${value}`)
  }
  return path.posix.normalize(root)
}

export function selectsRoot(root: string, files: string[]): boolean {
  return root === '.'
    ? files.length > 0
    : files.some(file => file === root || file.startsWith(`${root}/`))
}

async function changedFiles(config: Config): Promise<string[] | undefined> {
  const event = github.context.payload
  const pr = event.pull_request
  const before: unknown = pr?.base?.sha || event.before
  const after: unknown = pr?.head?.sha || event.after
  if (
    github.context.eventName !== 'pull_request' &&
    github.context.eventName !== 'push'
  )
    return undefined
  if (
    typeof before !== 'string' ||
    !/^[a-f\d]{40}$/i.test(before) ||
    typeof after !== 'string' ||
    !/^[a-f\d]{40}$/i.test(after)
  ) {
    throw new Error(
      'Change discovery needs event base/head SHAs; use explicit TERRAKUBE_ROOT instead'
    )
  }
  if (/^0+$/.test(before)) return undefined // New branches select all roots.
  try {
    const {stdout} = await promisify(execFile)(
      'git',
      [
        '-C',
        config.checkout,
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        pr ? `${before}...${after}` : before,
        ...(pr ? [] : [after]),
        '--'
      ],
      {timeout: 30_000, maxBuffer: 8_000_000}
    )
    return stdout.split('\0').filter(Boolean)
  } catch {
    throw new Error(
      'Cannot discover changed files; checkout with fetch-depth: 0 or set TERRAKUBE_ROOT explicitly'
    )
  }
}

export async function discoverTargets(config: Config): Promise<Target[]> {
  const checkout = await realpath(config.checkout)
  const files = config.roots.length ? undefined : await changedFiles(config)
  const roots = config.roots.length
    ? config.roots
    : (
        await (
          await glob.create(
            `${checkout}/**/terrakube.json\n!${checkout}/**/node_modules/**\n!${checkout}/**/.terraform/**\n!${checkout}/.git/**`,
            {followSymbolicLinks: false, implicitDescendants: false}
          )
        ).glob()
      ).map(file => path.relative(checkout, path.dirname(file)))
  const targets: Target[] = []
  for (const inputRoot of roots) {
    const root = normalizeRoot(inputRoot)
    if (files && !selectsRoot(root, files)) continue
    const resolved = await realpath(path.join(checkout, root))
    if (resolved !== checkout && !resolved.startsWith(`${checkout}${path.sep}`))
      throw new Error(`Root escapes checkout: ${root}`)
    let metadata: Record<string, unknown> = {}
    try {
      const metadataFile = await realpath(path.join(resolved, 'terrakube.json'))
      if (!metadataFile.startsWith(`${checkout}${path.sep}`))
        throw new Error('Metadata escapes checkout')
      const parsed: unknown = JSON.parse(await readFile(metadataFile, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Expected an object')
      metadata = parsed as Record<string, unknown>
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT' &&
        config.roots.length
      )) {
        throw new Error(`Cannot read valid terrakube.json in ${root}`)
      }
    }
    for (const key of ['workspace', 'terraform', 'iacType']) {
      if (metadata[key] !== undefined && typeof metadata[key] !== 'string')
        throw new Error(`terrakube.json ${key} must be a string in ${root}`)
    }
    const iacType = metadata.iacType || 'terraform'
    if (iacType !== 'terraform' && iacType !== 'tofu')
      throw new Error(`Invalid iacType in ${root}`)
    const name =
      config.workspace ||
      (typeof metadata.workspace === 'string' && metadata.workspace.trim()) ||
      path.basename(resolved)
    if (targets.some(target => target.root === root || target.name === name))
      throw new Error(`Duplicate root or workspace: ${root} (${name})`)
    targets.push({
      root,
      name,
      id: config.workspaceId || undefined,
      version: metadata.terraform as string | undefined,
      iacType
    })
  }
  if (!config.roots.length && !roots.length)
    throw new Error(
      'No terrakube.json files found; set TERRAKUBE_ROOT explicitly'
    )
  return targets
}

function repositoryIdentity(value: string): string {
  // Match Terrakube's repository normalization across SSH/HTTPS URLs and case.
  return value
    .replace(/^git@([^:]+):/i, '$1/')
    .replace(/^https?:\/\//i, '')
    .replace(/^ssh:\/\/git@/i, '')
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function validateWorkspace(
  workspace: Resource,
  target: Target,
  repository: string
): void {
  const {source, folder} = workspace.attributes
  if (
    typeof source !== 'string' ||
    repositoryIdentity(source) !== repositoryIdentity(repository)
  )
    throw new Error(
      `Workspace ${target.name} repository does not match the workflow repository`
    )
  // Terrakube represents the repository root as / and stores nested roots with or without a leading /.
  if (
    (folder !== null && typeof folder !== 'string') ||
    normalizeRoot((folder || '').replace(/^\//, '') || '.') !== target.root
  )
    throw new Error(
      `Workspace ${target.name} root does not match ${target.root}`
    )
}
