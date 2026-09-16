# From the 0.1 prototype to 0.2 alpha

- Default home is now a stable OS user directory, not cwd-relative `.local/threshold`.
  Existing data is not moved. Continue it with an absolute `--home PATH` on serve and every client command.
- Output defaults to human-readable text. Scripts must pass `--json`; response data and full IDs remain
  available. `--summary` remains a human-output alias. Task detail now includes the full checkpoint.
  Plain status recognizes the current Project; `status --all --json` gives the global index.
- `stop` (including old `stop --run`) takes no action. Use `run stop ID` / `run stop --run ID` for a worker,
  or `service stop` for the service. This deliberate change prevents omission of a flag from stopping everything.
- Unique ID prefixes are accepted. `--project` scopes Task/Run lookup; ambiguity is an error.
- Help/version work without the service. Project registration can infer the Git root; Task creation can
  infer its Project. That CLI-defaults change did not migrate the DB or add automatic capability activation.

This preview changes CLI defaults; it does not change existing Human Decision, Task/Message or execution
semantics. Existing experiment reports retain their historical commands and identities.

The subsequent release-preparation increment adds explicit `run recover` for unknown Runs after a
restart. Schema v6 adds a nullable `workspace_recovery` marker to Run responses and stores it in SQLite;
the old `unknown` status and exit observations are unchanged. Full Run IDs, `--confirm-reusable` and a
note are required. See [workspace recovery](user-guide.md#recover-an-unknown-runs-workspace). Back up the
closed service data directory before upgrading; older service versions cannot open a v6 database.
