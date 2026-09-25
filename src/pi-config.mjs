import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function readConfig(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read configuration: ${file}. Expected a JSON object; existing bytes were not replaced.`);
  }
}

function writeConfig(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
}

function configuredProviders(agentDir) {
  return [...new Set([...Object.keys(readConfig(join(agentDir, 'models.json')).providers ?? {}),
    ...Object.keys(readConfig(join(agentDir, 'auth.json'))), readConfig(join(agentDir, 'settings.json')).defaultProvider].filter(Boolean))];
}

export async function modelRuntime(agentDir, providers) {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  let runtime;
  try {
    runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'),
      modelsStorePath: join(agentDir, 'models-store.json'), allowModelNetwork: false, refreshOnCreate: false });
    // Do not probe every unrelated provider (e.g. cloud metadata credentials) on local CLI reads.
    const selected = providers ?? configuredProviders(agentDir);
    if (selected.length) await runtime.refresh({ providers: selected, allowNetwork: false });
  } catch { throw new Error(`Pi configuration could not be loaded in ${agentDir}. Check local config files and permissions. No model request was sent.`); }
  if (runtime.getError()) throw new Error(`Pi could not load model configuration in ${agentDir}. Check models.json or run threshold setup. No model request was sent.`);
  return runtime;
}

export async function modelChoices(agentDir) {
  const checked = new Set(configuredProviders(agentDir));
  const runtime = await modelRuntime(agentDir, [...checked]), settings = readConfig(join(agentDir, 'settings.json'));
  return { agentDir, defaultProvider: settings.defaultProvider, defaultModel: settings.defaultModel,
    models: runtime.getModels().map(model => ({ provider: model.provider, id: model.id, name: model.name,
      configured: checked.has(model.provider) ? runtime.hasConfiguredAuth(model.provider) : null })) };
}

export async function checkModel(agentDir, provider, id) {
  const runtime = await modelRuntime(agentDir, [provider]);
  if (!runtime.getModel(provider, id)) throw new Error('Model not found in Pi configuration. Run threshold setup, or check --provider and --model. No Run started.');
  if (!runtime.hasConfiguredAuth(provider)) throw new Error('API key or provider login is missing in the service environment/Pi configuration. Run threshold setup, or set the provider environment variable before starting the service. No Run started.');
  return runtime.getModel(provider, id);
}

// Pi remains the owner of provider configuration, credential storage and model calls.
export async function setupModels(agentDir, ui, output = process.stdout) {
  const settingsFile = join(agentDir, 'settings.json'), modelsFile = join(agentDir, 'models.json');
  const settings = readConfig(settingsFile), config = readConfig(modelsFile);
  // Fail before any change when existing credential bytes are malformed.
  readConfig(join(agentDir, 'auth.json'));
  output.write(`Pi configuration: ${agentDir}\nAPI keys are saved in Pi's local auth.json (not encrypted, not Project data).\nNo model call or online key verification is performed.\n`);
  const provider = await ui.ask('Provider name', { fallback: settings.defaultProvider ?? 'deepseek', required: true });
  if (!/^[a-zA-Z0-9_-]+$/.test(provider)) throw new Error('Use a provider name containing letters, numbers, hyphens or underscores.');
  const model = await ui.ask('Model ID', { fallback: settings.defaultProvider === provider ? settings.defaultModel ?? '' : provider === 'deepseek' ? 'deepseek-flash' : '', required: true });
  const runtime = await modelRuntime(agentDir, [provider]);
  let selected = config.providers?.[provider];
  const known = runtime.getModel(provider, model);
  if (!known) {
    const baseUrl = await ui.ask('API base URL', { fallback: selected?.baseUrl ?? (provider === 'deepseek' ? 'https://api.deepseek.com' : ''), required: true });
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('Use an HTTP(S) base URL without credentials, query or fragment.');
    const api = selected?.api ?? (provider === 'deepseek' ? 'openai-completions' : await ui.choose('API format',
      ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].map(id => ({ id, label: id })), 'openai-completions'));
    const example = JSON.parse(readFileSync(new URL('../examples/pi/models.json', import.meta.url))).providers.deepseek.models[0];
    // The documented Flash example is not a capacity promise for arbitrary models or gateways.
    const officialFlash = provider === 'deepseek' && model === 'deepseek-flash' && url.origin === 'https://api.deepseek.com';
    output.write('Model is not in the local Pi catalog. Confirm its documented capacity; these are declarations, not an online capability check.\n');
    const capacity = async (label, fallback) => {
      const value = await ui.ask(label, { fallback: fallback ? String(fallback) : '', required: true });
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} must be a positive integer. Nothing saved.`);
      return Number(value);
    };
    const contextWindow = await capacity('Model context capacity (tokens)', officialFlash ? example.contextWindow : undefined);
    const maxTokens = await capacity('Model output capacity (tokens)', officialFlash ? example.maxTokens : undefined);
    if (maxTokens > contextWindow) throw new Error('Output capacity must not exceed context capacity. Nothing saved.');
    const entry = { ...(officialFlash ? example : {}), id: model, name: model, contextWindow, maxTokens };
    selected = { ...selected, baseUrl, api, models: [...(selected?.models ?? []), entry] };
  }
  const capacity = known ?? selected.models.find(entry => entry.id === model);
  output.write(`Local model capacity: contextWindow=${capacity.contextWindow}, maxTokens=${capacity.maxTokens}\n`);
  output.write(`Capacity overrides live in ${modelsFile}. Existing declarations are preserved; Run flags cannot raise them.\n`);
  const key = await ui.ask('API key (hidden; Enter keeps existing credentials)', { secret: true });
  if (key && /[\s\x00-\x1f\x7f]/.test(key)) throw new Error('API key must not contain spaces or control characters. Nothing saved.');
  if (!key && !runtime.hasConfiguredAuth(provider)) throw new Error('No existing credential was found. Run threshold setup and enter a key when prompted.');
  if (key && selected && Object.hasOwn(selected, 'apiKey')) {
    // The user chose a stored key: remove this provider's older env/command override.
    selected = { ...selected }; delete selected.apiKey;
  }
  let shellPath = settings.shellPath;
  if (process.platform === 'win32' && !shellPath) {
    const installed = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(existsSync);
    shellPath = await ui.ask('Git Bash executable', { fallback: installed ?? '', required: true });
    if (!existsSync(shellPath)) throw new Error('Git Bash executable not found. Install Git for Windows or enter its actual path.');
  }
  mkdirSync(agentDir, { recursive: true });
  if (selected) writeConfig(modelsFile, { ...config, providers: { ...config.providers, [provider]: selected } });
  if (key) {
    try {
      const configured = await modelRuntime(agentDir, [provider]);
      // Pi performs its ordinary locked auth.json update. Never put the key in argv or output.
      let supplied = false;
      await configured.login(provider, 'api_key', { prompt: async prompt => {
        if (prompt.type === 'secret' && !supplied) {
          supplied = true;
          return key.replaceAll('$', () => '$$').replace(/^!/, '$!');
        }
        if (prompt.type === 'select') return ui.choose(prompt.message, prompt.options);
        return ui.ask(prompt.message, { secret: prompt.type === 'secret', required: true });
      }, notify() {} });
    } catch {
      throw new Error('Pi could not finish saving the credential. Model configuration may already be saved; inspect Pi configuration and rerun threshold setup.');
    }
  }
  writeConfig(settingsFile, { ...settings, defaultProvider: provider, defaultModel: model, ...(shellPath ? { shellPath } : {}) });
  output.write(`Saved default model: ${provider} / ${model}\nCredentials stay in ${join(agentDir, 'auth.json')}\nNew Runs load this configuration; existing Runs are unchanged.\n`);
  return { provider, model, agentDir };
}
