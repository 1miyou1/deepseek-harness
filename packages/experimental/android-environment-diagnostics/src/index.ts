import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAdbDevices, type AndroidTooling, type CommandResult, type ToolPaths } from '@deepseek-ai/dsh-experimental-android-tooling'

const MAX_DIAGNOSTICS = 64
const MAX_MESSAGE_LENGTH = 512

type Subject = 'project' | 'sdk' | 'java' | 'gradle' | 'adb' | 'device' | 'application'
export interface AndroidDiagnosticsInput { projectPath: string; packageName?: string; deviceSerial?: string; includeDevices?: boolean }
export interface DiagnosticItem { code: string; severity: 'info' | 'warning' | 'error'; subject: Subject; message: string }
export interface AndroidDiagnosticsOutput {
  project: { path: string; exists: boolean; type: 'android-gradle' | 'unknown'; hasGradleWrapper: boolean; gradleWrapperPath?: string }
  tools: Record<'sdk' | 'java' | 'gradle' | 'adb', { available: boolean; path?: string; version?: string }>
  devices: Array<{ serial: string; state: 'device' | 'unauthorized' | 'offline' | 'unknown'; model?: string; androidVersion?: string }>
  application?: { packageName: string; deviceSerial: string; installed: boolean; versionName?: string; versionCode?: string }
  diagnostics: DiagnosticItem[]
}

export async function diagnose(
  input: AndroidDiagnosticsInput,
  tooling: AndroidTooling,
  signal: AbortSignal,
): Promise<AndroidDiagnosticsOutput> {
  const path = input.projectPath
  const exists = existsSync(path) && statSync(path).isDirectory()
  const wrapper = exists ? [join(path, 'gradlew.bat'), join(path, 'gradlew')].find(file => existsSync(file)) : undefined
  const android = exists && ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'].some(file => existsSync(join(path, file)))
  const paths = tooling.findTools(path)
  const diagnostics: DiagnosticItem[] = []
  const add = (code: string, severity: DiagnosticItem['severity'], subject: Subject, message: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ code, severity, subject, message: message.slice(0, MAX_MESSAGE_LENGTH) })
  }
  if (!exists) add('project-not-found', 'error', 'project', 'Project directory was not found.')
  else if (!android) add('project-not-android-gradle', 'warning', 'project', 'Project does not look like an Android Gradle project.')
  if (!wrapper) add('gradle-wrapper-missing', 'warning', 'gradle', 'Gradle wrapper was not found.')
  for (const [name, code] of [['sdk', 'android-sdk-not-found'], ['java', 'java-not-found'], ['gradle', 'gradle-not-found'], ['adb', 'adb-not-found']] as const) {
    if (!paths[name]) add(code, 'error', name, `${name} is not available.`)
  }

  const tools = toolStatus(paths)
  for (const [name, args] of [['adb', ['version']], ['java', ['-version']]] as const) {
    const command = paths[name]
    if (!command) continue
    recordVersion(name, await safeRun(tooling, command, args, path, signal), tools, add)
  }
  if (paths.gradle) recordVersion('gradle', await tooling.gradleVersion(paths.gradle, paths.java, path, signal).catch(() => failedResult()), tools, add)

  let devices: AndroidDiagnosticsOutput['devices'] = []
  let application: AndroidDiagnosticsOutput['application']
  if (input.includeDevices !== false && paths.adb) {
    const result = await tooling.devices(paths.adb, signal).catch(() => failedResult())
    if (result.ok) {
      devices = parseAdbDevices(result.stdout)
      if (devices.length === 0) add('no-devices', 'info', 'device', 'No Android devices are connected.')
    } else add(result.timedOut ? 'process-timeout' : 'adb-daemon-unavailable', 'warning', 'adb', 'adb device query failed.')
    if (result.truncated) add('process-output-truncated', 'warning', 'adb', 'adb output was truncated.')
    for (const device of devices) {
      if (device.state === 'unauthorized') add('device-unauthorized', 'warning', 'device', `Device ${device.serial} is unauthorized.`)
      else if (device.state === 'offline') add('device-offline', 'warning', 'device', `Device ${device.serial} is offline.`)
      else if (device.state === 'device') {
        const version = await safeRun(tooling, paths.adb, ['-s', device.serial, 'shell', 'getprop', 'ro.build.version.release'], path, signal)
        if (version.ok) device.androidVersion = version.stdout.trim()
      }
    }
    const selected = input.deviceSerial ?? (devices.length === 1 ? devices[0]?.serial : undefined)
    if (input.deviceSerial && !devices.some(device => device.serial === input.deviceSerial)) add('device-not-found', 'warning', 'device', 'Requested device was not found.')
    if (input.packageName && selected && devices.some(device => device.serial === selected && device.state === 'device')) {
      const result = await safeRun(tooling, paths.adb, ['-s', selected, 'shell', 'dumpsys', 'package', input.packageName], path, signal)
      application = parseApplication(input.packageName, selected, result)
      if (!application.installed) add('application-not-installed', 'warning', 'application', 'Requested application is not installed.')
    }
  }

  return {
    project: { path, exists, type: android ? 'android-gradle' : 'unknown', hasGradleWrapper: wrapper !== undefined, ...(wrapper ? { gradleWrapperPath: wrapper } : {}) },
    tools,
    devices,
    ...(application ? { application } : {}),
    diagnostics,
  }
}

function recordVersion(
  name: 'adb' | 'java' | 'gradle',
  result: CommandResult,
  tools: AndroidDiagnosticsOutput['tools'],
  add: (code: string, severity: DiagnosticItem['severity'], subject: Subject, message: string) => void,
): void {
  const text = result.stdout || result.stderr
  const version = name === 'gradle' ? text.split(/\r?\n/u).find(line => /^Gradle\s/u.test(line)) : firstLine(text)
  if (result.ok && version) tools[name].version = version
  else add(result.timedOut ? 'process-timeout' : 'tool-version-query-failed', 'warning', name, `${name} version query failed.`)
  if (result.truncated) add('process-output-truncated', 'warning', name, `${name} output was truncated.`)
}

async function safeRun(
  tooling: AndroidTooling,
  command: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<CommandResult> {
  return await tooling.run(command, args, cwd, signal).catch(() => failedResult())
}
function failedResult(): CommandResult { return { ok: false, exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: false } }
function firstLine(text: string): string | undefined { return text.trim().split(/\r?\n/u)[0] || undefined }
function toolStatus(paths: ToolPaths): AndroidDiagnosticsOutput['tools'] {
  return Object.fromEntries((['sdk', 'java', 'gradle', 'adb'] as const).map(name => [name, paths[name] ? { available: true, path: paths[name] } : { available: false }])) as AndroidDiagnosticsOutput['tools']
}
function parseApplication(packageName: string, deviceSerial: string, result: CommandResult): NonNullable<AndroidDiagnosticsOutput['application']> {
  const versionName = /versionName=([^\s]+)/u.exec(result.stdout)?.[1]
  const versionCode = /versionCode=(\d+)/u.exec(result.stdout)?.[1]
  return {
    packageName,
    deviceSerial,
    installed: result.ok && (versionName !== undefined || versionCode !== undefined),
    ...(versionName ? { versionName } : {}),
    ...(versionCode ? { versionCode } : {}),
  }
}
