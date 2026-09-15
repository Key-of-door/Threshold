import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.THRESHOLD_SERVICE_URL;
  async function request(path: string, toolCallId: string, signal: AbortSignal | undefined, summary?: string) {
    if (!baseUrl) throw new Error('Threshold service URL is not configured');
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: summary === undefined ? 'GET' : 'PUT',
        headers: { 'content-type': 'application/json', 'x-pi-tool-call-id': toolCallId },
        body: summary === undefined ? undefined : JSON.stringify({ summary }),
        signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
        redirect: 'error',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(body) }], details: body };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Threshold service technical error: ${message}.${summary === undefined ? '' : ' The checkpoint may already have been saved; read_task before retrying.'}`);
    }
  }
  pi.registerTool({
    name: 'read_task', label: 'Read task',
    description: 'Read the current project task and latest checkpoint from the Threshold service.',
    parameters: Type.Object({}),
    execute: (id, _params, signal) => request('/task', id, signal),
  });
  pi.registerTool({
    name: 'save_checkpoint', label: 'Save checkpoint',
    description: 'Save your work summary as the latest checkpoint. This does not change Task status or declare completion.',
    parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 4000 }) }),
    execute: (id, params, signal) => request('/checkpoint', id, signal, params.summary),
  });
}
