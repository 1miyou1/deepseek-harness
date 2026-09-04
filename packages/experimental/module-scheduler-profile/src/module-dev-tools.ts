/** Register the restricted host tools used by the module developer. */

import type { Context } from '@deepseek-ai/cordis'
import { applyTools } from './module-dev.ts'

export const inject = ['moduleScheduler', 'sandbox', 'subprocess']

/** Register module-development tools in the scheduler's private Host registry. */
export function apply(ctx: Context): void {
  applyTools(ctx)
}
