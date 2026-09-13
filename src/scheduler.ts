import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Explicit per-Run selection. The service owns launched processes; this extension does not.
export default function (pi: ExtensionAPI) {
  async function call(path: string, signal?: AbortSignal, body?: unknown) {
    const url = process.env.THRESHOLD_SERVICE_URL;
    if (!url) throw new Error('Threshold service URL is not configured');
    const response = await fetch(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.THRESHOLD_RUN_TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Threshold technical error HTTP ${response.status}: ${data.error}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data };
  }
  pi.registerTool({ name: 'create_task', label: 'Create task', description: 'Create an ordinary Task in your Project. Project is bound by your Run. After a lost response, inspect the Board before creating again.',
    parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 300 }), instructions: Type.String({ minLength: 1, maxLength: 12000 }) }),
    execute: (_id, params, signal) => call('/agent/project/tasks', signal, params) });
  pi.registerTool({ name: 'start_run', label: 'Start Run', description: 'Start a peer worker on an existing Task and same-repository Git worktree. Create worktrees using ordinary Git first. Returns immediately; inspect_run/Board for progress. Workers survive your Run ending while service stays running. Default provider/model follows this Run; skills/extensions default empty, never inherited. All starts share service resource limits. A lost response does not mean no worker started: inspect Board before retrying. No Human Decision granted.',
    parameters: Type.Object({ taskId: Type.String(), workspacePath: Type.String(), objective: Type.String({ minLength: 1, maxLength: 6000 }),
      provider: Type.Optional(Type.String()), model: Type.Optional(Type.String()),
      skills: Type.Optional(Type.Array(Type.String())), extensions: Type.Optional(Type.Array(Type.String())) }),
    execute: (_id, params, signal) => call('/agent/project/runs', signal, params) });
  pi.registerTool({ name: 'inspect_run', label: 'Inspect Run', description: 'Read one Project Run, selected capabilities, process result and fresh Git observation at its actual workspace. An ended Run is not Task completion; unknown exit is not proof the worker stopped.',
    parameters: Type.Object({ runId: Type.String() }),
    execute: (_id, params, signal) => call(`/agent/project/runs/${encodeURIComponent(params.runId)}`, signal) });
}
