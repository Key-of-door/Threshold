// Classify known failures; never include a raw provider message, request or credential.
export function runtimeError(error) {
  if (error?.code === 'THRESHOLD_TURN_TIMEOUT') return `Background turn deadline reached${Number.isFinite(error.timeoutMs) ? ` (${error.timeoutMs / 1000}s)` : ''}; no automatic checkpoint or finalization was performed`;
  if (error?.code === 'THRESHOLD_RPC_TIMEOUT') return 'Pi RPC response timed out';
  const message = String(error?.message ?? error ?? '');
  if (/^No API key (?:for|found for)\b/i.test(message) || /authHeader requires a resolved API key/.test(message))
    return 'API key is missing. Run threshold setup, or set the provider environment variable before starting the service';
  if (/^No model selected|^Model .+ not found|^Unknown model/i.test(message))
    return 'model not found. Check the provider/model selection with threshold setup';
  if (error?.status === 401 || /^(?:HTTP\s+)?401\b/.test(message)) return 'provider rejected authentication (HTTP 401). Check the configured API key';
  if (error?.status === 429 || /^(?:HTTP\s+)?429\b/.test(message)) return 'provider rate/quota limit (HTTP 429). Check provider limits before retrying';
  if (/^fetch failed$|^Connection error\.?$|\bECONNREFUSED\b|\bENOTFOUND\b|\bETIMEDOUT\b/.test(message))
    return 'provider connection failed. Check network access and API base URL';
  return 'request failed (exact cause unavailable)';
}
