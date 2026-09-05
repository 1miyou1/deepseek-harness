import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { type TierRoutes } from './router.ts'
export * from './projection.ts'
export * from './router.ts'
export declare const name = 'agent-step-model-router'
export declare const inject: string[]
/** Exact deployment route for each task tier. */
export type Config = TierRoutes
/** Loader schema for the three exact deployment routes. */
export declare const Config: z<Config>
/** Install deterministic Agent-step routing before prompt assembly. */
export declare function apply(ctx: Context, config: Config): void
//# sourceMappingURL=index.d.ts.map
