import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import collaboration from '../pi-phase-b/extension.ts';

export default function (pi: ExtensionAPI) {
  collaboration(pi); // Ordinary collaboration still talks directly to Phase B service.
  pi.registerTool({
    name: 'fake_deploy', label: 'Fake deploy',
    description: 'Request a local fake deployment. ASK/NO blocks only this deployment; continue unrelated ordinary work. GO includes the adapter execution result.',
    parameters: Type.Object({ target: Type.String({ description: 'staging or preview' }) }),
    async execute(_id, params, signal) {
      const baseUrl = process.env.THRESHOLD_CONTROL_URL;
      if (!baseUrl) throw new Error('Fake deploy service is not configured');
      try {
        const response = await fetch(new URL('/fake-deploy', baseUrl), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: params.target }),
          signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
          redirect: 'error',
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`);
        return { content: [{ type: 'text', text: JSON.stringify(body) }], details: body };
      } catch (error) {
        throw new Error(`Fake deploy technical error: ${error instanceof Error ? error.message : String(error)}. Do not infer whether an effect occurred from a transport error.`);
      }
    },
  });
}
