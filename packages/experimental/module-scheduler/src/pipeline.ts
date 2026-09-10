/**
 * DAG Pipeline Coordinator for chaining specialized modules without intermediate round-trips.
 *
 * @module @deepseek-ai/dsh-experimental-module-scheduler/pipeline
 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ModuleRunHandle, ModuleRunRequest, ModuleRunResult, ModuleStatus } from './index.ts'

export interface PipelineNode {
  readonly id: string
  readonly moduleRef: string
  readonly dependsOn?: readonly string[] | undefined
  readonly inputMap?: Record<string, string> | undefined
  readonly staticInput?: Record<string, unknown> | undefined
}

export interface PipelineDefinition {
  readonly id?: string | undefined
  readonly version?: string | undefined
  readonly nodes: readonly PipelineNode[]
  readonly outputNode: string
  readonly maxRuns?: number | undefined
}

export interface PipelineRunRequest {
  readonly sessionId: string
  readonly taskId: string
  readonly pipeline: PipelineDefinition
  readonly input?: Record<string, unknown> | undefined
}

export interface PipelineRunResult {
  readonly pipelineRunId: string
  readonly sessionId: string
  readonly taskId: string
  readonly status: ModuleStatus
  readonly reason?: string | undefined
  readonly nodes: Record<string, ModuleRunResult>
  readonly output?: unknown
}

export type PipelineRunHandle = Promise<PipelineRunResult> & {
  pipelineRunId: string
  cancel: () => boolean
}

export function validatePipelineDefinition(pipeline: PipelineDefinition): void {
  if (pipeline.nodes.length === 0) {
    throw new Error('pipeline-nodes-empty')
  }
  const byId = new Map<string, PipelineNode>()
  for (const node of pipeline.nodes) {
    if (byId.has(node.id)) throw new Error(`duplicate-pipeline-node:${node.id}`)
    byId.set(node.id, node)
  }
  if (!byId.has(pipeline.outputNode)) {
    throw new Error(`missing-output-node:${pipeline.outputNode}`)
  }

  for (const node of pipeline.nodes) {
    const deps = node.dependsOn ?? []
    for (const dep of deps) {
      if (!byId.has(dep)) throw new Error(`missing-dependency:${dep}`)
    }
  }

  // Cycle check
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error('pipeline-cycle-detected')
    if (visited.has(id)) return
    visiting.add(id)
    const current = byId.get(id)
    for (const dep of current?.dependsOn ?? []) {
      visit(dep)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) {
    visit(id)
  }
}

function resolvePath(path: string, initialInput: Record<string, unknown>, nodeResults: Record<string, ModuleRunResult>): unknown {
  const parts = path.split('.')
  let current: unknown
  if (parts[0] === '$input') {
    current = initialInput
    parts.shift()
  } else {
    const nodeId = parts.shift()
    if (nodeId === undefined || !(nodeId in nodeResults)) return undefined
    current = nodeResults[nodeId]?.output
    if (parts[0] === 'output') parts.shift()
  }

  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function buildNodeInput(
  node: PipelineNode,
  initialInput: Record<string, unknown>,
  nodeResults: Record<string, ModuleRunResult>,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...node.staticInput }
  for (const [targetKey, sourcePath] of Object.entries(node.inputMap ?? {})) {
    input[targetKey] = resolvePath(sourcePath, initialInput, nodeResults)
  }
  return input
}

export function createPipelineRunner(
  runModule: (request: ModuleRunRequest) => ModuleRunHandle,
): (request: PipelineRunRequest) => PipelineRunHandle {
  return (request: PipelineRunRequest): PipelineRunHandle => {
    validatePipelineDefinition(request.pipeline)
    const pipelineRunId = randomUUID()
    const activeHandles = new Set<ModuleRunHandle>()
    const cancelState = { cancelled: false }

    const promise = (async (): Promise<PipelineRunResult> => {
      const { pipeline } = request
      const initialInput = request.input ?? {}
      const maxRuns = pipeline.maxRuns ?? 16
      const results: Record<string, ModuleRunResult> = {}
      const pending = new Map<string, PipelineNode>(pipeline.nodes.map(n => [n.id, n]))
      let runsCount = 0

      while (pending.size > 0) {
        if (cancelState.cancelled) {
          for (const [id, node] of pending) {
            results[id] = {
              runId: randomUUID(),
              sessionId: request.sessionId,
              taskId: request.taskId,
              moduleRef: node.moduleRef,
              status: 'cancelled',
              validated: false,
              reason: 'pipeline-cancelled',
            }
          }
          break
        }

        let progress = false
        for (const [id, node] of [...pending]) {
          const deps = node.dependsOn ?? []
          if (!deps.every(dep => dep in results)) continue
          if (deps.some(dep => results[dep]?.status !== 'succeeded' || !results[dep].validated)) {
            results[id] = {
              runId: randomUUID(),
              sessionId: request.sessionId,
              taskId: request.taskId,
              moduleRef: node.moduleRef,
              status: 'blocked',
              validated: false,
              reason: 'dependency-not-succeeded',
            }
            pending.delete(id)
            progress = true
          }
        }

        const readyNodes = [...pending.values()].filter(node =>
          (node.dependsOn ?? []).every(dep => results[dep]?.status === 'succeeded' && results[dep].validated),
        )

        if (readyNodes.length === 0) {
          if (!progress && pending.size > 0) throw new Error('pipeline-deadlock')
          continue
        }

        const allowedNodes = readyNodes.slice(0, Math.max(0, maxRuns - runsCount))
        if (allowedNodes.length === 0) {
          for (const [id, node] of pending) {
            results[id] = {
              runId: randomUUID(),
              sessionId: request.sessionId,
              taskId: request.taskId,
              moduleRef: node.moduleRef,
              status: 'blocked',
              validated: false,
              reason: 'pipeline-budget-exhausted',
            }
          }
          break
        }

        await Promise.all(allowedNodes.map(async (node) => {
          pending.delete(node.id)
          runsCount += 1
          const nodeInput = buildNodeInput(node, initialInput, results)
          const handle = runModule({
            sessionId: request.sessionId,
            taskId: request.taskId,
            moduleRef: node.moduleRef,
            input: nodeInput,
          })

          activeHandles.add(handle)
          if (cancelState.cancelled) handle.cancel()
          const moduleResult = await handle
          activeHandles.delete(handle)
          results[node.id] = moduleResult
        }))
      }

      const allResults = Object.values(results)
      const isAnyCancelled = cancelState.cancelled || allResults.some(r => r.status === 'cancelled')
      const isAnyFailed = allResults.some(r => r.status === 'failed' || r.status === 'timed_out')
      const isAnyBlocked = allResults.some(r => r.status === 'blocked')

      const finalStatus: ModuleStatus = isAnyCancelled
        ? 'cancelled'
        : isAnyFailed
          ? 'failed'
          : isAnyBlocked && results[pipeline.outputNode]?.status !== 'succeeded'
            ? 'blocked'
            : results[pipeline.outputNode]?.status === 'succeeded'
              ? 'succeeded'
              : 'failed'

      return {
        pipelineRunId,
        sessionId: request.sessionId,
        taskId: request.taskId,
        status: finalStatus,
        nodes: results,
        output: results[pipeline.outputNode]?.output,
      }
    })()

    return Object.assign(promise, {
      pipelineRunId,
      cancel: () => {
        cancelState.cancelled = true
        for (const h of activeHandles) h.cancel()
        return true
      },
    })
  }
}

/**
 * Pipeline template definition and registry for pre-configured module workflows.
 */
export interface PipelineTemplate {
  readonly id: string
  readonly version: string
  readonly displayName: string
  readonly description: string
  readonly pipeline: PipelineDefinition
}

/** Built-in pipeline templates matching project specifications. */
export const BUILTIN_PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    id: 'code-review-flow',
    version: '1.0.0',
    displayName: '代码审查流水线',
    description: '工作区状态检查 (git-inspector) -> 源码与敏感红线静态审计 (code-auditor) -> 架构合规与伴随测试独立审查 (independent-review) 3步直通流水线。',
    pipeline: {
      nodes: [
        {
          id: 'inspect-git',
          moduleRef: 'git-inspector@1.0.0',
          inputMap: { targetPath: '$input.targetPath' },
        },
        {
          id: 'audit-code',
          moduleRef: 'code-auditor@1.0.0',
          dependsOn: ['inspect-git'],
          inputMap: { targetPath: '$input.targetPath' },
        },
        {
          id: 'independent-review',
          moduleRef: 'independent-review@1.0.0',
          dependsOn: ['audit-code'],
          inputMap: { targetPath: '$input.targetPath' },
        },
      ],
      outputNode: 'independent-review',
    },
  },
  {
    id: 'full-cycle-dev-flow',
    version: '1.0.0',
    displayName: '企业级全自动TDD开发闭环流水线',
    description: '原子修改实现 (code-implementer) -> 降噪跑测诊断 (test-runner) -> 静态安全审计 (code-auditor) -> 架构测试审查 (independent-review) 4步直通流水线。',
    pipeline: {
      nodes: [
        {
          id: 'implement',
          moduleRef: 'code-implementer@1.0.0',
          inputMap: { edits: '$input.edits', writePaths: '$input.writePaths', cwd: '$input.cwd' },
        },
        {
          id: 'test',
          moduleRef: 'test-runner@1.0.0',
          dependsOn: ['implement'],
          inputMap: { testPath: '$input.testPath', cwd: '$input.cwd' },
        },
        {
          id: 'audit',
          moduleRef: 'code-auditor@1.0.0',
          dependsOn: ['test'],
          inputMap: { targetPath: '$input.targetPath' },
        },
        {
          id: 'review',
          moduleRef: 'independent-review@1.0.0',
          dependsOn: ['audit'],
          inputMap: { targetPath: '$input.targetPath' },
        },
      ],
      outputNode: 'review',
    },
  },
  {
    id: 'video-audio-analysis-flow',
    version: '1.0.0',
    displayName: '音视频语音分析流水线',
    description: '本地音视频音轨提取与 GPU SenseVoice 富文本语音转写 (video-analyzer) 流水线。',
    pipeline: {
      nodes: [
        {
          id: 'transcribe',
          moduleRef: 'video-analyzer@1.0.0',
          inputMap: { videoPath: '$input.videoPath' },
        },
      ],
      outputNode: 'transcribe',
    },
  },
]

export class PipelineTemplateRegistry {
  private readonly templates = new Map<string, PipelineTemplate>()

  constructor(initial: readonly PipelineTemplate[] = BUILTIN_PIPELINE_TEMPLATES) {
    for (const t of initial) this.register(t)
  }

  register(template: PipelineTemplate): void {
    validatePipelineDefinition(template.pipeline)
    const key = `${template.id}@${template.version}`
    if (this.templates.has(key)) throw new Error(`duplicate-pipeline-template:${key}`)
    this.templates.set(key, template)
    this.templates.set(template.id, template)
  }

  get(templateRef: string): PipelineTemplate {
    const found = this.templates.get(templateRef)
    if (!found) throw new Error(`unknown-pipeline-template:${templateRef}`)
    return found
  }

  list(): PipelineTemplate[] {
    const unique = new Map<string, PipelineTemplate>()
    for (const t of this.templates.values()) {
      unique.set(`${t.id}@${t.version}`, t)
    }
    return Array.from(unique.values())
  }
}
