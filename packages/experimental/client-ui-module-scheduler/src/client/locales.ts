/** Module Scheduler Web dictionaries. */

/** Locale namespace owned by the Module Scheduler Web UI. */
export const NS = 'module-scheduler'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  trigger: '模块',
  refresh: '刷新模块',
  close: '关闭',
  loading: '正在加载模块…',
  emptyModules: '没有可用模块',
  module: '模块',
  taskId: '任务 ID',
  input: '输入 JSON',
  start: '启动',
  starting: '正在启动…',
  invalidJson: '输入必须是有效的 JSON。',
  runs: '当前会话运行记录',
  emptyRuns: '当前会话没有运行记录',
  cancel: '取消',
  cancelling: '正在取消…',
  requiresTools: '使用当前会话工具',
  reason: '原因',
  result: '结果',
  'status.created': '已创建',
  'status.running': '运行中',
  'status.succeeded': '已成功',
  'status.failed': '失败',
  'status.blocked': '已阻止',
  'status.cancelled': '已取消',
  'status.timed_out': '已超时',
} satisfies Record<string, string>

/** Module Scheduler locale key union. */
export type ModuleSchedulerKey = keyof typeof zh

/** English dictionary checked against the Simplified Chinese key set. */
export const en = {
  trigger: 'Modules',
  refresh: 'Refresh modules',
  close: 'Close',
  loading: 'Loading modules…',
  emptyModules: 'No modules available',
  module: 'Module',
  taskId: 'Task ID',
  input: 'Input JSON',
  start: 'Start',
  starting: 'Starting…',
  invalidJson: 'Input must be valid JSON.',
  runs: 'Current session runs',
  emptyRuns: 'No runs in the current session',
  cancel: 'Cancel',
  cancelling: 'Cancelling…',
  requiresTools: 'Uses current-session tools',
  reason: 'Reason',
  result: 'Result',
  'status.created': 'Created',
  'status.running': 'Running',
  'status.succeeded': 'Succeeded',
  'status.failed': 'Failed',
  'status.blocked': 'Blocked',
  'status.cancelled': 'Cancelled',
  'status.timed_out': 'Timed out',
} satisfies Record<ModuleSchedulerKey, string>
