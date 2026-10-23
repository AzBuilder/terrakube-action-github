import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

test('the standalone bundle fails invalid configuration and writes outputs and a summary without node_modules', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'terrakube-bundle-'))
  try {
    await cp(
      new URL('../dist', import.meta.url),
      path.join(directory, 'dist'),
      {recursive: true}
    )
    const output = path.join(directory, 'outputs')
    const summary = path.join(directory, 'summary')
    await writeFile(output, '')
    await writeFile(summary, '')
    const env = {
      ...process.env,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_TERRAKUBE_TOKEN: '',
      INPUT_TERRAKUBE_AUTH: 'token'
    }
    const execution = spawnSync(
      process.execPath,
      [path.join(directory, 'dist/index.js')],
      {cwd: directory, env, encoding: 'utf8', timeout: 10_000}
    )
    assert.equal(execution.status, 1, execution.stderr)
    assert.match(execution.stdout, /TERRAKUBE_TOKEN is required/)
    assert.match(await readFile(output, 'utf8'), /STATUS[^]*failed/)
    assert.match(await readFile(output, 'utf8'), /JOB_IDS[^]*\[\]/)
    assert.match(await readFile(summary, 'utf8'), /TERRAKUBE_TOKEN is required/)
    assert.doesNotMatch(
      execution.stdout + execution.stderr,
      /set-output|ERR_MODULE|MODULE_NOT_FOUND/
    )
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})
