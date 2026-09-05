import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import type { ModelTier, RoutingReason } from './router.ts'
/** Durable explanation for one automatic Agent-step route. */
export interface ModelRoutingDecision {
  readonly turn: number
  readonly step: number
  readonly tier: ModelTier
  readonly selection: ModelSelection
  readonly reason: RoutingReason
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Automatic model route selected before prompt assembly for one Agent step. */
    'model/routing-decision': ModelRoutingDecision
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest automatic step-model routing decision. */
    modelRoutingDecision: ModelRoutingDecision | null
  }
  interface SessionProjectionMap {
    /** Latest automatic step-model routing decision. */
    modelRoutingDecision: ModelRoutingDecision | null
  }
}
/** Latest automatic route projected for Host and GUI consumers. */
export declare const modelRoutingDecisionProjection: {
  key: 'modelRoutingDecision'
  stateVersion: number
  stateSchema: z.ZodNullable<z.ZodType<ModelRoutingDecision, unknown, z.core.$ZodTypeInternals<ModelRoutingDecision, unknown>>>
  init: () => null
  apply: (state: NoInfer<ModelRoutingDecision | null>, event: import('@deepseek-ai/dsh-session').SessionEvent) => ModelRoutingDecision | null
  wire: {
    viewSchema: z.ZodNullable<z.ZodType<ModelRoutingDecision, unknown, z.core.$ZodTypeInternals<ModelRoutingDecision, unknown>>>
    view: (state: NoInfer<ModelRoutingDecision | null>) => ModelRoutingDecision | null
  }
}
//# sourceMappingURL=projection.d.ts.map
