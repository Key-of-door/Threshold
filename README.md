# Threshold

**Project persists. Agents come and go.**

Threshold is a small local service for continuing software projects across independent Agent sessions.
Give a Task to a Pi worker, keep its checkpoint and messages, then let a fresh worker inspect the project and continue.
You do not need to copy the previous conversation.

Early alpha: one machine, trusted local user. Pi runs the Agent; Git holds the code; SQLite holds project state.
Optional capabilities are not required for the first workflow.

## Install

You need **Node 24.18+**, npm, Git, and a working Pi provider/model configuration.
Windows workers need Git for Windows Bash. Linux/macOS use is not yet fully validated.
Pi is pinned to **0.85.1** and installed as a dependency.

From a source checkout, create and install the local package:

```sh
npm ci
npm pack
npm install -g ./threshold-lite-0.2.0-alpha.1.tgz
threshold --help
threshold --version
```

If you were given the `.tgz` preview package, start at `npm install -g PATH_TO_PACKAGE.tgz`.
This version is a local preview, not a claim that it is published on npm.
For a user-writable installation directory, use `npm install -g --prefix PATH PATH_TO_PACKAGE.tgz`
and put `PATH` (Windows) or `PATH/bin` (Linux/macOS) on your shell's PATH.

## Start a service

Use your existing Pi configuration in `~/.pi/agent`, or a separate directory with `--agent-dir`.
If this is your first Pi setup, see the short [provider setup](docs/user-guide.md#provider-setup).
Credentials belong in your normal provider setup or the service process environment, never in a Task.

```sh
threshold serve
# With a separate Pi configuration:
# threshold serve --agent-dir PATH_TO_PI_CONFIG
```

Keep that terminal open. The service prints its address and data directory. Open a second terminal for work.
Default data location is stable when you change directories: Windows `%LOCALAPPDATA%/Threshold`,
macOS `~/Library/Application Support/Threshold`, Linux `$XDG_STATE_HOME/threshold` or `~/.local/state/threshold`.
`--home PATH` overrides it; every command targeting that instance needs the same override.

## Work in a project

Enter your project's Git repository (initialize one with `git init` if needed):

```sh
threshold project create
threshold task create --title "Fix path handling" --instructions "Inspect the parser, make a small useful change, test it, and save a checkpoint describing the remaining work."
threshold status
```

Creation returns a short Task ID. Replace `TASK_ID` below with that ID; unique prefixes and full IDs both work.
Choose your configured provider/model. This example uses DeepSeek:

```sh
threshold run --task TASK_ID --provider deepseek --model deepseek-flash --objective "Complete the parser part and its tests; leave CLI work for a later Run."
threshold status --task TASK_ID
threshold status --run RUN_ID
threshold message read --task TASK_ID
```

`run` starts a new worker and returns immediately. Check `status` again to observe progress.
An ended Run is not automatically a completed Task. Task detail includes instructions, checkpoint and recent Runs;
the worker can explicitly update Task status and leave messages.

To talk to the same worker over multiple rounds, add `--attach` when starting it:

```sh
threshold run --task TASK_ID --provider deepseek --model deepseek-flash --attach
# Later, reconnect to that Run:
threshold run attach RUN_ID
```

Enter sends input; `/detach` or Ctrl+C leaves the view without stopping the worker. An interactive Run
waits after each reply until you explicitly `threshold run stop RUN_ID`. Attaching to an existing
background Run does not change its lifetime. Conversation is temporary; checkpoint, Message and Git
remain the handoff path. See [interactive Runs](docs/user-guide.md#interactive-runs).

Background Runs have a **3-minute** turn limit; interactive Runs have no fixed conversation lifetime.
Default service limits are **3 unsettled Runs** and
**100 historical starts per data directory**. These are startup limits, not token or spending budgets.
An interactive worker waiting for input still occupies its slot and worktree.
`threshold serve --help` explains the configuration. The same managed worktree cannot have two unsettled workers.

## Come back later

```sh
threshold service stop
# Later, possibly in a new terminal:
threshold serve
# In another terminal, anywhere inside the same project:
threshold status
threshold status --task TASK_ID
threshold run --task TASK_ID --provider deepseek --model deepseek-flash --objective "Inspect the current project and checkpoint, then complete the next useful part."
```

The new worker gets persisted project state and re-observes Git/files; it does not resume the old conversation.
If you used `--agent-dir` or `--home`, use those same settings when restarting.
Outside a registered repository, `threshold status --all` lists Projects and Tasks; `--project ID` selects one explicitly.

To interrupt **one worker**: `threshold run stop RUN_ID`.
To stop the **service and its workers**: `threshold service stop`.
Bare `threshold stop` takes no action and explains the choice. Project data is retained.

## More, when needed

- `threshold COMMAND --help` explains flags and gives an example.
- Human-readable output is default. Use `--json` for scripts; IDs remain complete in JSON.
- Terminal output uses restrained color and a small face only on top-level help/startup/attach.
  Use `--no-color` or `NO_COLOR` for monochrome, and `--ascii` for simple symbols. Pipes and
  `TERM=dumb` use plain output automatically; no special fonts are needed.
- Use `--instructions-file PATH` or `--body-file PATH` for long Task/message text.
- [User guide](docs/user-guide.md): configuration, messages, worktrees, capabilities, technical errors and current limits.
- [Changes from the prototype CLI](docs/cli-migration.md): new home, output and stop commands.
- [Optional Threshold-capability cookbook](https://github.com/Key-of-door/Threshold-capability): select skill/extension paths per Run; nothing is installed or activated automatically.

Normal development does not need a deployment approval. Current Risk STOP demonstrates only local `fake_deploy`;
it is not a universal shell/network safety layer or a real remote-operation guarantee.
The service listens only on loopback and is for a trusted local OS user. Do not expose it as a multi-user/network server.
