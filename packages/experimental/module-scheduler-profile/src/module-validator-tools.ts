/** Register the read-only module validator Host tool. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyModuleValidator, type ModuleValidatorConfig } from './module-validator.ts'

export const name = 'module-validator-tools'
export const inject = ['moduleScheduler', 'sandbox', 'subprocess']
export type Config = ModuleValidatorConfig
/** Loader schema for the validator's deployment-owned budgets and repository root. */
export const Config: z<Config> = z.object({
  stepTimeoutMs: z.number().default(30_000),
  totalTimeoutMs: z.number().default(120_000),
  maxOutputBytes: z.number().default(16_384),
  graceMs: z.number().default(1_000),
  root: z.string().default(process.cwd()),
})
/** Register the module definition and private subprocess tool. */
export function apply(ctx: Context, config: Config): void { applyModuleValidator(ctx, config) }
