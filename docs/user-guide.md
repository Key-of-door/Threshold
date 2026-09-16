# Threshold user guide

Use `threshold --help` for the command list and `threshold run --help` for a specific command.

## Provider setup

Threshold uses Pi 0.85.1 configuration without owning model routing or login. If Pi already works with
your provider, use the same agent directory. The service defaults to `~/.pi/agent`; `--agent-dir PATH`
selects another directory. Service restarts must select it again. No author-specific configuration is required.

A minimal DeepSeek example is included in `examples/pi/models.json`. From a source checkout, copy that
file to a new Pi configuration directory. From an installed package, the example is under the package
directory reported by `npm root -g` (or `npm root -g --prefix YOUR_PREFIX`), in `threshold-lite/examples/pi/`.
The example references `DEEPSEEK_API_KEY`; it contains no credential. Supply that environment variable
using your normal secret setup in the terminal that launches `threshold serve`.
Do not paste the value into Task instructions, Run objectives or command examples shared with others.

On Windows put this in that Pi directory's `settings.json` (adjust the executable if installed elsewhere):

```json
{"shellPath":"C:/Program Files/Git/bin/bash.exe"}
```

Then start `threshold serve --agent-dir YOUR_PI_CONFIG` and use `--provider deepseek --model deepseek-flash`
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

## Technical errors and stopping

- No service address: check the printed home; start `serve` with the same `--home` if used before.
- Cannot connect: check the serve terminal. A failed write response does not prove the action was absent;
  inspect status/messages before repeating it.
- Runtime startup: check installed Pi and the selected agent directory. Capability errors point to selection/loading.
- Model turn failure: check provider/model setup and availability. Threshold reports the known stage; it may
  not know whether the underlying cause was authentication, network, provider or runtime. It does not store raw provider errors.
- Port in use: stop the intended old service, or choose another port with `serve --port NUMBER` (`0` chooses a free port).
- Run limit: inspect Board. `--max-runs` counts all historical starts in this home, including failed starts;
  `--max-parallel-runs` includes unknown exits until explicit workspace recovery. Configure deliberately; don't delete history to replenish quota.
- Stale lock / unknown exit: inspect the recorded process and workspace before intervention. Remove a stale
  service lock only after checking the old service and workers are gone. Removing it does not recover a Run
  or establish external effects. After restarting, use the explicit recovery path below for stale occupancy.

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
