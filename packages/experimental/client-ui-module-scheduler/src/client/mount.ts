/** Source-safe Module Scheduler browser registration and Remote mount lifecycle. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-experimental-module-scheduler/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ModuleSchedulerAction, type ModuleSchedulerActionInjected } from './ModuleSchedulerAction.tsx'
import { en, NS, zh, type ModuleSchedulerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Module Scheduler controls and run-list copy. */
    'module-scheduler': ModuleSchedulerKey
  }
}

/** Required browser services for RPC, slots, and localized copy. */
export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-module-scheduler: dictionaries')
  const actions: ModuleSchedulerActionInjected = {
    async load(sessionId) {
      return await ctx.remote.moduleScheduler.view(sessionId)
    },
    async start(sessionId, request) {
      return await ctx.remote.moduleScheduler.start(sessionId, request)
    },
    async cancel(sessionId, runId) {
      return await ctx.remote.moduleScheduler.cancel(sessionId, runId)
    },
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'module-scheduler',
      order: 30,
      locale: NS,
      inject: () => actions,
    }, ModuleSchedulerAction),
  )
}

/**
 * Mount one generated Module Scheduler Remote contribution, then register its browser UI.
 * @param ctx - Client Context carrying locale, slot, and Remote services.
 * @param contribution - generated Module Scheduler descriptors selected by the browser entry.
 * @returns disposer for both the UI registrations and Remote namespace.
 */
export async function mountModuleSchedulerUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.moduleScheduler', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
