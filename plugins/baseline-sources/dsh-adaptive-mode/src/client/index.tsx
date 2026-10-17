import { useEffect, useState } from 'react'

type SessionProjection = {
  agentPreset?: unknown
  adaptiveMax?: { active?: unknown } | null
  plan?: { active?: unknown; pending?: unknown } | null
  goal?: { goal?: { phase?: unknown } } | null
}

type SessionListState = {
  byId: Record<string, { projectionValues?: SessionProjection } | undefined>
}

type CommandResult =
  | { ok: true; value: { result?: { kind?: string; text?: string } } | undefined }
  | { ok: false; error: { message?: string; code?: string } }

type PendingToggle = { target: boolean; complete: boolean }

type MaxButtonProps = {
  sessionId: string
  useSessions: <T>(select: (state: SessionListState) => T) => T
  execute: (sessionId: string, command: string, args: unknown[]) => Promise<CommandResult>
}

const css = `
.dsh-adaptive-max { position: relative; display: inline-flex; align-items: center; flex: none; }
.dsh-adaptive-max__button {
  min-height: 28px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-secondary, #62666d);
  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #b7bcc5);
  font-family: inherit; font-size: 12px; font-weight: 600; line-height: 20px;
  cursor: pointer; white-space: nowrap;
}
.dsh-adaptive-max__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #333840); }
.dsh-adaptive-max__button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary, #fff); border-color: #5489ff;
  background: color-mix(in srgb, #5489ff 22%, transparent);
}
.dsh-adaptive-max__button:focus-visible { outline: 2px solid #5489ff; outline-offset: 2px; }
.dsh-adaptive-max__button:disabled { cursor: not-allowed; opacity: .65; }
.dsh-adaptive-max__button[aria-busy="true"] { cursor: progress; }
.dsh-adaptive-max__notice {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20;
  width: max-content; max-width: min(340px, 75vw); padding: 8px 10px;
  border: 1px solid #5489ff; border-radius: 8px;
  background: #1d345b; color: #fff; font: 12px/1.4 sans-serif;
  white-space: normal; box-shadow: 0 4px 16px #0004;
}
.dsh-adaptive-max__error {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20;
  width: max-content; max-width: min(320px, 75vw); padding: 8px 10px;
  border-radius: 8px; background: #822c2c; color: #fff; font: 12px/1.4 sans-serif;
  white-space: normal; box-shadow: 0 4px 16px #0004;
}
.dsh-adaptive-max--plan-status .dsh-adaptive-max__error { bottom: calc(100% + 70px); }
`

function AdaptiveMaxButton({ sessionId, useSessions, execute }: MaxButtonProps) {
  const preset = useSessions((state) => state.byId[sessionId]?.projectionValues?.agentPreset)
  const active = useSessions(
    (state) => state.byId[sessionId]?.projectionValues?.adaptiveMax?.active === true,
  )
  const planActive = useSessions((state) => {
    const plan = state.byId[sessionId]?.projectionValues?.plan
    return plan?.pending === true ? plan.active !== true : plan?.active === true
  })
  const goalActive = useSessions(
    (state) => state.byId[sessionId]?.projectionValues?.goal?.goal?.phase === 'active',
  )
  const suspended = planActive || goalActive
  const dpiraPlanActive = planActive && active && !goalActive
  const [pending, setPending] = useState<PendingToggle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

  useEffect(() => {
    setPending(null)
    setError(null)
  }, [sessionId])

  useEffect(() => {
    if (pending?.complete && active === pending.target) {
      setPending(null)
      setError(null)
    }
  }, [active, pending])

  useEffect(() => {
    if (!pending?.complete) return
    const timer = window.setTimeout(() => {
      setPending(null)
      setError(zh ? 'Max 状态尚未同步，请重试。' : 'Max state did not sync. Try again.')
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [pending, zh])

  if (preset !== 'adaptive') return null

  const planNotice = zh
    ? 'Max 计划（DPIRA）已启用；Max 保持开启，计划期间暂不可切换。'
    : 'Max Plan (DPIRA) is active. Max remains on and cannot be switched during planning.'
  const label = dpiraPlanActive
    ? zh
      ? 'Max 计划（DPIRA）已启用；Max 保持开启，计划期间暂不可切换'
      : 'Max Plan (DPIRA) is active. Max remains on and cannot be switched during planning'
    : suspended
    ? zh
      ? `Max 已暂停，当前遵循${planActive ? ' Plan 模式' : ''}${planActive && goalActive ? '与' : ''}${goalActive ? '目标模式' : ''}；原开关状态已保留`
      : `Max is paused while following ${planActive ? 'Plan mode' : ''}${planActive && goalActive ? ' and ' : ''}${goalActive ? 'Goal mode' : ''}; its switch state is preserved`
    : zh
      ? active ? 'Max 已启用，点击关闭 DPIRA 流程' : '点击启用 Max 与 DPIRA 流程'
      : active ? 'Max is on. Turn off the DPIRA workflow' : 'Turn on Max and the DPIRA workflow'

  async function toggle() {
    if (pending !== null || suspended) return
    const target = !active
    setError(null)
    setPending({ target, complete: false })
    try {
      const result = await execute(sessionId, target ? '/adaptive-max on' : '/adaptive-max off', [])
      if (!result.ok) throw new Error(result.error.message ?? result.error.code ?? 'Command failed')
      if (result.value === undefined) throw new Error('Adaptive Max command is unavailable')
      if (result.value.result?.kind !== 'success') {
        throw new Error(result.value.result?.text ?? 'Adaptive Max command failed')
      }
      setPending((current) => current?.target === target ? { target, complete: true } : current)
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <span className={`dsh-adaptive-max${dpiraPlanActive ? ' dsh-adaptive-max--plan-status' : ''}`}>
      <button
        type="button"
        className="dsh-adaptive-max__button"
        aria-label={label}
        aria-pressed={active}
        aria-busy={pending !== null}
        title={label}
        disabled={pending !== null || suspended}
        onClick={() => { void toggle() }}
      >
        Max
      </button>
      {dpiraPlanActive ? <span role="status" className="dsh-adaptive-max__notice">{planNotice}</span> : null}
      {error === null ? null : <span role="alert" className="dsh-adaptive-max__error">{error}</span>}
    </span>
  )
}

export const inject = ['slots', 'remote', 'remote.commands']

export function apply(ctx: {
  effect: (effect: () => () => void, label: string) => void
  slots: {
    inject: (name: string, install: () => unknown) => void
    register: (entry: unknown, component: unknown) => () => void
  }
  remote: {
    commands: { execute: MaxButtonProps['execute'] }
  }
}): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@local/dsh-adaptive-mode'
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'adaptive-max: button styles')

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'adaptive-max',
        order: 10,
        inject: () => ({ execute: ctx.remote.commands.execute.bind(ctx.remote.commands) }),
      },
      AdaptiveMaxButton,
    ),
  )
}
