/** Browser entry binding the generated Module Scheduler Remote artifact to its Client UI. */

import moduleSchedulerRemote from '@deepseek-ai/dsh-experimental-module-scheduler/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountModuleSchedulerUi } from './mount.ts'

export { inject } from './mount.ts'
export type {
  ModuleSchedulerActionInjected,
  ModuleSchedulerActionProps,
  ModuleSchedulerRemoteResult,
} from './ModuleSchedulerAction.tsx'
export type { ModuleSchedulerKey } from './locales.ts'

/** Mount the generated Module Scheduler Remote contribution and its browser UI. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountModuleSchedulerUi(ctx, moduleSchedulerRemote)
}
