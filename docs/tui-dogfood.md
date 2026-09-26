# TUI development and dogfood validation

Development record, 2026-09-26. The resulting **Threshold TUI v0.1** ships in `threshold-lite@0.2.0-alpha.6`;
see the [installed TUI guide](tui.md). The local commands below describe the original source dogfood workflow.
The implementation uses the pinned `@earendil-works/pi-tui@0.85.1` terminal renderer and existing Threshold service APIs.
There are no schema, Run execution-policy or public-activity API changes.

## Start

Use an interactive VT terminal. On Windows, use Node 24 LTS >=24.20.0 as described in `runtime-validation.md`.
From this checkout:

```powershell
npm install
node src/cli.mjs tui
node src/cli.mjs tui --home 'E:\my-threshold-home'
node src/cli.mjs tui --task TASK_ID --home 'E:\my-threshold-home'
```

This machine also has an ignored local launcher at `.local/start-tui.ps1`, using the already verified
Node 24.21.0 executable without changing global Node or npm installation:

```powershell
& 'E:\Threshold lite\.local\start-tui.ps1'
& 'E:\Threshold lite\.local\start-tui.ps1' -DataHome 'E:\my-threshold-home'
```

Home defaults to the existing CLI default. Opening the TUI never starts a service or Run automatically.
A recognized repository opens its Board; otherwise select a Project. `--project`, `--task`, `--run`
accept unique ID prefixes; `--project` can scope Task/Run lookup. An unavailable service has a Service
entry with inspection and explicit start. Stale/unconfirmed services are not automatically replaced.
Keep using the current service; do not stop it just to use the TUI. Provider/credential setup remains
`threshold setup` with the same agent directory; the TUI model picker never displays keys.

## Layout

Every page has one context line at the top (`threshold › Projects › Project › Task › run xxxx`, derived from the
current page; ancestor segments are clickable) with connection state and last read time on the right, and one hint
line at the bottom with home-wide slot usage. Between them, identity and page actions stay in a fixed header area,
content scrolls, and the explicit input target or recovery entry stays in a fixed footer area. On short terminals the
fixed areas scroll with the page instead. Lists use a `❯` pointer with right-aligned status and short IDs; full IDs
are on the object's own page. Task overview uses two columns from 110 columns and stacks below that.
Design rationale and the field mapping are in `design/tui-visual-round1.md`.

## Work

- Project picker includes archived history; Board opens Tasks and Runs, creates Tasks, archives/restores Projects.
- Task overview shows instructions, full checkpoint, current Git, Task fields and Runs. Checkpoint and Messages show
  full available content and source metadata. Run Inspect keeps the CLI detail.
  Messages use explicit previous/next pages. Source Run inspection reveals its Task; reading never consumes a record.
- New Run is a separate draft: objective, existing workspace, provider/model, thinking, optional capacities,
  background/interactive mode, background timeout, explicit Skill/Extension paths. Model/worktree selectors are provided.
  Cancel preserves this local draft. A successfully started Run does not transfer capabilities to the next fresh draft.
- Run view reads the existing bounded public activity window. Inspect preserves configuration, exit/error/recovery,
  IDs, capabilities/path/SHA and runtime observations from the CLI.
- Task inbox input and Run input use distinct, target-labeled editors. Writes are serialized; uncertain delivery
  locks that action until you inspect the destination and explicitly unlock a retry. Unlocking never sends anything.
- Git status/diff and small text-file reads are on demand for the chosen workspace. Diff includes staged and unstaged
  tracked changes; untracked content is not synthesized into diff. File previews are limited to 128 KiB within that workspace.
- Task assessment requires a note. Run stop, service stop and workspace recovery remain distinct operations.
  Recovery requires the existing independent check confirmation and note; the old outcome stays unknown.

## Input and navigation

| Action | Keyboard / mouse |
| --- | --- |
| Select action | Tab / Shift+Tab, up/down, or click; Tab at the edge of an area moves to the next area |
| Activate action | Enter or click |
| Go up / jump to an ancestor | Esc, or click a context-line segment |
| Scroll | Wheel / trackpad, PageUp/PageDown; scrollbars |
| Commands | `/` outside an editor, or Ctrl+P |
| Refresh current view | Ctrl+R |
| Back | Esc; editor/form drafts remain in this TUI process |
| Edit multiline text | Enter inserts newline; paste remains text |
| Save field / send explicit input | Ctrl+S; Ctrl+Enter if the terminal supports it; or Tab to the named button |
| Search document | Ctrl+Shift+F (the scrolling content; fixed header/footer areas are not searched) |
| Copy prose | Drag-select; Windows clipboard receives text directly; elsewhere OSC 52 depends on terminal support |
| Quit | Commands → Quit view, or Ctrl+C; does not stop workers or service |

`--no-mouse` disables mouse capture for terminal-native selection. `--no-color`, `NO_COLOR` and `--ascii`
affect the content presentation; the editor/scrollbar chrome comes from the terminal library. This is not
a promise of complete screen-reader or every-terminal compatibility. CJK text, bracketed multiline paste,
mouse click input and narrow layout have been exercised; native IME candidate positioning still benefits
from actual day-to-day use in the user's terminal.

## Current limits

- Drafts, view selection and per-view scroll positions are in memory. Quitting discards unsent drafts. No durable conversation/history is added.
- Times are shown as local wall-clock seconds and labeled local. Messages and checkpoints provide a
  `Show recorded time` action inside the TUI for the exact ISO value, including milliseconds and timezone;
  raw Run times remain in Inspect. Narrow metadata wraps instead of cutting off the time.
- Public replies arrive after completion, not token by token. Tool rows are start/end summaries, with no invented
  result bodies or pairing of concurrent same-name tools. Truncation/unavailable observations stay visible.
- Live reads use the existing finite window on each refresh. Service restart cannot reconstruct that window.
- Task history contains the recent five Runs plus all unresolved Runs from Board; known older IDs remain inspectable.
- No test-pass badges are inferred from narratives. Git observations name their path/time; reads are not atomic
  snapshots across every workspace or service endpoint.
- Service availability and model availability are separate. Starting a configured Run is the point at which real
  model work can occur. All automated checks for this increment use isolated local fixtures, not paid providers.
- The wireframe's optional persistent Task sidebar and per-block folding are not implemented in this first terminal
  build. The full content remains accessible by scrolling/searching. The working paths and semantic boundaries take priority.

## Validation

The existing suite plus TUI integration checks cover real local-service messages, Run inputs, no implicit stop on
detach/exit, unknown recovery, uncertain-write suppression, route-response races, terminal-control sanitization,
multiline paste, resizing and terminal restoration. Native Windows VT smoke uses an isolated home/repository and
a deterministic worker. It does not touch the user's service or call an external provider.

The interaction contract and future public-activity boundary are in `design/tui-interaction-v1.md`.

Validated on Node 24.21.0: 78 tests passed. Native Windows terminal smoke exercised mouse navigation,
CJK multiline paste, explicit inbox submission, Quit and Ctrl+C cleanup; the worker remained running
after leaving the TUI, before the isolated fixture itself was shut down.

Visual round 1 (layout, hierarchy, navigation state): 80 tests passed on Node 24.21.0, including new checks for
width safety of the layout blocks, current-page context, Back restoring scroll/selection, cross-area Tab and the
inert page behind the editor. Frames were compared in a virtual terminal at 180×50, 120×32, 80×24 and 40×20.
At that validation stage native terminal behavior still awaited user confirmation; see the checklist in
`design/tui-visual-round1.md` and the subsequent feedback below.

Review follow-up: Board navigation retains each Project's last observed snapshot during refresh, so a loading
frame cannot reset its saved scroll position. The editor also locks background breadcrumb navigation.
Focused regressions now render pending Board reads at nonzero scroll positions, switch Projects, exercise
background clicks while editing, and open exact Message/checkpoint timestamps in a 40-column view.
Validated on Node 24.21.0: focused 12/12 and full suite 82/82 passed. The existing isolated renderer generated
60 updated frames across 180×50, 120×32, 80×24 and 40×20; this is virtual-terminal validation, not a new native
IME/mouse verification.

Release feedback: the user subsequently reported no problems with native mouse use or Chinese input in their
actual terminal and accepted this version as TUI v0.1. This is user dogfood evidence, not a universal IME/font/
clipboard compatibility claim. A further isolated PTY flow passed inbox paste/draft/submit, exact time disclosure,
Run input, Inspect scrolling and Quit; the Run remained running before fixture cleanup, and Task assessment
remained unchanged.
