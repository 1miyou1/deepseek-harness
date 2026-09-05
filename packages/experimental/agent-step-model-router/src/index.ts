import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { modelSelectionFor } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { modelRoutingDecisionProjection } from './projection.ts'
import { hasUserTask, routeAgentStep, type TierRoutes } from './router.ts'

export * from './projection.ts'
export * from './router.ts'

export const name = 'agent-step-model-router'
export const inject = ['sessionProjections']

/** Exact deployment route for each task tier. */
export type Config = TierRoutes

const routeSchema = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
})

/** Loader schema for the three exact deployment routes. */
export const Config: z<Config> = z.object({
  luna: routeSchema.required(),
  terra: routeSchema.required(),
  sol: routeSchema.required(),
})

function hasExplicitSelection(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'model/selection')
}

/** Install deterministic Agent-step routing before prompt assembly. */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(modelRoutingDecisionProjection)
  ctx.on('agent/route-step', async ({ agent, turn, step }, next) => {
    const routed = await next()
    if (!hasUserTask(routed.messages)
      || hasExplicitSelection(agent.session.snapshotEvents())) return routed
    const selection = modelSelectionFor(agent.ctx)
    if (selection === undefined) return routed
    const decision = routeAgentStep(routed.messages, config)
    agent.session.append('model/routing-decision', { turn, step, ...decision })
    selection.current = decision.selection
    return routed
  })
}
