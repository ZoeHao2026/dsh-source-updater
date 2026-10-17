/**
 * `enter_plan_mode` for the code-video mode.
 *
 * Same contract as the adaptive-mode entry: the model selects native DSH plan
 * mode as the only tool call in a response, and plan mode becomes active at the
 * next accepted step. Code-video uses it only when the user asks for a plan
 * first or when the creative direction is genuinely undecidable without the
 * user, not as a mandatory gate for every video request.
 */
export const name = 'code-video-plan-entry'
export const inject = ['tools', 'planMode']

export function apply(ctx) {
  ctx.tools.register({
    name: 'enter_plan_mode',
    description:
      'Select native DSH plan mode before producing the video, when the user asked for a plan first or the creative direction is genuinely undecidable without the user. Call this as the only tool in the current assistant response; plan mode becomes active at the next accepted step. For an ordinary one-line video request, decide reasonable defaults yourself instead of calling this.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
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
        text: `Plan mode selected (${value.outcome}). On the next step, prepare the creative plan and storyboard for review before writing production code.`
      }]
    },
    isConcurrencySafe: () => false,
    execute: async (_args, exec) => {
      if (Object.keys(_args).length !== 0) throw new Error('enter_plan_mode accepts no arguments')
      if (!exec.agent) throw new Error('enter_plan_mode requires an agent session')
      const outcome = ctx.planMode.set(exec.agent, true)
      return { outcome, selected: true }
    }
  })
}
