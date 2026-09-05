import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/** Model tier owned by the step router. */
export type ModelTier = 'luna' | 'terra' | 'sol'

/** Exact deployment routes for each tier. */
export type TierRoutes = Readonly<Record<ModelTier, ModelSelection>>

/** Why one step received its model tier. */
export type RoutingReason = 'lightweight' | 'default' | 'complex' | 'high-risk'

/** Complete route decision for one Agent step. */
export interface StepRoutingDecision {
  readonly tier: ModelTier
  readonly selection: ModelSelection
  readonly reason: RoutingReason
}

const HIGH_RISK = new RegExp([
  '高风险|安全(?:边界|审查|审核)|权限|鉴权|认证|隐私|密钥|支付|生产发布|数据迁移|破坏性|删库',
  'security|authentication|authorization|privacy|secret|payment|production|migration',
].join('|'), 'iu')
const COMPLEX = new RegExp([
  '架构|复杂|大型代码库|跨模块|并发|死锁|根因|深度研究',
  'architecture|complex|large codebase|cross-module|concurren|deadlock|root cause|deep research',
].join('|'), 'iu')
const LIGHTWEIGHT = new RegExp([
  '分类|抽取|摘要|总结|格式化|批处理|翻译|改写|重命名|简单|后台轻任务',
  'classif|extract|summari|format|batch|translat|rewrite|rename|simple',
].join('|'), 'iu')

/** Whether the proposed step contains human-authored text to classify. */
export function hasUserTask(messages: readonly UserMessage[]): boolean {
  return messages.some(message => message.source.kind === 'user'
    && message.content.some(block => block.type === 'text' && block.text.trim().length > 0))
}

/**
 * Select one configured tier from human-authored text in the proposed step.
 * @param messages - claimed messages before prompt assembly.
 * @param routes - exact deployment route for every tier.
 * @returns the selected tier, route, and stable reason.
 */
export function routeAgentStep(
  messages: readonly UserMessage[],
  routes: TierRoutes,
): StepRoutingDecision {
  const task = messages
    .filter(message => message.source.kind === 'user')
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  if (HIGH_RISK.test(task)) return { tier: 'sol', selection: routes.sol, reason: 'high-risk' }
  if (COMPLEX.test(task)) return { tier: 'sol', selection: routes.sol, reason: 'complex' }
  if (LIGHTWEIGHT.test(task)) return { tier: 'luna', selection: routes.luna, reason: 'lightweight' }
  return { tier: 'terra', selection: routes.terra, reason: 'default' }
}
