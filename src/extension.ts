import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  async function call(path: string, signal?: AbortSignal, body?: unknown) {
    const url = process.env.THRESHOLD_SERVICE_URL;
    if (!url) throw new Error('Threshold service URL is not configured');
    const response = await fetch(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.THRESHOLD_RUN_TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Threshold technical error HTTP ${response.status}: ${data.error}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data };
  }
  pi.registerTool({ name: 'read_task', label: 'Read task', description: 'Read persistent task, latest Agent checkpoint, recent run observations and a fresh Git observation. Recheck relevant files and Git before continuing; checkpoint is a summary.',
    parameters: Type.Object({}), execute: (_id, _params, signal) => call('/agent/task', signal) });
  pi.registerTool({ name: 'save_checkpoint', label: 'Save checkpoint', description: 'Append a meaningful work summary with test observations, open issues and next step. Does not complete the Task. If a write response is lost, read_task before retrying.',
    parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 12000 }) }),
    execute: (_id, params, signal) => call('/agent/checkpoints', signal, { summary: params.summary }) });
  pi.registerTool({ name: 'fake_deploy', label: 'Fake deploy', description: 'Request a local fake deployment for staging or preview. ASK/NO affects only this operation; continue ordinary work. GO includes a local DB result, never a real deployment.',
    parameters: Type.Object({ target: Type.String() }), execute: (_id, params, signal) => call('/agent/fake-deploy', signal, { target: params.target }) });
}
