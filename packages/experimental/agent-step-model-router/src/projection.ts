import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
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

const decisionSchema = z.object({
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  tier: z.enum(['luna', 'terra', 'sol']),
  selection: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
  }),
  reason: z.enum(['lightweight', 'default', 'complex', 'high-risk']),
}) as unknown as z.ZodType<ModelRoutingDecision>

/** Latest automatic route projected for Host and GUI consumers. */
export const modelRoutingDecisionProjection = {
  key: 'modelRoutingDecision',
  stateVersion: 1,
  stateSchema: decisionSchema.nullable(),
  init: () => null,
  apply: (state, event) => event.type === 'model/routing-decision' ? event.data : state,
  wire: { viewSchema: decisionSchema.nullable(), view: state => state },
} satisfies ProjectionDefinition<'modelRoutingDecision', ModelRoutingDecision | null>
