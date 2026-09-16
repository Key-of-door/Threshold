# From the 0.1 prototype to 0.2 alpha

## 0.2.0-alpha.3: Project archives and empty repositories

- `project archive ID` hides a Project and its Tasks from the normal index and selection menus.
  It retains IDs, files and history. `project restore ID` allows new work again.
- `status --all --include-archived` includes archived Projects and Tasks. Direct ID queries and
  current-repository inspection still show archived history with a restore hint.
- Active or unresolved Runs prevent archive; archive never stops workers or confirms an unknown exit.
  Archived Projects cannot create new Tasks or Runs. Re-registering the same folder does not restore it.
- Schema **v7** adds nullable `projects.archived_at`. Existing Projects start active; Project JSON
  gains the same null-or-timestamp field. No existing records are removed and budgets are unchanged.
- Git observations before the first commit retain the actual branch and file status with `head: null`.
  Human Task detail shows `No commits yet`. Other Git errors remain errors.

Stop the old service, back up its closed home directory, upgrade the package, then start the new service
with the same home/configuration. Older versions refuse schema v7; restore the pre-upgrade backup before
downgrading. Archiving is reversible organization, not permanent deletion or a read-only history lock.

## 0.2.0-alpha.2: guided onboarding

- `setup` is an interactive wrapper around Pi model/default/credential configuration.
- `service start` runs the service in the background; `serve` retains its foreground behavior.
  `service status` reports availability. Stale markers and unknown workers are never automatically recovered.
- Terminal-only selection fills missing Project/Task/provider/model fields. Pipes and `--json`
  retain explicit required flags and do not read stdin. Default Run policy remains background.
- `project create --repo PATH` requires an explicitly chosen folder to be the Git root. This
  avoids registering a parent when the user selected a nested directory. Cwd-based noninteractive
  registration still finds its Git root. `--init-git` explicitly allows initializing a non-Git folder.
- Model/credential preflight happens before ordinary Run creation. Selected extensions may define
  their own providers, so their provider resolution remains with Pi.
- No DB migration, new Project entity, capability discovery or global activation is introduced.
  Existing successful command JSON shapes stay the same; service/model inspection commands are new.
- A failed port bind now exits before opening the project database, so a rejected duplicate startup
  cannot mark existing Runs unknown. Missing runtime markers still require explicit diagnosis.

Stop the old service when ready to end its workers, update the npm package, then start the service
again with the same home/configuration. npm installation alone does not upgrade a running service.

## Earlier changes

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
