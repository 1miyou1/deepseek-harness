import type { Context } from '@deepseek-ai/cordis'
import { createAndroidTooling } from '@deepseek-ai/dsh-experimental-android-tooling'
import { diagnose, type AndroidDiagnosticsOutput } from '@deepseek-ai/dsh-experimental-android-environment-diagnostics'
import type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'

export const inject = ['moduleScheduler', 'subprocess']

export function apply(ctx: Context): void {
  const tooling = createAndroidTooling(ctx.subprocess)
  const definition: ModuleDefinition = {
    id: 'android-environment-diagnostics',
    version: '1.0.0',
    displayName: 'Android 环境与设备诊断',
    description: '只读检查 Android 环境与已连接设备',
    tools: [],
    inputSchema: {
      type: 'object',
      required: ['projectPath'],
      additionalProperties: false,
      properties: {
        projectPath: { type: 'string' },
        packageName: { type: 'string' },
        deviceSerial: { type: 'string' },
        includeDevices: { type: 'boolean' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['project', 'tools', 'devices', 'diagnostics'],
      additionalProperties: false,
      properties: {
        project: {
          type: 'object',
          required: ['path', 'exists', 'type', 'hasGradleWrapper'],
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
            exists: { type: 'boolean' },
            type: { type: 'string' },
            hasGradleWrapper: { type: 'boolean' },
            gradleWrapperPath: { type: 'string' },
          },
        },
        tools: {
          type: 'object',
          required: ['sdk', 'java', 'gradle', 'adb'],
          additionalProperties: false,
          properties: Object.fromEntries(['sdk', 'java', 'gradle', 'adb'].map(name => [name, {
            type: 'object',
            required: ['available'],
            additionalProperties: false,
            properties: { available: { type: 'boolean' }, path: { type: 'string' }, version: { type: 'string' } },
          }])),
        },
        devices: {
          type: 'array',
          maxItems: 32,
          items: {
            type: 'object',
            required: ['serial', 'state'],
            additionalProperties: false,
            properties: {
              serial: { type: 'string' },
              state: { type: 'string' },
              model: { type: 'string' },
              androidVersion: { type: 'string' },
            },
          },
        },
        application: {
          type: 'object',
          required: ['packageName', 'deviceSerial', 'installed'],
          additionalProperties: false,
          properties: {
            packageName: { type: 'string' },
            deviceSerial: { type: 'string' },
            installed: { type: 'boolean' },
            versionName: { type: 'string' },
            versionCode: { type: 'string' },
          },
        },
        diagnostics: {
          type: 'array',
          maxItems: 64,
          items: {
            type: 'object',
            required: ['code', 'severity', 'subject', 'message'],
            additionalProperties: false,
            properties: {
              code: { type: 'string' },
              severity: { type: 'string' },
              subject: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 8, timeoutMs: 30_000 },
    execute: async ({ input, signal }): Promise<AndroidDiagnosticsOutput> => diagnose(
      input as { projectPath: string; packageName?: string; deviceSerial?: string; includeDevices?: boolean },
      tooling,
      signal,
    ),
  }
  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'android diagnostics: registration')
}
