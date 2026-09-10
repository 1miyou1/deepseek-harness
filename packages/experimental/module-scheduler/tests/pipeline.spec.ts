import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  ModuleSchedulerService,
  createPipelineRunner,
  validatePipelineDefinition,
  type ModuleDefinition,
  type PipelineDefinition,
} from '../src/index.ts'

const textSchema = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: { text: { type: 'string' } },
} as const

function makeModule(id: string, fn: (input: unknown) => Promise<Record<string, unknown>>): ModuleDefinition {
  return {
    id,
    version: '1.0.0',
    displayName: `模块${id}`,
    description: '测试模块描述',
    tools: [],
    inputSchema: textSchema,
    outputSchema: textSchema,
    resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
    execute: async ({ input }) => await fn(input),
  }
}

describe('module scheduler pipeline & DAG runner', () => {
  it('validates pipeline structure and rejects cycles or missing nodes', () => {
    // 1. Empty nodes
    expect(() => {
      validatePipelineDefinition({ nodes: [], outputNode: 'a' })
    }).toThrow('pipeline-nodes-empty')

    // 2. Missing output node
    expect(() => {
      validatePipelineDefinition({
        nodes: [{ id: 'a', moduleRef: 'modA@1.0.0' }],
        outputNode: 'non-existent',
      })
    }).toThrow('missing-output-node:non-existent')

    // 3. Missing dependency
    expect(() => {
      validatePipelineDefinition({
        nodes: [
          { id: 'a', moduleRef: 'modA@1.0.0', dependsOn: ['b'] },
        ],
        outputNode: 'a',
      })
    }).toThrow('missing-dependency:b')

    // 4. Cycle detection
    expect(() => {
      validatePipelineDefinition({
        nodes: [
          { id: 'a', moduleRef: 'modA@1.0.0', dependsOn: ['b'] },
          { id: 'b', moduleRef: 'modB@1.0.0', dependsOn: ['a'] },
        ],
        outputNode: 'b',
      })
    }).toThrow('pipeline-cycle-detected')
  })

  it('runs sequential modules mapping output to input without round-tripping to parent', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ModuleSchedulerService)

    // Module A: step 1 -> uppercase text
    ctx.moduleScheduler.registry.register(makeModule('upper', async (input) => {
      const val = (input as { text: string }).text
      return { text: val.toUpperCase() }
    }))

    // Module B: step 2 -> append exclamation
    ctx.moduleScheduler.registry.register(makeModule('exclaim', async (input) => {
      const val = (input as { text: string }).text
      return { text: `${val}!!!` }
    }))

    const pipeline: PipelineDefinition = {
      nodes: [
        { id: 'step1', moduleRef: 'upper@1.0.0', inputMap: { text: '$input.source' } },
        { id: 'step2', moduleRef: 'exclaim@1.0.0', dependsOn: ['step1'], inputMap: { text: 'step1.output.text' } },
      ],
      outputNode: 'step2',
    }

    const runner = createPipelineRunner(req => ctx.moduleScheduler.run(req))
    const result = await runner({
      sessionId: 'test-session',
      taskId: 'test-task',
      pipeline,
      input: { source: 'hello world' },
    })

    expect(result.status).toBe('succeeded')
    expect(result.output).toEqual({ text: 'HELLO WORLD!!!' })
    expect(result.nodes['step1']?.status).toBe('succeeded')
    expect(result.nodes['step2']?.status).toBe('succeeded')

    await fiber.dispose()
  })

  it('short-circuits downstream nodes when an upstream dependency fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ModuleSchedulerService)

    // Failing module
    ctx.moduleScheduler.registry.register(makeModule('failer', async () => {
      throw new Error('boom')
    }))

    const step2Executed = vi.fn()
    ctx.moduleScheduler.registry.register(makeModule('downstream', async () => {
      step2Executed()
      return { text: 'should not run' }
    }))

    const pipeline: PipelineDefinition = {
      nodes: [
        { id: 'step1', moduleRef: 'failer@1.0.0', staticInput: { text: 'start' } },
        { id: 'step2', moduleRef: 'downstream@1.0.0', dependsOn: ['step1'], inputMap: { text: 'step1.output.text' } },
      ],
      outputNode: 'step2',
    }

    const runner = createPipelineRunner(req => ctx.moduleScheduler.run(req))
    const result = await runner({
      sessionId: 'test-session',
      taskId: 'test-task',
      pipeline,
    })

    expect(result.status).toBe('failed')
    expect(result.nodes['step1']?.status).toBe('failed')
    expect(result.nodes['step2']?.status).toBe('blocked')
    expect(result.nodes['step2']?.reason).toBe('dependency-not-succeeded')
    expect(step2Executed).not.toHaveBeenCalled()

    await fiber.dispose()
  })

  it('propagates cancellation to active running pipeline nodes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ModuleSchedulerService)

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    ctx.moduleScheduler.registry.register(makeModule('slow', async () => {
      await gate
      return { text: 'slow finished' }
    }))

    const pipeline: PipelineDefinition = {
      nodes: [
        { id: 'slowNode', moduleRef: 'slow@1.0.0', staticInput: { text: 'start' } },
      ],
      outputNode: 'slowNode',
    }

    const runner = createPipelineRunner(req => ctx.moduleScheduler.run(req))
    const handle = runner({
      sessionId: 'test-session',
      taskId: 'test-task',
      pipeline,
    })

    setTimeout(() => { handle.cancel() }, 20)
    const result = await handle
    expect(result.status).toBe('cancelled')
    expect(result.nodes['slowNode']?.status).toBe('cancelled')

    release()
    await fiber.dispose()
  })

  it('provides built-in pipeline templates and executes them via template runner', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ModuleSchedulerService)

    // Verify built-in templates exist
    const templates = ctx.moduleScheduler.templates.list()
    expect(templates.length).toBeGreaterThanOrEqual(2)
    const reviewTemplate = ctx.moduleScheduler.templates.get('code-review-flow@1.0.0')
    expect(reviewTemplate.id).toBe('code-review-flow')
    expect(reviewTemplate.pipeline.nodes.length).toBe(2)

    // Register dummy implementations for the template modules
    ctx.moduleScheduler.registry.register({
      id: 'git-inspector',
      version: '1.0.0',
      displayName: 'Git状态检查器',
      description: '分析Git状态',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async ({ input }) => ({ branch: 'feat/test', path: (input as { targetPath: string }).targetPath }),
    })

    ctx.moduleScheduler.registry.register({
      id: 'code-auditor',
      version: '1.0.0',
      displayName: '代码审计器',
      description: '审计代码变更',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async ({ input }) => ({ safe: true, auditedPath: (input as { targetPath: string }).targetPath }),
    })

    // Execute the template pipeline directly
    const handle = ctx.moduleScheduler.runPipeline({
      sessionId: 'test-session',
      taskId: 'test-task',
      pipeline: reviewTemplate.pipeline,
      input: { targetPath: 'src/' },
    })

    const result = await handle
    expect(result.status).toBe('succeeded')
    expect(result.nodes['inspect-git']?.status).toBe('succeeded')
    expect(result.nodes['audit-code']?.status).toBe('succeeded')
    expect(result.output).toEqual({ safe: true, auditedPath: 'src/' })

    await fiber.dispose()
  })
})
