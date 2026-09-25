// Background work gets an explicit wall-clock limit, including tool loops.
export const defaultTurnTimeoutSeconds = 1800;
export function executionSettings(interactive, seconds) {
  if (interactive && seconds !== undefined) throw new Error('turnTimeoutSeconds applies only to background Runs; omit --turn-timeout with --attach');
  if (seconds !== undefined && (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 2147483))
    throw new Error('turnTimeoutSeconds must be an integer from 0 to 2147483 seconds (0 disables the deadline)');
  return { mode: interactive ? 'interactive' : 'background', turnTimeoutSeconds: interactive ? null : seconds ?? defaultTurnTimeoutSeconds };
}

export function executionLabel(execution) {
  if (!execution) return 'Not recorded';
  if (execution.mode === 'interactive') return 'Interactive / no turn deadline';
  return execution.turnTimeoutSeconds === 0 ? 'Background / no turn deadline'
    : `Background / ${execution.turnTimeoutSeconds}s turn deadline`;
}
