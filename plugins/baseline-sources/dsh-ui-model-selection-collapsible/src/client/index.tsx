import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

import { CollapsibleModelSelect } from './CollapsibleModelSelect.js'
import { ChatModelSelect } from './ChatModelSelect.js'
import { SettingsSection } from './SettingsSection.js'
import { dictionaries, SETTINGS_LOCALE_NS } from './locales.js'
import { BrowserPreferencesStore } from './preferences.js'

export const inject = ['slots', 'sessions', 'locale']

function hasMethod(value: unknown, name: string): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false
  return typeof (value as Record<string, unknown>)[name] === 'function'
}

function isCompatibleDirectory(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const directory = value as Record<string, unknown>
  if (!hasMethod(directory, 'load') || !hasMethod(directory, 'select')) return false
  const store = directory.store
  if (!hasMethod(store, 'getSnapshot') || !hasMethod(store, 'subscribe')) return false

  const snapshot = (store as { getSnapshot: () => unknown }).getSnapshot()
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const state = snapshot as Record<string, unknown>
  return (
    Array.isArray(state.groups) &&
    Array.isArray(state.failures) &&
    typeof state.status === 'string' &&
    (state.current === null || typeof state.current === 'object') &&
    (state.routable === null || typeof state.routable === 'boolean') &&
    (state.pending === null || typeof state.pending === 'object') &&
    (state.error === null || typeof state.error === 'string')
  )
}

/**
 * Mount the custom priority -1 seat only while the official model directory
 * service exists. The official priority 0 seat remains registered as fallback.
 */
export function apply(ctx: ClientContext): void {
  const preferences = new BrowserPreferencesStore()
  ctx.effect(
    () => () => preferences.dispose(),
    'ui-model-selection-collapsible: browser preference storage',
  )
  ctx.effect(
    () => ctx.locale.register(SETTINGS_LOCALE_NS, dictionaries),
    'ui-model-selection-collapsible: settings dictionaries',
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'model-selection-collapsible',
        order: 30,
        label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)('nav'),
        locale: SETTINGS_LOCALE_NS,
        inject: () => ({ preferences }),
      },
      SettingsSection,
    ),
  )

  // Standalone-chat model seat (declared by dsh-standalone-chat): reuse the
  // collapsible selector against the chat page's directory adapter. The seat
  // is only declared while the chat plugin is installed, so this injection
  // waits for its declaration and stays inert otherwise.
  ctx.slots.inject('chat.input.model', () =>
    ctx.slots.register(
      {
        name: 'chat.input.model',
        locale: 'model',
        inject: () => ({ preferences }),
      },
      ChatModelSelect,
    ),
  )

  ctx.inject(['modelDirectories', 'remote', 'remote.session'], (scope) => {
    const models = scope.modelDirectories
    if (typeof models?.directoryFor !== 'function') return

    const sessions = scope.sessions
    if (typeof sessions?.subagentAddress !== 'function') return
    scope.slots.inject('conversation.input.model', () =>
      scope.slots.register(
        {
          name: 'conversation.input.model',
          locale: 'model',
          priority: -1,
          inject: (sessionId) => {
            // The slots facade passes an unbranded string for this session seat.
            const session = sessionId as Parameters<typeof models.directoryFor>[0]
            const directory = models.directoryFor(session)
            // A single slot's render boundary retires this priority -1 entry on
            // an inject error, exposing the official priority 0 occupant.
            if (!isCompatibleDirectory(directory)) {
              throw new Error('Incompatible DSH model directory; using the official model selector')
            }
            const available = sessions.subagentAddress(session) === undefined

            return {
              available,
              preferences,
              directory: directory.store,
              load: () => {
                if (available) void directory.load().catch(() => undefined)
              },
              select: (selection: ModelSelection) =>
                available ? directory.select(selection) : Promise.resolve(undefined),
            }
          },
        },
        CollapsibleModelSelect,
      ),
    )
  })
}
