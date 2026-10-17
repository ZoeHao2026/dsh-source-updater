export const name = 'adaptive-plan-entry'
export const inject = ['tools', 'planMode', 'sessionProjections']

// The native /plan command and Plan button bypass this tool. They are explicit
// user choices, while this tool is only for an agent's automatic selection.
export function automaticPlanDecision(ctx, agent, args) {
  const projections = ctx.sessionProjections
  const goal = projections.stateOf(agent.session, 'goal')?.current?.goal
  if (goal?.phase === 'active') return { allowed: false, reason: 'active-goal' }

  const adaptive = projections.stateOf(agent.session, 'agentPreset') === 'adaptive'
  const max = projections.stateOf(agent.session, 'adaptiveMax')?.active === true
  if (adaptive && max &&
    (args.materiallyAmbiguous !== true || args.exceptionallyDifficult !== true)) {
    return { allowed: false, reason: 'dpira-plan-criteria-not-met' }
  }
  return { allowed: true }
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'enter_plan_mode',
    description: 'Select Plan automatically only when the active adaptive Router permits it. With Max on, both materiallyAmbiguous and exceptionallyDifficult must be true; Plan then follows DPIRA D/P rules. With Max off, follow the ordinary Router. The user-selected Plan button and /plan are explicit choices and do not use this tool. Call this as the only tool in the response; Plan becomes active at the next accepted step.',
    parameters: {
      type: 'object',
      properties: {
        materiallyAmbiguous: { type: 'boolean', description: 'The task lacks material requirements that cannot be resolved through routine inspection.' },
        exceptionallyDifficult: { type: 'boolean', description: 'The task requires unusually difficult design or coordination beyond routine implementation.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string' },
          selected: { type: 'boolean' }
        },
        required: ['outcome', 'selected']
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.selected
          ? `Plan mode selected (${value.outcome}). On the next step, inspect and prepare a reviewable plan before any mutation.`
          : `Plan mode was not selected (${value.outcome}). Continue the active workflow without switching modes.`
      }]
    },
    isConcurrencySafe: () => false,
    execute: async (_args, exec) => {
      const args = _args ?? {}
      if (Object.keys(args).some(key => !['materiallyAmbiguous', 'exceptionallyDifficult'].includes(key))) {
        throw new Error('enter_plan_mode received unsupported arguments')
      }
      if (!exec.agent) throw new Error('enter_plan_mode requires an agent session')
      const decision = automaticPlanDecision(ctx, exec.agent, args)
      if (!decision.allowed) return { outcome: decision.reason, selected: false }
      const outcome = ctx.planMode.set(exec.agent, true)
      return { outcome, selected: true }
    }
  })
}
