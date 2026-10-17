import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const name = 'adaptive-dpira-max'
export const inject = ['systemPrompt', 'sessionProjections', 'planMode']

const instructions = readFileSync(new URL('../framework/dpira.md', import.meta.url), 'utf8').trim()
const adaptiveRouter = readFileSync(new URL('../framework/adaptive-router.md', import.meta.url), 'utf8').trim()
const dpiraPlan = readFileSync(new URL('../framework/dpira-plan.md', import.meta.url), 'utf8').trim()

// Successful slash commands provide durable state via DSH's session log.
export const adaptiveMaxProjection = {
  key: 'adaptiveMax',
  stateVersion: 1,
  stateSchema: z.object({
    active: z.boolean(),
    running: z.object({ commandId: z.string(), wanted: z.boolean() }).strict().nullable(),
  }).strict(),
  init: () => ({ active: false, running: null }),
  apply: (state, event) => {
    if (event.type === 'command/run' && event.data.name === 'adaptive-max') {
      const choice = event.data.args?.trim()
      if (choice !== 'on' && choice !== 'off') return state
      return { ...state, running: { commandId: event.data.commandId, wanted: choice === 'on' } }
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      return {
        active: event.data.kind === 'success' ? state.running.wanted : state.active,
        running: null,
      }
    }
    return state
  },
  wire: {
    viewSchema: z.object({ active: z.boolean() }).strict(),
    view: state => ({ active: state.active }),
  },
}

export function nativeMode(ctx, agent) {
  const goal = ctx.sessionProjections.stateOf(agent.session, 'goal')?.current?.goal
  if (goal?.phase === 'active') return 'goal'
  const plan = ctx.planMode.get(agent)
  return (plan?.pending ?? plan?.active) === true ? 'plan' : null
}

export function ordinaryAdaptive(ctx, context) {
  const agent = context.agent
  if (agent == null) return false
  return ctx.sessionProjections.stateOf(agent.session, 'agentPreset') === 'adaptive'
    && nativeMode(ctx, agent) === null
}

export function routerText(ctx, context) {
  return ordinaryAdaptive(ctx, context) ? adaptiveRouter : ''
}

export function dpiraText(ctx, context) {
  if (!ordinaryAdaptive(ctx, context)) return ''
  const agent = context.agent
  return ctx.sessionProjections.stateOf(agent.session, 'adaptiveMax')?.active === true
    ? instructions
    : ''
}

export function dpiraPlanText(ctx, context) {
  const agent = context.agent
  if (agent == null) return ''
  return ctx.sessionProjections.stateOf(agent.session, 'agentPreset') === 'adaptive'
    && ctx.sessionProjections.stateOf(agent.session, 'adaptiveMax')?.active === true
    && nativeMode(ctx, agent) === 'plan'
    ? dpiraPlan
    : ''
}

export function apply(ctx) {
  ctx.sessionProjections.register(adaptiveMaxProjection)
  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      definitionId: '@local/dsh-adaptive-mode',
      name: 'adaptive-max',
      description: 'Enable or disable the DPIRA framework for this adaptive-mode session.',
      input: { hint: 'on|off' },
      handler: ({ agent, rawInput }) => {
        const choice = rawInput.trim()
        if (choice !== 'on' && choice !== 'off') {
          return { kind: 'error', text: 'Use /adaptive-max on or /adaptive-max off.' }
        }
        if (choice === 'on' && nativeMode(ctx, agent) !== null) {
          return { kind: 'error', text: 'DPIRA Max is suspended while native Plan or Goal mode is active.' }
        }
        return { kind: 'success', text: `DPIRA Max ${choice}.` }
      },
    })
  })
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adaptive:router',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 10,
    text: context => routerText(ctx, context),
  }), 'adaptive-dpira-max.router()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adaptive:dpira-max',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 50,
    text: context => dpiraText(ctx, context),
  }), 'adaptive-dpira-max.section()')
  // Max owns the Plan policy while it is on. Keep the native Plan controller,
  // session state and exit_plan_mode review, but replace its model-facing policy.
  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const text = dpiraPlanText(ctx, context)
    if (!text) return assembled
    const originals = assembled.sections.filter(section => section.name === 'plan:policy' && section.text)
    if (originals.length !== 1) throw new Error('DPIRA Max Plan requires exactly one active plan:policy section')
    return {
      ...assembled,
      sections: assembled.sections.map(section => section.name === 'plan:policy'
        ? { ...section, text }
        : section),
    }
  }), 'adaptive-dpira-max.own-plan-policy()')
}
