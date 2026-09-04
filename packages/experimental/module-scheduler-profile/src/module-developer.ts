/** Register the restricted module-development assistant. */

import type { Context } from '@deepseek-ai/cordis'
import { applyModule } from './module-dev.ts'

export const inject = ['moduleScheduler']

/** Register the module developer definition. */
export function apply(ctx: Context): void {
  applyModule(ctx)
}
