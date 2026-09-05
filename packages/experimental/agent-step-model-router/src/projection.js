import { z } from 'zod';
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
});
/** Latest automatic route projected for Host and GUI consumers. */
export const modelRoutingDecisionProjection = {
    key: 'modelRoutingDecision',
    stateVersion: 1,
    stateSchema: decisionSchema.nullable(),
    init: () => null,
    apply: (state, event) => event.type === 'model/routing-decision' ? event.data : state,
    wire: { viewSchema: decisionSchema.nullable(), view: state => state },
};
//# sourceMappingURL=projection.js.map