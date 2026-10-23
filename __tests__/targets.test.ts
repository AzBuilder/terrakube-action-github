import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {
  discoverTargets,
  normalizeRoot,
  selectsRoot,
  validateWorkspace
} from '../src/targets'
import {config, item} from './helpers'

test('normalizes roots and rejects traversal and absolute paths', () => {
  for (const value of [
    '..',
    '../infra',
    '/infra',
    'C:\\infra',
    'infra/../other',
    'a\0b'
  ])
    assert.throws(() => normalizeRoot(value))
  assert.equal(normalizeRoot('./infra/'), 'infra')
  assert.equal(normalizeRoot('.'), '.')
})
test('discovery includes descendant changes and repository-root changes', () => {
  assert.equal(selectsRoot('infra', ['infra/modules/main.tf']), true)
  assert.equal(selectsRoot('infra', ['infra-other/main.tf']), false)
  assert.equal(selectsRoot('.', ['modules/main.tf']), true)
})
test('explicit root bypasses discovery, preserves configured names, and supports OpenTofu', async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), 'terrakube-targets-'))
  try {
    await mkdir(path.join(checkout, 'nested root'))
    await writeFile(
      path.join(checkout, 'nested root', 'terrakube.json'),
      JSON.stringify({
        workspace: 'existing-name',
        terraform: '1.9.0',
        iacType: 'tofu'
      })
    )
    assert.deepEqual(
      await discoverTargets(config({checkout, roots: ['nested root']})),
      [
        {
          root: 'nested root',
          name: 'existing-name',
          id: undefined,
          version: '1.9.0',
          iacType: 'tofu'
        }
      ]
    )
    assert.equal(
      (
        await discoverTargets(
          config({checkout, roots: ['nested root'], workspace: 'override'})
        )
      )[0]?.name,
      'override'
    )
  } finally {
    await rm(checkout, {recursive: true, force: true})
  }
})
test('explicit workspace ID requires no terrakube.json; symlink escapes are refused', async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), 'terrakube-targets-'))
  try {
    const [target] = await discoverTargets(
      config({checkout, roots: ['.'], workspaceId: 'existing-id'})
    )
    assert.equal(target?.id, 'existing-id')
    await symlink(
      tmpdir(),
      path.join(checkout, 'outside'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await assert.rejects(
      discoverTargets(config({checkout, roots: ['outside']})),
      /escapes/
    )
  } finally {
    await rm(checkout, {recursive: true, force: true})
  }
})
test('duplicate workspace names fail before submitting work', async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), 'terrakube-targets-'))
  try {
    for (const root of ['one', 'two']) {
      await mkdir(path.join(checkout, root))
      await writeFile(
        path.join(checkout, root, 'terrakube.json'),
        '{"workspace":"same"}'
      )
    }
    await assert.rejects(
      discoverTargets(config({checkout, roots: ['one', 'two']})),
      /Duplicate/
    )
  } finally {
    await rm(checkout, {recursive: true, force: true})
  }
})
test('workspace validation accepts equivalent SSH/HTTPS sources but rejects different repositories and roots', () => {
  const target = {root: 'infra', name: 'example', iacType: 'terraform' as const}
  validateWorkspace(
    item('workspace', '1', {
      source: 'git@github.com:example/repo.git',
      folder: '/infra'
    }),
    target,
    config().repository
  )
  assert.throws(
    () =>
      validateWorkspace(
        item('workspace', '1', {source: config().repository, folder: '/other'}),
        target,
        config().repository
      ),
    /root/
  )
  assert.throws(
    () =>
      validateWorkspace(
        item('workspace', '1', {
          source: 'https://github.com/other/repo',
          folder: '/infra'
        }),
        target,
        config().repository
      ),
    /repository/
  )
})

test('manual discovery finds nested and root configurations without selecting dependency directories', async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), 'terrakube-targets-'))
  const {context} = await import('@actions/github')
  const previous = context.eventName
  context.eventName = 'workflow_dispatch'
  try {
    await writeFile(
      path.join(checkout, 'terrakube.json'),
      '{"workspace":"root-workspace"}'
    )
    for (const root of [
      'infra/nested',
      '.terraform/module',
      'node_modules/package'
    ]) {
      await mkdir(path.join(checkout, root), {recursive: true})
      await writeFile(path.join(checkout, root, 'terrakube.json'), '{}')
    }
    const selected = await discoverTargets(config({checkout, roots: []}))
    assert.deepEqual(selected.map(target => target.root).sort(), [
      '.',
      'infra/nested'
    ])
  } finally {
    context.eventName = previous
    await rm(checkout, {recursive: true, force: true})
  }
})

test('push discovery uses actual Git history and fails clearly when history is missing', async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), 'terrakube-history-'))
  const {promisify} = await import('node:util')
  const {execFile} = await import('node:child_process')
  const {context} = await import('@actions/github')
  const previous = {eventName: context.eventName, payload: context.payload}
  const git = async (...args: string[]) =>
    (
      await promisify(execFile)(
        'git',
        [
          '-C',
          checkout,
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          `core.hooksPath=${checkout}/no-hooks`,
          ...args
        ],
        {timeout: 5000}
      )
    ).stdout.trim()
  try {
    await git('init', '-q')
    for (const root of ['infra', 'unchanged']) {
      await mkdir(path.join(checkout, root))
      await writeFile(path.join(checkout, root, 'terrakube.json'), '{}')
    }
    await git('add', '.')
    await git('commit', '-qm', 'base')
    const before = await git('rev-parse', 'HEAD')
    await mkdir(path.join(checkout, 'infra/subdirectory'))
    await writeFile(
      path.join(checkout, 'infra/subdirectory/main.tf'),
      '# change'
    )
    await git('add', '.')
    await git('commit', '-qm', 'head')
    context.eventName = 'push'
    context.payload = {before, after: await git('rev-parse', 'HEAD')}
    assert.deepEqual(
      (await discoverTargets(config({checkout, roots: []}))).map(
        target => target.root
      ),
      ['infra']
    )
    context.payload.before = '1'.repeat(40)
    await assert.rejects(
      discoverTargets(config({checkout, roots: []})),
      /fetch-depth: 0/
    )
  } finally {
    context.eventName = previous.eventName
    context.payload = previous.payload
    await rm(checkout, {recursive: true, force: true})
  }
})

test('workspace repository identity matches case and clone protocols but still rejects other hosts and repositories', () => {
  const target = {name: 'example', root: 'infra', iacType: 'terraform' as const}
  for (const source of [
    'git@GITHUB.COM:Terrakube-IO/Infra.git',
    'SSH://git@GITHUB.COM/Terrakube-IO/Infra.GIT/',
    'HTTPS://GITHUB.COM/Terrakube-IO/Infra.git'
  ]) {
    validateWorkspace(
      item('workspace', 'ws', {source, folder: 'infra'}),
      target,
      'https://github.com/terrakube-io/infra.git'
    )
  }
  for (const source of [
    'https://other.example/terrakube-io/infra.git',
    'https://github.com/terrakube-io/other.git'
  ]) {
    assert.throws(
      () =>
        validateWorkspace(
          item('workspace', 'ws', {source, folder: 'infra'}),
          target,
          'https://github.com/terrakube-io/infra.git'
        ),
      /repository does not match/
    )
  }
})
