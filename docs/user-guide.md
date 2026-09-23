# Threshold user guide

Use `threshold --help` for the command list and `threshold run --help` for a specific command.

## WSL2

Ubuntu 24.04 x64 on WSL2 was tested with Node 24.18.0, Threshold 0.2.0-alpha.3 and Pi 0.85.1.
Install Linux Node 24.18+ and Git first, then run the following **inside your WSL terminal**:

```sh
node --version
git --version
npm install -g --prefix "$HOME/.local" threshold-lite@alpha
export PATH="$HOME/.local/bin:$PATH"
threshold --version
threshold setup
threshold service start
```

Finish each interactive command before entering the next. Keep the PATH addition in your
shell profile if it is not already there. Use `command -v node` and `command -v threshold`
to check that you are using Linux executables, not a Windows installation under `/mnt/c`.

Choose an existing Linux folder when creating a Project, for example `/home/me/my-project`.
For WSL development, Microsoft [recommends keeping project files in the Linux filesystem](https://learn.microsoft.com/en-us/windows/wsl/filesystems#file-storage-and-performance-across-file-systems).
This validation used Linux storage, including a path with spaces and Chinese characters;
shared Windows-mounted workspaces were not tested.

WSL has its own Pi config (`~/.pi/agent`) and Threshold data (`~/.local/state/threshold`, or
`$XDG_STATE_HOME/threshold`). Windows credentials/configuration are not automatically configured
there. Use `threshold setup` inside WSL; do not reuse a Windows `shellPath` ending in `bash.exe`.
Keep each service home within one OS environment rather than sharing a live SQLite home between
Windows and Linux. `service start` returns to the same terminal; `service stop` stops managed workers.
Shutting down WSL ends its processes; persisted project state survives, but an interactive
conversation does not. The normal unknown-Run recovery rules still apply after an unclean exit.

The WSL smoke used a local model fixture with real Pi, Bash and collaboration tool execution.
External provider connectivity/authentication, native Linux, other distributions and macOS
remain separate validation work. Windows localhost proxies may also need separate WSL setup;
an installation succeeding does not prove that your provider endpoint is reachable.

## Provider setup

### Guided setup

Available in **0.2.0-alpha.2**. Install or update with `npm install -g threshold-lite@alpha`
and check `threshold --version`. In a source checkout, `node src/cli.mjs` runs that checkout;
it does not update a separately installed global `threshold` command.

Use these commands **one at a time**, finishing each prompt before the next command:

1. `threshold setup` — select the provider/model and enter the API key.
2. `threshold service start` — start the background service and return to this terminal.
3. `threshold project create` — choose an existing folder by absolute path.
4. `threshold task create` — select a Project and enter the Task title/instructions.
5. `threshold run --attach` — select a Task/model and start a conversation.

Keep the `threshold` prefix on commands. Inside a prompt, enter the requested value rather
than the next command: for example `deepseek` at **Provider name**. A hidden key prompt shows
no characters as you type. Enter accepts a displayed default; Ctrl+C cancels the prompt.

`setup` asks for provider name, model ID, and a hidden API key. **Run the command first,
then paste the key at the hidden input prompt**; it is never a command-line argument.
Existing Pi models work as before. For an unknown model, setup asks for its API base URL
and format; DeepSeek uses the included compatible model settings. On Windows it also
offers the installed Git Bash path if no shell is configured. It makes no model call.

The wizard writes ordinary Pi `models.json`, `settings.json`, and `auth.json` under
`~/.pi/agent` (or explicit `--agent-dir`). The key is **local plaintext**, protected by the
local user's file access, not an OS credential vault or a sandbox. It stays out of Project,
Task and Run records. Other providers/settings are retained. Entering a replacement key
replaces that provider's stored credential and removes its old `models.json` key override.
Leaving the key blank keeps the existing credential method. Existing OAuth/command-based
setups remain supported through Pi; the wizard itself configures API keys only.

New workers read the saved settings, even when the service is already running. Updating
a shell environment variable still requires restarting the service in that environment.
An already running worker keeps its configuration. `setup` uses the current service's
agent directory when known; an explicit `--agent-dir` always wins. When starting a service
with a custom agent directory, supply that option again.

`service start` starts one background Node process and waits for readiness; it returns to
the same terminal. It does not install a Windows service, login item or system autostart.
Repeating it for a running service reports the existing instance without changing its
configuration. `service status` distinguishes running, stopped, stale markers and
unconfirmed availability using this home's runtime markers. Missing markers do not establish
that an old process has exited. `serve` is still the foreground diagnostic entry point.
No stale-lock or unknown-worker recovery is automatic.

Create a project folder yourself, then enter its absolute path when `project create`
asks. If it is not a Git repository, initialization requires `y` or `yes`; Enter means no. Existing
files are kept. An explicitly selected subfolder of another Git repository is rejected
with the parent root shown, rather than silently registering that parent. For scripts:

```sh
threshold project create --repo "E:/my-project" --init-git
```

`task create` asks for missing title/instructions and, when necessary, the Project.
`run --attach` lists Tasks and models so you can choose numbers rather than copy UUIDs.
The configured default model is offered, not forced. The guided path also asks for an
optional objective, Skill path and Extension path. Blank capability inputs mean none;
the next Run never inherits them. Use repeated flags for multiple capabilities.
Native model choices come from Pi's local catalog/configuration, not a live provider query.
Extension-defined models can still be selected explicitly with `--provider`/`--model`.

Pipes and `--json` never prompt. Their existing required Task/provider/model flags and
Run startup policy remain unchanged: `run` is background; `run --attach` is interactive.
Existing data response shapes are retained. `/models` is a new read-only configuration
listing without credentials; the local `server.json` locator now also records `agentDir`.
The alpha.2 onboarding changes needed no database migration. Alpha.3 adds the v7
Project archive migration described below.

For ordinary configured models, missing local credentials/model IDs are reported before
inserting a Run. Credential presence is not online authentication or connectivity proof.
When a custom Extension is selected, Pi resolves its potentially custom provider/auth
during startup. Known runtime failures give bounded diagnostics; raw provider errors and
request payloads are never copied into project history.

### Manual / existing Pi setup

Threshold uses Pi 0.85.1 configuration without owning model routing or login. If Pi already works with
your provider, use the same agent directory. The service defaults to `~/.pi/agent`; `--agent-dir PATH`
selects another directory. Service restarts must select it again. No author-specific configuration is required.

A minimal DeepSeek example is included in `examples/pi/models.json`. From a source checkout, copy that
file to a new Pi configuration directory. From an installed package, the example is under the package
directory reported by `npm root -g` (or `npm root -g --prefix YOUR_PREFIX`), in `threshold-lite/examples/pi/`.
The example references `DEEPSEEK_API_KEY`; it contains no credential. Supply that environment variable
using your normal secret setup in the terminal that launches `threshold service start` or `threshold serve`.
Do not paste the value into Task instructions, Run objectives or command examples shared with others.

On Windows put this in that Pi directory's `settings.json` (adjust the executable if installed elsewhere):

```json
{"shellPath":"C:/Program Files/Git/bin/bash.exe"}
```

Then start `threshold service start --agent-dir YOUR_PI_CONFIG` and use `--provider deepseek --model deepseek-flash`
on a Run. Model calls are billable according to your provider. The example's context/output settings
are conservative local settings, not claims about maximum provider capabilities.
Other providers use Pi's native setup; see [Pi configuration](https://github.com/earendil-works/pi/tree/v0.85.1/packages/coding-agent).

## Data and project selection

### Terminal appearance

Human output puts work titles first, status and exceptions next, and paths/IDs/hashes in secondary text.
Top-level help and service startup show the small Threshold face on capable terminals. Routine queries,
errors and JSON do not. `--no-color` or the presence of `NO_COLOR` disables styling; `--ascii` selects simple
decorative symbols without changing your project text. Redirected output and `TERM=dumb` are plain.
Color follows the terminal palette (with the approved accent on true-color terminals), without a font dependency.

Narrow terminals stack headings/metadata instead of relying on fixed columns. Long content wraps naturally
in your terminal: Message bodies and Task/checkpoint text are not shortened. Board output remains a preview;
use Task detail and the Message pagination commands for the full content. Terminal escape controls in stored
text are stripped or shown visibly in human output; `--json` retains the original data and formatting contract.

Board objective and checkpoint excerpts each use one display-width-bounded text line with an ellipsis
when clipped. Run state/ID stays on its own line. Wide characters and grapheme clusters are measured
with `string-width`; ambiguous character widths and emoji appearance can still vary by terminal/font.
Full Task checkpoints, messages, Run inspection and stored text are unchanged. Board and status remain
static snapshots; `run attach` is the separate live view. Activity marks do not claim progress.

An ended Run is displayed neutrally. Recorded errors, nonzero exits and unknown state remain explicit;
none of these updates the Task assessment. Service budget figures apply across all Projects in that home.
Capability labels come from selected paths, and do not imply a built-in role or verified extension execution.
Unavailable runtime observations after restart are not displayed as zero activity.

Commands printed as next steps carry an explicit `--home` selection when supplied. Only an attached
terminal polls live activity; ordinary queries return immediately.

## Per-Run model settings

```sh
threshold run --task ID --provider PROVIDER --model MODEL --thinking high --context-window 64000 --max-output-tokens 2048
```

All three flags are optional and apply only to the new Run, including an interactive Run.
They do not edit Pi configuration, change existing Runs, or carry into the next Run.
The service API accepts the same selection as `modelSettings: { thinking, contextWindow, maxOutputTokens }`.
Agent-started Runs also default to an empty selection; they do not inherit these values from their caller.

- `--thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, subject to the model's supported levels. Unsupported explicit levels fail instead of silently being clamped.
- `--context-window`: a positive integer token count used by Pi for context management/compaction. It cannot exceed the window declared in the selected Pi model catalog/configuration. It does not expand the provider's actual capacity or promise that all of the window is available for input.
- `--max-output-tokens`: a positive integer ceiling for one response, not a total Run budget or a requested answer length. It cannot exceed the declared model output ceiling or selected context window. Pi may lower the actual request limit to fit remaining context; reasoning may share this allowance. OpenAI Responses requires at least 16.

The current pinned adapter verifies output-limit forwarding for `openai-completions`, `openai-responses` (unless disabled by model compatibility settings), and `anthropic-messages`.
Other transports reject an explicit output cap until that path is verified. In particular, ChatGPT subscription login (`openai-codex`) currently does **not** forward an output cap:

```sh
threshold run --task ID --provider openai-codex --model gpt-5.5 --thinking high --attach
```

Without flags, existing behavior remains: Threshold asks Pi for `low` thinking (Pi may map this to `off` for a non-reasoning model), and Pi supplies its configured context/output defaults.
Conflicting thinking/output fields in Pi `samplingParams` must be removed before selecting the corresponding flag; they must not silently override the Run's request.
If a model catalog entry understates a capacity supported by your provider, correct that model's Pi `models.json` entry first; these flags never bypass that declaration.

`threshold status --run ID` and `--json` expose `modelSettings.requested` and `modelSettings.effective`.
Effective values are observed from Pi **at startup before the first model turn**, not measurements of every later request or a guarantee of provider enforcement.
For provider-managed/unverified output limits, `maxOutputTokens` is `null` and `outputLimit` explains why.
Pending/failed startup and historical Runs have no effective observation; old Runs are not assigned invented defaults.
Extensions may later change models or settings; the startup record is not a continuous monitor.

Known model/configuration errors reject creation before allocating a Run. Extension-defined models are resolved inside Pi;
if their settings cannot be applied and verified, the created Run ends with an explicit error before its first model turn.

## Interactive Runs

```sh
threshold run --task ID --provider PROVIDER --model MODEL --attach
threshold run attach ID
threshold run stop ID
```

`--attach` at startup chooses an interactive worker: it works, replies, and waits for further input.
Ordinary `run` chooses background execution and exits after Pi reports `agent_settled`, including its
automatic retries/queued continuations. Later attach/detach never changes that startup policy.

In an attached terminal, Enter submits a line. While Pi is working, it queues steering at its supported
tool boundary, without interrupting the current tool; while idle, it starts another round in the same
native session. Input acceptance does not establish processing. Failed delivery is reported as unconfirmed;
inspect subsequent activity before resending. The service accepts at most one pending submission per Run
and limits the observed pending queue to 16. Ended Runs reject input rather than starting a replacement.

`/detach`, Ctrl+C or closing the terminal leaves the worker alone. `run stop` explicitly interrupts one
worker; `service stop` stops all managed workers. Idle interactive workers continue to occupy slots and
their worktrees. Board shows their live interaction phase where available. Waiting is still durable Run
status `running`, and says nothing about Task completion. Interactive conversations have no fixed lifetime;
provider, context and operating-system limits still apply. No idle auto-stop is introduced.

The view shows completed public replies, compact tool starts/results and client input. It does not stream
private reasoning or expose the raw Pi conversation. Public activity is limited to 256 events / 256 KiB
per held Run; long replies are previewed up to 12,000 characters. Eviction is explicitly reported. The service
retains at most 64 jobs after completed-job eviction, in addition to any active jobs. Activity and startup
policy are runtime-only observations, unavailable after service restart; neither is restored into future Runs.
Use a checkpoint or Message for something that should survive. A fresh Run receives neither this buffer nor
its predecessor's conversation. Talking about deployment does not issue a Human Decision.

The first live view prints replies when complete rather than token by token. No animated progress is invented.
Non-TTY `run attach` (including pipes) and `run attach --json` return **one snapshot**, consume no stdin, and
do not follow. `run --attach --json` starts an interactive worker and returns its first live snapshot; that
worker remains alive until stopped. Existing status/Board JSON formats are unchanged. `TERM=dumb` avoids
terminal redraws; monochrome and ASCII options remain supported. Lost observation connections are explicit
and do not imply worker cancellation. HTTP live reads and input are local client endpoints, not a remote
authentication or sandbox boundary; use only in the existing trusted-local-user environment.

### Locating data and projects

`threshold serve` prints its home. CLI commands default to the same OS user data directory, independent
of cwd. No automatic service start or data migration occurs. `--home PATH` selects an isolated instance.
Pi settings and credentials live separately from Threshold's SQLite project data.

`project create` registers the current Git root, or `--repo PATH`; `--name TEXT` is optional. Repeating
it for a registered root returns the existing Project without renaming it. `task create`, `board` and
plain `status` recognize a registered repository from subdirectories. Related Git worktrees can match
the Project when there is a unique match; ambiguity requires `--project ID`.

Task/Run IDs accept unique hexadecimal prefixes across that entity type in the service home.
Use `--project ID` to restrict lookup. More than one match is an error with candidates, not a best guess.
No command silently selects the most recent Task for you. Full IDs still work.
`status --all` lists the global Project/Task index. `status --task ID` gives the actual checkpoint;
`status --run ID` gives execution information. Board previews are intentionally shorter.

### Put away a Project and return later

Available in **0.2.0-alpha.3**. Use matching CLI and service versions; upgrading the package does not
replace an already running service. Back up the closed service home before starting the upgraded service.

```sh
threshold project archive PROJECT_ID
threshold status --all --include-archived
threshold project restore PROJECT_ID
```

Both commands accept a unique short ID, or `--project ID`. Archiving hides the Project and its Tasks
from the default global index and selection menus. It keeps the repository, files, Task assessments,
Runs, checkpoints, messages and decisions. No worker is stopped and no historical-start budget is reset.
This is reversible organization, not deletion or a read-only lock on history.

Archive refuses a Project with a starting/running Run or an unresolved `unknown` Run. Stop active work
normally; for an old unknown Run, inspect it and use the existing workspace recovery procedure only
after confirming the old worker is gone. Archive does not perform that recovery for you.

An archived Project cannot create new Tasks or Runs. Restore it to continue work with the same IDs.
Repeating archive/restore is harmless. Registering the same folder again returns the existing archived
Project; it does not create a duplicate or silently restore it.

`status --all` lists active Projects. `status --include-archived` (with or without `--all`) lists all
Projects and their Tasks. Explicit `--project`, `--task`, `--run` queries and Message reads still reach
archived history. Running `status`/`board` inside an archived repository also shows its history with a
restore hint, rather than claiming the repository is unregistered.

The service applies SQLite migration **v7** on startup: one nullable `projects.archived_at` field;
existing Projects start active. Project JSON gains `archived_at` (null or a server timestamp).
Local clients can POST `{}` to `/projects/ID/archive` or `/projects/ID/restore`, and GET
`/status?includeArchived=true`. These are ordinary trusted-local client operations, not Human Decisions.
Before upgrading a real home, stop its service and back up the closed data directory. Older services
will refuse a v7 database; downgrading requires that pre-upgrade backup, not deleting history.

### Git repositories without commits

Since **0.2.0-alpha.3**, a newly initialized repository is valid observed project state. Task detail shows **No commits yet** together
with the actual branch and file changes. JSON uses `currentGit.head: null`; checkpoints can record that
same observation. No initial commit is manufactured. Unreadable repositories and other Git failures
remain explicit observation errors. A checkpoint's Git snapshot remains historical, not a fresh read.

## Messages and task assessment

```sh
threshold message send --task ID --body "Please independently check path handling."
threshold message send --task ID --body-file review.md
threshold message read --task ID --after 0 --limit 10
threshold task update --task ID --status done --note "Reviewed the delivery and ran its tests."
threshold task update --task ID --status in_progress --note "A remaining issue needs work."
```

Message reads do not consume messages or mark them globally read; use the returned next cursor for more.
Messages are scoped to the Task, not a named recipient. There is no automatic notification or launch.
Checkpoint describes the work's stopping point; Message carries a particular request/finding/reply.
Task status is an attributed work assessment, not proof of correctness or Human approval.

## Optional capabilities and worktrees

```sh
threshold run --task ID --provider PROVIDER --model MODEL --skill ./skills/reviewer --extension ./extensions/tool.ts
threshold run --task ID --provider PROVIDER --model MODEL --workspace PATH_TO_EXISTING_WORKTREE
```

Repeat skill/extension flags to compose capabilities; the next Run defaults to empty. A skill path can
name a SKILL.md or its directory. Extensions name entry files. Relative paths resolve from the CLI cwd.
Installed does not mean active. Entry path/SHA is selection metadata, not a full dependency snapshot.

Use ordinary `git worktree` for parallel edits. The service checks same-repository roots and managed
workspace occupancy. This is not OS isolation. The service owns workers; one scheduler Run ending does
not stop peers, while service stop does. Third-party extensions execute code with the worker's access.

Pi's automatic project AGENTS/CLAUDE, skill and extension discovery is disabled for managed Runs.
Put relevant project requirements in the Task and explicitly select desired capabilities. Do not assume
a repository's instruction file has automatically been loaded.

## Upgrading

Finish the current work or intentionally stop it with `threshold service stop` (this stops managed
workers), then back up the closed service home. Run `npm install -g threshold-lite@alpha`, check
`threshold --version`, and use `threshold service start`. Keep the same `--home` and, if used,
`--agent-dir`. Installing a new CLI does not upgrade an already running service. Alpha.3 applies
schema v7 on startup and preserves existing history; older services refuse a v7 database.
Use the pre-upgrade backup if you need to downgrade.

If you temporarily defined a PowerShell `function threshold` to run a source checkout, it still takes
precedence over the installed npm command. Open a fresh terminal, or remove only that function with
`Remove-Item Function:\threshold`, then check `Get-Command threshold` and `threshold --version`.

## Technical errors and stopping

- No service address: check the printed home; use `service start` (background) or `serve` (foreground) with the same `--home` if used before.
- Cannot connect: run `threshold service status`; for a foreground service, inspect its terminal. A failed write response does not prove the action was absent;
  inspect status/messages before repeating it.
- Runtime startup: check installed Pi and the selected agent directory. Capability errors point to selection/loading.
- Model turn failure: known missing-key, HTTP 401, HTTP 429 and connection failures get specific hints.
  Other errors retain an explicit unknown cause. Credential presence does not prove remote authentication,
  quota or model compatibility. Threshold does not store raw provider errors.
- Port in use (`EADDRINUSE`): another process is listening. Identify it before stopping anything.
  If it is the intended service, use its original home and normal stop path. A different independent
  service can use a different `--home` and `service start --port NUMBER` (`0` chooses a free port).
  Do not change ports to start a second service against a home whose old process is still alive.
- Run limit: inspect Board. `--max-runs` counts all historical starts in this home, including failed starts;
  `--max-parallel-runs` includes unknown exits until explicit workspace recovery. Configure deliberately; don't delete history to replenish quota.
- Stale lock / unknown exit: inspect the recorded process and workspace before intervention. Remove stale
  `server.lock` / `server.json` only after checking the old service and workers are gone. Never remove
  `project.sqlite`, its WAL/SHM files, `human.key`, or project history as a startup fix. Removing markers does not recover a Run
  or establish external effects. After restarting, use the explicit recovery path below for stale occupancy.

If service status says stopped but startup reports an occupied port, the old service may still be alive
with missing locator files. This was observed during local onboarding. Status only describes what can
be discovered from the selected home; it is not a system-wide process inventory. On Windows, inspect
the listener without changing it:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8765 | Select-Object LocalAddress, LocalPort, OwningProcess
```

Use the returned PID to inspect the process and its command line. Do not delete markers repeatedly,
kill every Node process, or infer that a missing address means all workers are gone. Recover the intended
instance only after matching the process to its home; there is no automatic orphan-service adoption.

`run stop ID` interrupts one worker. `service stop` requests shutdown of this service and all managed workers.
An exit observation is not proof of arbitrary child-process cleanup or absent external effects.
Interrupted/failed Runs keep their error; a successful stop request doesn't turn the Task into done.

### Recover an unknown Run's workspace

After a service restart, previously starting/running Runs become `unknown`. They still occupy their
worktree and a parallel slot because the new service cannot establish the old worker's exit. `run stop`
cannot stop an unowned process. First independently check that the old worker is gone and inspect the
workspace and any relevant external effects. Only when you have confirmed the workspace is reusable:

```sh
threshold status --run ID
threshold run recover FULL_RUN_ID --confirm-reusable --note "Checked old worker is gone and workspace is reusable"
```

Copy the full Run ID from Run detail; recovery deliberately rejects prefixes. Both the confirmation
flag and a nonempty note are required. This records `workspace_recovery` with `source: client`, a server
timestamp and your note, and releases only that old Run's occupancy. Its `status` remains `unknown`;
session ID, error, exit code and end time are unchanged. It does not establish absent external effects,
restore the old conversation, change Task status or replenish the historical-start budget. Repeating the
command returns the first recovery record unchanged, even if a new worker now occupies the worktree.
Start a fresh Run normally after recovery. Active/ended Runs cannot use this path.

This is a trusted local client confirmation, not authenticated Human identity or an automatic process
check. It is not exposed as an Agent tool. Clients can POST `/runs/FULL_RUN_ID/recover` with
`{"confirmReusable":true,"note":"..."}`. SQLite schema v6 adds a nullable recovery marker to existing
Run rows on service startup; it does not infer confirmations for historical Runs.

For a simple backup, stop the service normally and copy its data directory while it is closed. Keep your
Git repository/backups separately. Live SQLite backup, automatic crash recovery and moving registered
repository paths are not provided by this preview.

## Local Risk STOP example

`fake_deploy` only records a simulated deployment to staging/preview in local SQLite. It checks a Human
Decision for the exact Task/target in the same execution path. Missing decision gives ASK; deny gives NO.
It does not block editing, tests or messages. `threshold decision --help` describes the Human CLI.
Agent messages cannot grant that decision; CLI client source alone is not authenticated Human identity.
The same OS user's shell can read Human credentials: this is not a sandbox or multi-user authentication system.
