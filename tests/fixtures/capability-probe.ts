// Test observer only: no model call, no persistent or project state.
export default function (pi) {
  pi.registerCommand('capability-probe', {
    description: 'Inspect this test session',
    handler: async (_args, ctx) => {
      pi.sendMessage({ customType: 'capability-probe', content: JSON.stringify({
        tools: pi.getActiveTools(), systemPrompt: ctx.getSystemPrompt(),
      }), display: false }, { triggerTurn: false });
    },
  });
}
