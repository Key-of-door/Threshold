# MCP capabilities per Run

Available in Threshold 0.2.0-alpha.8 using Pi 1.1.0. Earlier Threshold packages
do not provide this entry point.

MCP joins Skill and Extension as an optional Run-local file selection. In the
guided `threshold run` flow, paste an absolute configuration file path at the MCP
prompt, or press Enter for none. In `threshold tui`, use **New Run → MCP config
paths**, one file per line. No installation command or global registration is
needed. A fresh Run, including an independently started peer Run, inherits none.

Scripts can repeat `--mcp PATH`. The local service API accepts `mcp: [absolutePath]`
on both existing Run launch routes. CLI/TUI resolve relative input from their cwd
as they already do for skills/extensions; absolute paths avoid ambiguity.

## Configuration

Use Pi's JSON `mcpServers` format. For example (replace the illustrative endpoint
with the actual server endpoint before use):

```json
{
  "mcpServers": {
    "ide": {
      "url": "http://127.0.0.1:8766/mcp",
      "exposure": "direct"
    }
  }
}
```

stdio configurations use `command`, `args`, optional `cwd` and `env`. HTTP uses
`url`, optional `headers` and Pi's authentication fields. Only stdio and Streamable
HTTP are supported; legacy SSE is not. Relative server cwd resolves against the
Run workspace, not the configuration file's directory. On Windows use the actual
executable or an explicitly configured launcher as required by the MCP server.

Exposure follows Pi: `direct` declares tools immediately, the default `codemode`
discovers/calls them through scripts, `deferred` uses tool search, and `hidden`
with `toolExposure` can expose a subset. `enabled: false` does not connect.
`autoEnableCodemode` is supported; selected files must agree if they specify it.
These settings control tool availability, not operating-system permissions.

Use environment references such as `${MY_MCP_TOKEN}` in headers/env instead of
embedding credentials. They resolve in the service/worker environment. Existing
Pi OAuth credentials can be reused for explicitly selected servers. This first
version does not add an OAuth login dialog to Threshold CLI/TUI; complete required
authentication with the server/Pi tooling before starting the Run. Selecting a
file does not automatically sign in. Pi still owns authentication and tool calls.

## Selection and observation

- Only the explicitly selected files are read. Neither `~/.pi/agent/mcp.json` nor
  workspace `.pi/mcp.json` is automatically merged, even for same-name servers.
- Up to 16 files, 128 KiB per file, and 64 servers can be selected. JSON with a
  UTF-8 BOM is accepted. Server names are limited to 100 characters. Duplicate
  server names or equivalent namespaces (`a-b` / `a_b`) are rejected rather than
  silently overridden. Invalid configurations fail before a Run is inserted.
- Run metadata stores real file paths, SHA-256 and server name/transport/enabled/
  exposure summaries. It does not store endpoints, headers, executable arguments
  or configuration contents. Pi verifies the selected file hashes again at worker
  load; changed files cause startup failure. Files changed after load affect only
  a future selection. This is not a snapshot of server binaries or dependencies.
- Run Inspect / `threshold status --run ID` shows timestamped observations:
  selected, disabled, connecting, initialized, tools_discovered, connection_error,
  disconnected, closed. Initialized means the MCP handshake replied; discovery
  counts tools the server advertised, including hidden tools. Neither proves a
  tool was executed or that the server is still healthy. Errors do not expose raw
  server diagnostic text in these observations.
- These observations are bounded in-memory data. After service restart, the
  durable selection remains but connection state is unavailable, not reconstructed.
  Older Runs without MCP metadata display “Not recorded”.
- A connection failure leaves the capability unavailable; Pi handles its normal
  reconnect behavior. It does not by itself assess the Task or declare Run success.
- Normal Run shutdown lets Pi close connections and owned stdio transports. An
  external IDE/HTTP server remains external. A forced worker exit does not prove
  descendant processes or external effects stopped.

Explicitly selected extensions still execute with worker access and may register
their own tools or MCP servers. Run-local selection is not a security sandbox.

## PyCharm

In a compatible PyCharm version, enable **Settings → Tools → MCP Server**. Copy
its **Streamable HTTP** or **Stdio** client configuration into your own JSON file,
then select that file by absolute path in a Threshold Run. Use the endpoint and
launcher supplied by your installed IDE; the example port above is illustrative.

Keep the IDE project and Run workspace aligned, and provide `projectPath` on IDE
calls that support it. A PyCharm run configuration or debugger session is not a
Threshold Run. Debugger pause does not pause the agent; closing a Threshold tab
does not stop either process. The first acceptance task can query diagnostics and
symbols, make one bounded change, run a test and inspect its diff.

References: [Pi MCP](https://pi.dev/docs/latest/mcp),
[PyCharm MCP server](https://www.jetbrains.com/help/pycharm/mcp-server.html).
