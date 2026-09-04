import { existsSync, globSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export const MAX_OUTPUT_BYTES = 16 * 1024
export const MAX_DEVICES = 32

export interface CommandResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}

export interface AndroidTooling {
  findTools(projectPath: string): ToolPaths
  run(command: string, args: readonly string[], cwd: string, signal: AbortSignal): Promise<CommandResult>
  devices(adb: string, signal: AbortSignal): Promise<CommandResult>
  /** Query Gradle without passing a batch file through a command shell. */
  gradleVersion(gradle: string, java: string | undefined, cwd: string, signal: AbortSignal): Promise<CommandResult>
}

export interface ToolPaths {
  sdk?: string
  adb?: string
  java?: string
  gradle?: string
  gradleWrapper?: string
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  return { text: bytes.subarray(bytes.length - maxBytes).toString('utf8'), truncated: true }
}

export function parseAdbDevices(output: string): Array<{ serial: string; state: 'device' | 'unauthorized' | 'offline' | 'unknown'; model?: string }> {
  return output.split(/\r?\n/u).slice(1).filter(Boolean).slice(0, MAX_DEVICES).map((line) => {
    const [serial = '', rawState = 'unknown', ...details] = line.split(/\s+/u)
    const modelValue = details.find(item => item.startsWith('model:'))?.slice(6)
    const state = rawState === 'device' || rawState === 'unauthorized' || rawState === 'offline' ? rawState : 'unknown'
    return { serial, state, ...(modelValue ? { model: modelValue.replaceAll('_', ' ') } : {}) }
  })
}

export function createAndroidTooling(subprocess: SubprocessRuntime): AndroidTooling {
  return {
    findTools(projectPath) {
      const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
      const sdkCandidates = [sdk, 'C:/Users/wangl/AppData/Roaming/reasonix/global-workspace/.tools/android-sdk'].filter(Boolean) as string[]
      const sdkPath = sdkCandidates.find(path => existsSync(path) && statSync(path).isDirectory())
      const adb = sdkPath && existingFile(join(sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
      const javaName = process.platform === 'win32' ? 'java.exe' : 'java'
      const java = existingFile(process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', javaName))
        ?? existingFile(join(
          'C:/Users/wangl/AppData/Roaming/reasonix/global-workspace/.tools/jdk-17/jdk-17.0.20+8/bin',
          javaName,
        ))
      const gradleWrapper = [join(projectPath, 'gradlew.bat'), join(projectPath, 'gradlew')].find(existingFile)
      const gradle = existingFile('C:/Users/wangl/AppData/Roaming/reasonix/global-workspace/.tools/gradle-8.9/bin/gradle.bat') ?? existingFile('C:/Users/wangl/AppData/Roaming/reasonix/global-workspace/.tools/gradle-8.9/bin/gradle')
      return {
        ...sdkPath ? { sdk: sdkPath } : {},
        ...adb ? { adb } : {},
        ...java ? { java } : {},
        ...gradle ? { gradle } : {},
        ...gradleWrapper ? { gradleWrapper } : {},
      }
    },
    async run(command, args, cwd, signal) {
      signal.throwIfAborted()
      const timeout = AbortSignal.timeout(10_000)
      const combined = AbortSignal.any([signal, timeout])
      const handle = subprocess.spawn({ argv: [command, ...args], cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_OUTPUT_BYTES } }, graceMs: 1_000, signal: combined })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
      const stderr = handle.collected.stderr?.readFrom(0) ?? { text: '', lossy: false }
      const timedOut = timeout.aborted && !signal.aborted
      return {
        ok: outcome.exitCode === 0 && !timedOut,
        exitCode: outcome.exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.lossy || stderr.lossy,
        timedOut,
      }
    },
    devices(adb, signal) { return this.run(adb, ['devices', '-l'], process.cwd(), signal) },
    gradleVersion(gradle, java, cwd, signal) {
      if (!gradle.toLowerCase().endsWith('.bat') || !java) return this.run(gradle, ['--version'], cwd, signal)
      const launcher = globSync(join(dirname(dirname(gradle)), 'lib', 'gradle-launcher-*.jar'))[0]
      return launcher
        ? this.run(java, ['-classpath', launcher, 'org.gradle.launcher.GradleMain', '--version'], cwd, signal)
        : this.run(gradle, ['--version'], cwd, signal)
    },
  }
}

function existingFile(path: string | undefined): string | undefined {
  return path && existsSync(path) && statSync(path).isFile() ? resolve(path) : undefined
}
