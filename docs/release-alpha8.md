# 0.2.0-alpha.8 — Run-local MCP capabilities and Pi 1.1.0

Threshold now accepts MCP configuration files alongside Skills and Extensions.
Paste an absolute file path in the guided CLI or TUI New Run form, or repeat
`--mcp PATH` in scripts. Selection belongs to that Run: blank means none, fresh
Runs inherit nothing, and global/project MCP files are never automatically merged.
See the [MCP guide](mcp.md) for configuration and PyCharm setup.

## Changes

- Pi coding-agent and pi-tui are pinned to **1.1.0**. Threshold TUI remains v0.1.
- MCP uses Pi's existing stdio/Streamable HTTP transports, authentication, tool
  discovery and calls. Direct, codemode and deferred exposure are supported.
- CLI and TUI show selected configuration paths, hashes and safe server summaries,
  plus timestamped in-memory transport observations. Configuration contents and
  credentials are not copied into Run capability metadata. File hashes are checked
  again at worker startup; changed selections fail rather than load different bytes.
- An unexpected Pi `agent_settled.aborted` signal is recorded as a technical error,
  even when the worker later exits with code zero. Threshold's own normal cleanup
  retains its existing behavior.
- Pressing Enter at the guided CLI's optional objective prompt now omits the value
  instead of submitting an empty string rejected by the service.

No database migration, new domain entities, execution policy change or service
startup mechanism is introduced. Task assessment, checkpoints, messages and Human
Decisions keep their existing semantics. MCP selection is not an OS sandbox.

## Validation on 2026-10-10

Windows x64, Node 24.21.0:

- Dependency-only upgrade: **84/84 existing tests passed**.
- Final source suite: **90/90 passed**. Includes real Pi processes with local
  deterministic model and MCP servers; stdio and HTTP tool calls; direct,
  codemode and deferred tools; guided CLI and TUI selection; global/project
  exclusion; concurrent unselected Runs; restart persistence; fresh empty
  selection; changed-file rejection; failed connections and pending-handshake shutdown.
- TUI: **60 frames** at 180×50, 120×32, 80×24 and 40×20 fit their viewports.
  Existing input, paste, resize and terminal restoration tests pass.
- Packed installation in a fresh temporary directory: installed Pi version,
  RPC startup, MCP discovery and normal stdio shutdown checked.

These tests used isolated service homes and local fixtures, without contacting
the user's service or a billable model. This release does not claim live PyCharm,
browser OAuth, physical IME/mouse, Linux or macOS revalidation. Earlier platform
reports retain their original versions. Threshold has no new MCP OAuth login UI;
authenticate with the server/Pi tooling before selecting a server that requires it.

## Upgrade

Finish the current work or intentionally stop it before replacing the installed
package. Normal service stop also stops managed workers. Back up the closed service
home, then install and restart:

```sh
threshold service stop
npm install -g threshold-lite@0.2.0-alpha.8
threshold service start
threshold tui
```

Supply your existing `--home`, `--agent-dir`, `--max-parallel-runs` and `--max-runs`
options again if customized. Installing a new CLI does not upgrade an already
running service. Existing project data requires no migration.
