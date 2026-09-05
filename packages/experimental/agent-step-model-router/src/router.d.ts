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
/** Whether the proposed step contains human-authored text to classify. */
export declare function hasUserTask(messages: readonly UserMessage[]): boolean
/**
 * Select one configured tier from human-authored text in the proposed step.
 * @param messages - claimed messages before prompt assembly.
 * @param routes - exact deployment route for every tier.
 * @returns the selected tier, route, and stable reason.
 */
export declare function routeAgentStep(messages: readonly UserMessage[], routes: TierRoutes): StepRoutingDecision
//# sourceMappingURL=router.d.ts.map
