# Interactive Runs — first implementation and dogfood

Working record, 2026-09-15. This is a small local observation, not a durability or long-duration claim.

The CLI now supports `threshold run ... --attach` and `threshold run attach ID`. Startup chooses the
worker lifetime; attaching and detaching only connect or leave a view. A background worker exits after
Pi `agent_settled`, rather than the earlier `agent_end` boundary. An interactive worker keeps its process
and resource slot after settling and accepts more input until explicitly stopped. Waiting remains durable
Run status `running`; it does not complete a Task.

Changes are in `src/pi.mjs`, `src/service.mjs`, `src/cli.mjs`, `src/cli-display.mjs`, and the small new
`src/run-live.mjs` / `src/cli-attach.mjs`. No database migration, Project entity, transcript storage,
automatic Message conversion, capability inheritance or Human Decision conversion was added.
Existing status/Board JSON remains on its previous route and shape. Human Board can obtain a separate
runtime phase snapshot for active workers. The checkout already contained earlier uncommitted CLI work;
this report does not attribute its entire Git diff to this increment.

## Actual use

A new local notes-parser/CLI project was used at `.local/interactive-dogfood/repo`.

| Item | Identity / observation |
| --- | --- |
| Project | `a5994c20-bc22-429b-900f-58b4932d93db` |
| Task | `d1bf0495-3868-47e8-850e-132f2282d7fb` |
| A Run | `dd34d4b5-a72e-43bc-afd7-97de2dcfed28` |
| A Pi session | `01a0a539-fc26-74d9-be2f-416aa0d4041b` |
| A checkpoint read by B | `2eb87fc9-5136-45a8-92da-ebaa2bf30c9f` |
| B Run | `b1d2352c-c890-46d6-86ba-11fd47a6e0c1` |
| B Pi session | `01a0a53d-5a3f-700f-a0ce-a4918ec5be3b` |
| Runtime | Pinned Pi 0.85.1, DeepSeek / deepseek-flash, no optional capabilities |

A ran through the actual CLI in a Windows PTY, implemented a parser, tested it, saved a checkpoint,
and remained alive waiting for input. A second input added a concrete requirement: trimmed whole-line
`#` comments are ignored, while inline `#` stays in a note. The same A implemented that change and added
two tests. It did not change Run/session identity.

The first client detached while A was waiting; A retained its slot. A new CLI process attached and
displayed the in-memory public activity. A third round requested a read-only review and a Message for the
next worker. A supplementary instruction was submitted during execution. The view then detached; at
`2026-09-15T13:22:27.014Z` A was still `working`. Its Message was written afterward, at `13:22:27.911Z`.
The Message distinguished previously executed tests from untested judgments about the unfinished CLI.

A was explicitly stopped at `13:23:33.114Z`, with exit code 0 and the existing explicit-interruption
record retained. This was intentional termination, not a silently classified successful conversation close.
The service was then stopped and restarted. A's live endpoint returned `available: false`, with no events.

B received a normal task re-entry objective, without A's conversation. Its observed tools included
`read_task`, `read_messages`, file/Git inspection, checks, `save_checkpoint` and `update_task_status`.
It read the exact checkpoint above, implemented the remaining CLI, and ended normally with exit 0 and
no runtime error. Task `done` is B's recorded assessment; independent checks below support the delivered behavior.

## Validation and limits

- `npm test`: **36/36 passed**, including six focused interaction regressions. These cover settlement,
  multiple inputs, resource slots, background lifetime, explicit stop, detach, connection loss, restart,
  public-only bounded activity, JSON/non-TTY output, and errors/unknown.
- Independent notes-project suite: **6/6 passed**. Additional checks verified comment behavior through
  the real parser, unreadable CLI input through a subprocess, unchanged original CLI tests/sample/package,
  and preservation of the original parser tests. A's effective work remained present after B.
- `git diff --check` passed. Windows Git printed its ordinary LF/CRLF conversion warnings.
- Local details: `.local/interactive-dogfood/report.json`, with Run metadata, checkpoints, Message,
  independent process results and final project diff. It contains no raw Pi transcript or credentials.
- The verification helper initially assumed every seeded file ended with a newline; package.json did
  not. The helper was corrected to compare the actual Git blob. This was a helper defect, not an Agent
  product change. An earlier one-line observation command also needed explicit ESM syntax.

Public replies currently appear when complete, not token by token. There is no animated progress indicator.
The terminal supports plain Markdown text, rather than a full rich-message renderer. One duplicate input
acceptance notice observed in dogfood was removed. Windows PTY input and reconnect were exercised; this
was not a desktop screenshot review, human usability study, or hours-long/many-client stress test.

Conversation can continue within one Run, while a new Run can continue the Project without it. Both
behaviors were observed in this small workflow. All workers and the service created for this experiment
were stopped. No main/capability repository commit, push, merge or publication was performed.
