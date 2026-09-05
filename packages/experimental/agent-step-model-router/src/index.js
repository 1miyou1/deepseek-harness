import z from '@deepseek-ai/schemastery';
import { modelSelectionFor } from '@deepseek-ai/dsh-agent';
import { modelRoutingDecisionProjection } from "./projection.js";
import { hasUserTask, routeAgentStep } from "./router.js";
export * from "./projection.js";
export * from "./router.js";
export const name = 'agent-step-model-router';
export const inject = ['sessionProjections'];
const routeSchema = z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
});
/** Loader schema for the three exact deployment routes. */
export const Config = z.object({
    luna: routeSchema.required(),
    terra: routeSchema.required(),
    sol: routeSchema.required(),
});
function hasExplicitSelection(events) {
    return events.some(event => event?.type === 'model/selection');
}
/** Install deterministic Agent-step routing before prompt assembly. */
export function apply(ctx, config) {
    ctx.sessionProjections.register(modelRoutingDecisionProjection);
    ctx.on('agent/route-step', async ({ agent, turn, step }, next) => {
        const routed = await next();
        if (!hasUserTask(routed.messages)
            || hasExplicitSelection(agent.session.snapshotEvents()))
            return routed;
        const selection = modelSelectionFor(agent.ctx);
        if (selection === undefined)
            return routed;
        const decision = routeAgentStep(routed.messages, config);
        agent.session.append('model/routing-decision', { turn, step, ...decision });
        selection.current = decision.selection;
        return routed;
    });
}
//# sourceMappingURL=index.js.map