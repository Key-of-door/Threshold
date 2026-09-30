# 0.2.0-alpha.7 — Pi 0.99.1 maintenance update

Threshold now pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to
0.99.1, bringing upstream model/provider/authentication updates and terminal fixes.
Threshold TUI remains v0.1. The Pi launcher now resolves the installed package instead
of assuming a nested `node_modules` directory, so local npm installs with hoisted
dependencies can start Runs. No database schema, Run execution policy,
Task/Message/checkpoint semantics, or service startup mechanism changes in this release.

## Compatibility boundaries

- Threshold continues to launch explicit, fresh Pi RPC sessions. Its existing
  `--no-extensions` setting also disables Pi's new built-in extensions; MCP servers
  from `mcp.json`, codemode and tool search are not automatically enabled. Ordinary
  read/write/edit/bash tools and explicitly selected extensions remain available.
- Pi's catalog now includes `deepseek-flash` with context 1,000,000 and output
  384,000 tokens. Setup can use that catalog entry without writing a custom model.
  Existing model declarations and stored credentials remain supported; Run settings
  continue to be validated against the selected local model declaration.
- RPC settlement, interactive continuation, explicit checkpoints, Task-targeted
  messages and clean idle stop retain their previous behavior. New upstream RPC
  metadata does not change Threshold's accepted-versus-processed distinction.
- The dependency upgrade does not enable new provider features in Threshold's UI
  or introduce automatic model routing, token streaming, or durable transcripts.

## Validation on 2026-09-30

- Windows x64, Node 24.21.0: **84/84 tests passed**. Includes real Pi child processes,
  local deterministic providers, stored-key loading, per-Run settings, explicit
  capability selection, addressed messages and a new two-round interactive test.
- Ubuntu 24.04 on WSL2, Linux Node 24.18.0: clean `npm ci`, **84/84 tests passed**.
  This is source/runtime validation, not a repeat of all earlier Linux PTY workflows.
- TUI harness: 60 frames across 180×50, 120×32, 80×24 and 40×20; frame dimensions
  remain within the viewport. Input, paste, resize and terminal restoration tests pass.
- Isolated DeepSeek `deepseek-flash` smoke: two turns in one interactive Run,
  15 observed tool calls, independently checked file/test changes, an addressed
  message, two explicit checkpoints, clean idle stop with exit 0, and checkpoint
  persistence after service restart. The original Pi configuration was unchanged.

The first live-provider attempt completed its file checks but retained a provider
connection error in its Run record; it is recorded as a failed clean-run check.
A separate second attempt passed. No error classification, retry policy or exit
assertion was relaxed. These are bounded integration checks, not a new benchmark.

No live OAuth login, other external providers, macOS, or physical IME/mouse/clipboard
revalidation was performed for this upgrade. Earlier reports retain their original
Pi/Threshold versions and should not be read as 0.99.1 evidence.

## Upgrade

Stop the service normally before replacing its installed package; normal stop also
stops its managed workers. Then update and restart using the same home, Pi configuration
and intended Run limits:

```sh
threshold service stop
npm install -g threshold-lite@0.2.0-alpha.7
threshold service start
threshold tui
```

If you use custom `--home`, `--agent-dir`, `--max-parallel-runs` or `--max-runs`, supply
them again when starting the service. Do not overwrite an installation while its
service or workers are still using it. Existing project data requires no migration.
