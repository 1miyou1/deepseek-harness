import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { routeAgentStep, type TierRoutes } from '../src/router.ts'

const routes: TierRoutes = {
  luna: { provider: 'mock', model: 'gpt-5.6-luna' },
  terra: { provider: 'mock', model: 'gpt-5.6-terra' },
  sol: { provider: 'mock', model: 'gpt-5.6-sol' },
}

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('routeAgentStep()', () => {
  it.each([
    ['把这些记录分类并摘要', 'luna', 'lightweight'],
    ['修复这个缺陷并补测试', 'terra', 'default'],
    ['设计跨模块架构并审查安全边界', 'sol', 'high-risk'],
    ['分析大型代码库中的复杂并发死锁', 'sol', 'complex'],
  ] as const)('routes %s to %s', (task, tier, reason) => {
    expect(routeAgentStep([message(task)], routes)).toEqual({
      tier,
      selection: routes[tier],
      reason,
    })
  })

  it('ignores non-user context and defaults an empty user task to Terra', () => {
    const context = createUserMessage({
      content: [{ type: 'text', text: '高风险架构' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    expect(routeAgentStep([context], routes)).toEqual({
      tier: 'terra',
      selection: routes.terra,
      reason: 'default',
    })
  })
})
