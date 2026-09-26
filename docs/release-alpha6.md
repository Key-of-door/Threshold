# 0.2.0-alpha.6 — Threshold TUI v0.1

Threshold now includes an optional terminal interface. Keep using CLI commands, or enter the TUI after
starting the same service:

```sh
threshold service start
threshold tui
```

The TUI provides a Project Board, Task/checkpoint/inbox views, fresh Run configuration, public activity and
Run input, workspace/Git inspection, and explicit service/recovery controls. It supports keyboard and mouse
navigation, multiline editing, narrow layouts and full record timestamp disclosure. Leaving the interface
does not stop workers or change Task assessments.

TUI v0.1 is the interface milestone; the npm package version is `threshold-lite@0.2.0-alpha.6`.
There is no database migration or Run execution-policy change from alpha.5 (schema v9), and no new core
domain entity or public-activity API. Pi and pi-tui remain pinned to 0.85.1.

Activity is a bounded in-memory view of completed public replies and tool summaries. Token streaming,
complete tool results and activity reconstruction after service restart are not included.

Validation before packaging: 82/82 tests on Windows Node 24.21.0, isolated rendering and PTY user flows,
plus user-reported successful native mouse and Chinese-input dogfood. Prior WSL2 CLI/service tests are not
TUI-specific validation. On Windows, use Node 24 LTS >=24.20.0.

See the [TUI guide](tui.md) for use, input targets and limitations.
