// Run-local controls for the pinned Pi adapter. Never writes Pi configuration.
export const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function runSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('modelSettings must be an object');
  const result = {};
  for (const key of Object.keys(value)) {
    if (!['thinking', 'contextWindow', 'maxOutputTokens'].includes(key)) throw new Error('Unknown modelSettings field');
    if (value[key] === undefined) continue;
    if (key === 'thinking') {
      if (!thinkingLevels.includes(value[key])) throw new Error(`thinking must be one of: ${thinkingLevels.join(', ')}`);
    } else if (!Number.isSafeInteger(value[key]) || value[key] <= 0) throw new Error(`${key} must be a positive safe integer`);
    result[key] = value[key];
  }
  return result;
}

export function outputLimitMode(model) {
  if (model.api === 'openai-codex-responses' || (model.api === 'openai-responses' && model.compat?.supportsMaxOutputTokens === false)) return 'provider-managed';
  // These pinned Pi transports forward the model's output ceiling. Unknown
  // transports must be verified before accepting an explicit output limit.
  return ['openai-completions', 'openai-responses', 'anthropic-messages'].includes(model.api) ? 'pi-adapter' : 'unverified';
}

export function validateModelSettings(model, requested) {
  if (!model) throw new Error('Pi did not resolve a model for Run settings');
  if (requested.thinking !== undefined) {
    if (model.samplingParams && ['reasoning', 'reasoning_effort', 'thinking', 'enable_thinking', 'chat_template_kwargs'].some(key => Object.hasOwn(model.samplingParams, key)))
      throw new Error('Pi samplingParams contains thinking controls; remove those overrides before using --thinking');
    if (requested.thinking !== 'off' && model.api === 'openai-completions' && model.compat?.supportsReasoningEffort === false && !model.compat?.thinkingFormat)
      throw new Error('The Pi model compatibility settings disable reasoning effort; explicit thinking is unsupported');
    // Same capability rules as pinned Pi getSupportedThinkingLevels.
    const supported = model.reasoning ? thinkingLevels.filter(level => model.thinkingLevelMap?.[level] !== null
      && (!['xhigh', 'max'].includes(level) || model.thinkingLevelMap?.[level] !== undefined)) : ['off'];
    if (!supported.includes(requested.thinking)) throw new Error(`Requested thinking level is unsupported by the selected model; supported: ${supported.join(', ')}`);
  }
  if (requested.contextWindow !== undefined && (!Number.isSafeInteger(model.contextWindow) || requested.contextWindow > model.contextWindow))
    throw new Error('contextWindow exceeds the Pi model catalog/configuration ceiling; correct models.json only if the provider supports the larger window');
  if (requested.maxOutputTokens !== undefined) {
    if (model.samplingParams && ['max_tokens', 'max_completion_tokens', 'max_output_tokens'].some(key => Object.hasOwn(model.samplingParams, key)))
      throw new Error('Pi samplingParams contains output limits; remove those overrides before using --max-output-tokens');
    if (outputLimitMode(model) !== 'pi-adapter') throw new Error('maxOutputTokens is unsupported by this Pi transport (including ChatGPT subscription/openai-codex); omit --max-output-tokens');
    if (!Number.isSafeInteger(model.maxTokens) || requested.maxOutputTokens > model.maxTokens)
      throw new Error('maxOutputTokens exceeds the Pi model catalog/configuration ceiling');
    if (model.api === 'openai-responses' && requested.maxOutputTokens < 16) throw new Error('OpenAI Responses requires maxOutputTokens >= 16');
    if (requested.maxOutputTokens > (requested.contextWindow ?? model.contextWindow)) throw new Error('maxOutputTokens must not exceed contextWindow');
  }
}

export function observedModelSettings(native, requested) {
  if (!native.model) {
    if (Object.keys(requested).length) throw new Error('Pi did not report effective Run settings');
    return null;
  }
  validateModelSettings(native.model, requested);
  const effective = { thinking: native.thinkingLevel, contextWindow: native.model.contextWindow,
    maxOutputTokens: outputLimitMode(native.model) === 'pi-adapter' ? native.model.maxTokens : null,
    outputLimit: outputLimitMode(native.model) };
  for (const key of Object.keys(requested)) if (effective[key] !== requested[key]) throw new Error(`Pi did not apply requested ${key}; no model turn started`);
  return effective;
}
