/** Plain-Node smoke for the built Module Scheduler service. */

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const entryUrl = pathToFileURL(join(packageDir, 'lib/index.js')).href

describe('Module Scheduler built LIB service', () => {
  it('loads the package entry under plain Node', async () => {
    const script = `
      const module = await import(${JSON.stringify(entryUrl)})
      console.log(JSON.stringify({ className: module.default.name }))
    `
    const result = await runPlainNode(script)

    expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
      className: 'ModuleSchedulerService',
    })
  })
})

function runPlainNode(script: string): Promise<{
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  return new Promise((resolveRun) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolveRun({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stdout,
        stderr,
      })
    })
  })
}
