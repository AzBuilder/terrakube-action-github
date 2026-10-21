import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'

async function snapshot(directory) {
  const files = await readdir(directory, {recursive: true, withFileTypes: true})
  const hashes = await Promise.all(
    files
      .filter(file => file.isFile())
      .map(async file => {
        const filename = path.join(file.parentPath, file.name)
        return [
          path.relative(directory, filename),
          createHash('sha256')
            .update(await readFile(filename))
            .digest('hex')
        ]
      })
  )
  return JSON.stringify(
    hashes.sort(([left], [right]) => left.localeCompare(right))
  )
}

const temporary = await mkdtemp(path.join(tmpdir(), 'terrakube-build-'))
try {
  const directory = path.join(temporary, 'dist')
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('@vercel/ncc/dist/ncc/cli.js'),
      'build',
      'src/main.ts',
      '-o',
      directory,
      '--minify',
      '--license',
      'licenses.txt'
    ],
    {stdio: 'inherit'}
  )
  if ((await snapshot(path.resolve('dist'))) !== (await snapshot(directory))) {
    console.error(
      'dist/ is out of date. Run npm run build and commit the generated files.'
    )
    process.exitCode = 1
  }
} finally {
  await rm(temporary, {recursive: true, force: true})
}
