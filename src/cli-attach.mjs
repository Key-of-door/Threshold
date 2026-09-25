import { createInterface, clearLine, cursorTo } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { format, preview } from './cli-format.mjs';
import { executionLabel } from './execution.mjs';

export function activityText(event, options = {}) {
  const f = format(options);
  if (event.type === 'reply' || event.type === 'input') return '\n' + f.text('head', event.type === 'reply' ? 'agent' : 'you') + '\n' + f.text('', event.text) + '\n';
  if (event.type === 'tool_start') return '  ' + f.text('dim', event.name) + (event.context ? '  ' + f.text('dim', preview(event.context, Math.max(10, (options.columns ?? 80) - event.name.length - 6), options.ascii)) : '');
  if (event.type === 'tool_end') return '  ' + f.text(event.failed ? 'error' : 'dim', `${event.name} / ${event.failed ? 'error' : 'finished'}`);
  return f.text(event.type === 'error' ? 'error' : 'dim', event.text);
}

// A local client view. Closing it aborts only HTTP observation, never the worker.
// Non-TTY and JSON are one snapshot; no prompts, redraws, animation or input consumption.
export async function attachRun({ id, call, options, input = process.stdin, output = process.stdout }) {
  const f = format(options), controller = new AbortController();
  const fetchLive = after => call(`/runs/${id}/live?after=${after}`, undefined, false, controller.signal);
  let snapshot = await fetchLive(0), cursor = 0, detached = false, lost = false, rl;
  const interactiveTerminal = options.tty && input.isTTY && !options.json;
  const write = text => {
    if (rl && options.redraw) { clearLine(output, 0); cursorTo(output, 0); }
    output.write(text + '\n');
    if (rl && !detached && options.redraw) rl.prompt(true);
  };
  if (options.json) { output.write(JSON.stringify(snapshot, null, 2) + '\n'); return; }
  write(f.logo() + f.title(snapshot.project, snapshot.task));
  write(f.title('Run ' + f.short(id), `${snapshot.run.provider} / ${snapshot.run.model}`));
  write(f.text('dim', `${snapshot.policy ?? 'Unavailable'} worker / conversation is temporary`));
  if (snapshot.run.objective) write(f.pair('Work', snapshot.run.objective));
  if (snapshot.run.execution) write(f.pair('Execution', executionLabel(snapshot.run.execution)));
  let state;
  function show(value) {
    if (value.truncated) write(f.text('dim', 'Earlier live activity is no longer available.'));
    for (const event of value.events) write(activityText(event, options));
    cursor = value.nextCursor;
    const next = value.active ? value.phase : value.run.status;
    if (next !== state) {
      write('\n' + (value.active ? f.text('accent', next) : f.state(value.run)));
      if (value.run.error) write(f.text('error', value.run.error));
      if (!value.active && value.run.execution?.stopReason) write(f.pair('Stop reason', value.run.execution.stopReason));
      if (value.active) write(f.text('dim', `${value.resources.unsettled} of ${value.resources.maxParallelRuns} active/unknown Run slots in use. Waiting workers still occupy a slot.`));
      state = next;
    }
    if (!value.available) write(f.text('dim', 'Live activity is not held in this service process. Inspect the Task and Git.'));
  }
  show(snapshot);
  if (!interactiveTerminal || !snapshot.active) return;
  write(f.text('dim', 'Enter to send. /detach or Ctrl+C leaves this view; the Run continues.'));
  write(f.command(`threshold run stop ${f.short(id)}`));
  const detach = () => { detached = true; controller.abort(); };
  const onSignal = () => detach();
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  rl = createInterface({ input, output, terminal: Boolean(options.redraw), historySize: 30 });
  rl.setPrompt(options.ascii ? '> ' : '› ');
  rl.on('SIGINT', detach); rl.on('close', detach);
  let sending = false;
  rl.on('line', async line => {
    if (line.trim() === '/detach') { detach(); return; }
    if (!line.trim()) { rl.prompt(); return; }
    if (sending) { write(f.text('warn', 'The previous input is still being submitted; this input was not sent.')); return; }
    sending = true;
    try {
      await call(`/runs/${id}/input`, { message: line }, false, controller.signal);
      // The shared live window will show Pi's acceptance once, including to other observers.
    } catch (error) { if (!detached) write(f.text('error', error.message)); }
    finally { sending = false; if (!detached) rl.prompt(true); }
  });
  rl.prompt();
  try {
    while (!detached && snapshot.active) {
      await delay(500, undefined, { signal: controller.signal });
      snapshot = await fetchLive(cursor); show(snapshot);
    }
  } catch (error) {
    if (!detached) { lost = true; write(f.text('error', 'Connection lost. Live state is no longer available.')); write(f.text('dim', error.message)); }
  } finally {
    const wasDetached = detached;
    detached = true; controller.abort(); rl.close();
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (wasDetached || lost) {
      write(`Detached from Run ${f.short(id)}. No stop was requested.`);
      if (sending) write(f.text('warn', 'An input submission was pending. Delivery is unconfirmed; inspect activity before resending.'));
      write(f.text('dim', lost ? 'Worker state is unconfirmed; inspect status when connected.' : 'It was active at the last observation; it may continue after this view closes.'));
      write(f.command(`threshold run stop ${f.short(id)}`));
    }
  }
  if (lost) throw new Error('Live connection lost; no stop was requested.');
}
