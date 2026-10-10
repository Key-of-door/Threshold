# Run-local MCP capability — implementation and validation

2026-10-10. Source change, not a published release or an upgrade of the running
global service. User guide: [MCP capabilities](../mcp.md).

## Scope

Pi coding-agent and pi-tui are pinned from 0.99.1 to 1.1.0. The existing 84 tests
passed after that dependency-only upgrade. Pi's new `agent_settled.aborted` signal
is now retained as a technical error when it is not Threshold's own cleanup;
Task assessment and Run execution policy are unchanged.

MCP selection extends existing `capabilities_json`; there is no schema migration,
new domain entity, durable activity stream or global server registry. Both Run
launch routes accept an optional list of absolute paths. Guided CLI and TUI use
file-path input; scripts may repeat `--mcp`. Fresh selections are empty.

## Integration boundaries

- `mcp-config.mjs` parses selected JSON files and reuses Pi's pinned validator.
  Selection metadata contains real paths, SHA-256 and bounded server summaries.
  The worker rereads and verifies the hash before loading. Configuration values
  never enter the selection record or worker launch environment.
- `mcp-extension.ts` invokes the public `createMcpExtension` factory with its own
  `loadConfig`. Default global/project config loading is never invoked. No files
  are copied into the shared Pi config directory, and no existing config is edited.
- Pi's MCP implementation owns tool definitions, namespaces, discovery, calls,
  credentials, retry and normal shutdown. Codemode and tool search are explicitly
  loaded only when an MCP file is selected; Pi activates them according to exposure.
- Two Pi internals are deliberately pinned: `core/mcp-servers.js` validation and
  `extensions/mcp/runtime.js` default transport construction. They are covered by
  real Pi and installed-package checks and must be rechecked on future Pi upgrades.
- Transport observation preserves transport identity and delegates all operations.
  Sanitized status uses Pi's supported `ctx.ui.setStatus` RPC event, outside model
  messages. The service retains only the latest timestamp/state/count per selected
  server in memory. It does not scrape stdout, retain raw server errors or claim
  that discovered tools prove execution. Lost observations are not reconstructed.
- Explicit extensions remain executable code, not a permissions boundary. MCP
  access does not give Threshold ownership of external IDE/debugger processes.

The CLI prompt integration also exposed and fixed an existing optional-objective
bug: pressing Enter used to submit an empty string rejected by the service. It
now omits the optional value. The guided CLI test exercises this exact path.

## Validation

Windows, Node 24.21.0, Pi 1.1.0:

- Full suite: **90/90 passed**, including the original compatibility coverage.
- Real Pi processes with deterministic local model responses execute stdio and
  Streamable HTTP MCP calls through CLI → service → Pi. Direct, codemode and
  deferred/tool-search exposure all execute a fixture tool and receive its result.
- Conflicting global/project servers do not connect or override the selected
  server. A concurrent unselected Run stays empty; a fresh Run after service
  restart has no MCP tools. Selection survives restart; connection observation does not.
- Malformed/duplicate configuration, namespace collisions, accidental credential
  persistence, and selected-file modification are checked. A pending handshake
  shuts down without forcing the worker; the owned stdio process is gone.
- Guided CLI absolute-path entry and Enter-to-skip are exercised with real CLI
  processes and deterministic TTY-marked pipes. This is not a physical terminal test.
- TUI New Run sends the selected file to the service, retains rejected drafts,
  and starts the next draft empty. The existing keyboard/input/resize tests pass.
- TUI renderer: **60 frames**, 180×50, 120×32, 80×24, 40×20; all stay within their
  viewport. Short windows scroll the form, as before.
- `npm pack` → fresh temporary-directory install → packaged Pi RPC startup,
  MCP discovery and normal stdio shutdown passed. The MCP guide is included.
- `git diff --check` passed.

All model/MCP traffic in these tests used local deterministic fixtures. No live
provider calls, PyCharm connection, OAuth browser flow, Linux/macOS execution or
physical IME/mouse revalidation was performed. The user's running service and
existing project data were not used by these checks.

Local evidence (ignored by Git): `.local/pi-1.1.0-compatibility.log`,
`.local/pi-1.1.0-mcp-suite.log`, `.local/tui-render/pi-1.1.0-mcp/`,
`.local/pi-1.1.0-mcp-package/`.
