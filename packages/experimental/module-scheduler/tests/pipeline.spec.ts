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
    expect(reviewTemplate.pipeline.nodes.length).toBe(3)
    expect(reviewTemplate.pipeline.nodes[0]?.inputMap).toEqual({ path: '$input.targetPath' })

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
      execute: async ({ input }) => ({ branch: 'feat/test', path: (input as { path: string }).path }),
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

    ctx.moduleScheduler.registry.register({
      id: 'independent-review',
      version: '1.0.0',
      displayName: '独立代码审查器',
      description: '架构与测试完备度审查',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async ({ input }) => ({ verdict: 'approved', score: 100, target: (input as { targetPath: string }).targetPath }),
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
    expect(result.nodes['inspect-git']).toMatchObject({
      status: 'succeeded',
      output: { branch: 'feat/test', path: 'src/' },
    })
    expect(result.nodes['audit-code']?.status).toBe('succeeded')
    expect(result.nodes['independent-review']?.status).toBe('succeeded')
    expect(result.output).toEqual({ verdict: 'approved', score: 100, target: 'src/' })

    await fiber.dispose()
  })

  it('executes full-cycle-dev-flow 4-step pipeline and enforces circuit-breaker on test failure', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ModuleSchedulerService)

    const devTemplate = ctx.moduleScheduler.templates.get('full-cycle-dev-flow@1.0.0')
    expect(devTemplate.id).toBe('full-cycle-dev-flow')
    expect(devTemplate.pipeline.nodes.length).toBe(4)

    let implementCalled = false
    let testCalled = false
    let auditCalled = false

    ctx.moduleScheduler.registry.register({
      id: 'code-implementer',
      version: '1.0.0',
      displayName: '代码实现器',
      description: '执行代码写入',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async () => {
        implementCalled = true
        return { ok: true, changedFiles: ['src/app.ts'] }
      },
    })

    // Simulated test failure triggering circuit breaker
    ctx.moduleScheduler.registry.register({
      id: 'test-runner',
      version: '1.0.0',
      displayName: '测试运行器',
      description: '执行测试',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async () => {
        testCalled = true
        throw new Error('test-suite-failed: 2 failed')
      },
    })

    ctx.moduleScheduler.registry.register({
      id: 'code-auditor',
      version: '1.0.0',
      displayName: '代码审计器',
      description: '代码审计',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async () => {
        auditCalled = true
        return { safe: true }
      },
    })

    ctx.moduleScheduler.registry.register({
      id: 'independent-review',
      version: '1.0.0',
      displayName: '独立审查器',
      description: '独立审查',
      tools: [],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resourcePolicy: { maxConcurrent: 2, queueLimit: 2, timeoutMs: 2000 },
      execute: async () => ({ verdict: 'approved' }),
    })

    const handle = ctx.moduleScheduler.runPipeline({
      sessionId: 'test-session',
      taskId: 'test-task',
      pipeline: devTemplate.pipeline,
      input: { edits: [], targetPath: 'src/' },
    })

    const result = await handle
    expect(result.status).toBe('failed')
    expect(implementCalled).toBe(true)
    expect(testCalled).toBe(true)
    // Circuit breaker: downstream audit node MUST NOT be called and marked blocked!
    expect(auditCalled).toBe(false)
    expect(result.nodes['audit']?.status).toBe('blocked')
    expect(result.nodes['audit']?.reason).toBe('dependency-not-succeeded')
    expect(result.nodes['review']?.status).toBe('blocked')

    await fiber.dispose()
  })

})
