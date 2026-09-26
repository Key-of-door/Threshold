# Threshold TUI v0.1

The TUI is an optional terminal interface alongside the CLI, included in `threshold-lite@0.2.0-alpha.6`.
Both interfaces use the same service, Projects, Tasks and Runs. CLI commands and JSON output remain available.

## Start

Install or update Threshold, then run these commands separately:

```sh
npm install -g threshold-lite@alpha
threshold service start
threshold tui
```

For model setup, use `threshold setup` before starting the service if Pi is not already configured.
Use an interactive VT terminal; on Windows use Node 24 LTS >=24.20.0 (validated with 24.21.0).
The TUI does not support `--json` or `TERM=dumb`; use ordinary CLI commands for scripts.

Inside a registered repository, the TUI opens its Project Board. Otherwise it opens the Project picker.
You can register a Project and create a Task inside the TUI. Opening the interface never launches a Run
automatically. Quitting it or leaving a Run view does not stop workers or the service.

With a custom service home, pass the same path to both commands:

```sh
threshold service start --home PATH
threshold tui --home PATH
```

Optional entry flags: `--project ID`, `--task ID` or `--run ID`; unique ID prefixes are accepted.
Use `--project` to scope Task/Run lookup. Choose either `--task` or `--run`, not both.
`--no-mouse` leaves selection to the terminal; `--no-color` / `NO_COLOR` and `--ascii` provide display fallbacks.

## Work in the TUI

- **Project Board:** browse Tasks, recent activity summaries and unresolved Runs; create Tasks or archive/restore Projects.
- **Task:** read instructions, checkpoint and inbox, record a work assessment with a note, or configure a fresh Run.
  Messages and checkpoints retain their source. They are narratives to check against the workspace, not test results.
- **New Run:** choose its objective, existing workspace, model, thinking, context/output ceilings, execution mode
  and explicit Skill/Extension paths. Configuration belongs to this Run and becomes read-only after launch.
  Fresh Runs do not inherit capability selections.
- **Run:** inspect startup configuration and public activity, send input, or explicitly stop that Run.
  Run lifecycle, working/waiting phase and client connection state are displayed separately.
- **Git:** inspect the chosen workspace's status, tracked staged/unstaged diff or a small text file. Workspace and
  observation time stay visible; checkpoint Git describes a historical observation.
- **Service:** inspect home-wide capacity and unresolved occupancy, or explicitly start/stop the service.
  Stopping the service affects its managed workers; quitting the TUI does not.

Input targets are explicit. **Write to Task inbox** stores a persistent message without launching or notifying
a worker. **Send input to this Run** targets that live worker. A **Task work assessment** changes the Task's
status with a note. Input acceptance does not prove processing. An unconfirmed write is not automatically retried.

## Navigation and input

| Action | Keyboard / mouse |
| --- | --- |
| Select and activate | Tab / Shift+Tab or arrows, then Enter; or click |
| Return | Esc; unsent editor/form drafts stay in this TUI process |
| Commands | `/` outside editors, or Ctrl+P |
| Scroll | PageUp/PageDown, wheel/trackpad, scrollbar |
| Search scrolling content | Ctrl+Shift+F; fixed header/footer and other pages are outside this search |
| Refresh | Ctrl+R |
| Multiline input | Enter adds a newline; pasted text does not submit |
| Submit/save | Ctrl+S, the named button, or Ctrl+Enter where supported |
| Full record time | Show recorded time on a Message or checkpoint; Run times are in Inspect |
| Copy text | Drag-select; `--no-mouse` uses terminal-native selection |
| Quit | Commands → Quit view, or Ctrl+C |

The context bar shows your location. Lists emphasize names and work state; full IDs remain available on the
object's page. Wide Task views use two columns; narrow views stack. Board navigation preserves the reading
position while refreshing. During editing, background navigation is locked. Leaving the TUI discards unsent drafts.

## Limits and validation

Public activity includes completed replies and tool start/end summaries in a finite in-memory window. There
is no token-by-token streaming, full tool-result body or activity reconstruction after service restart. Truncation
and unavailable observations are shown explicitly. No general tool-approval system is added by the TUI.

This release adds no schema or Run execution-policy change from alpha.5. Pi and pi-tui are pinned to 0.85.1.
The Windows test suite, isolated rendering/PTY workflows and the user's mouse/Chinese-input dogfood checks
passed for this iteration. That is not a claim of compatibility with every terminal, font or input method.
Earlier WSL2 CLI/service validation does not constitute a TUI-specific WSL2 test.

See the [user guide](user-guide.md) for provider setup, worktrees, recovery and CLI workflows.
