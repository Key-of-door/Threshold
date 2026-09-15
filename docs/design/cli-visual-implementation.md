# CLI visual implementation — 2026-09-15

The approved design is now applied to existing CLI output. This is an implementation note, not a new
interface freeze. The earlier standalone TUI prototype remains separate.

Changed: `src/cli-display.mjs`, a small `src/cli-format.mjs` terminal-format helper, and CLI presentation
wiring. Help/startup, unregistered repositories, Board/index, Task/Run detail, messages, capability metadata,
offline/errors and flat parallel Run rows use the same hierarchy. Added `--ascii` and `--no-color`;
NO_COLOR, TERM=dumb and non-TTY destinations are respected. No dependencies were added.

Machine response objects still go straight through JSON.stringify, including full IDs, messages and
fresh Git observation times. No new service request, schema, Project entity, lifecycle or authorization
semantics were needed. Service/Store/runtime files are unchanged by this increment. Historical experiment
packages and their installed copies were not replaced or rebound to these working bytes.

Design details reconciled with actual semantics:

- Resource counters are service-home-wide; the display says so rather than calling them Project progress.
- `starting`, `running`, `unknown`, neutral `ended`, errors and observed exit codes remain distinct.
- A Run response does not contain the Task title, so it shows the objective and Task ID instead of inventing
  a name or adding a background lookup.
- Capability labels are derived from paths. Skill catalog entries may be observed; there is no general
  extension-load attestation. Selection is never presented as successful loading/execution.
- Board text is already clipped by the service. It is labeled as previews; complete Task/checkpoint and
  paginated Message bodies stay available, without synthesizing a consensus or structured checklist.
- Missing runtime observation after restart means unavailable, not zero tool calls.
- Human output may neutralize terminal controls embedded in content; original strings remain in JSON.

Validation: 28 tests passed (23 existing + 5 focused rendering regressions), including a JSON comparison
against the actual service response. That comparison permits a newly observed Git timestamp on each request;
it does not suppress or freeze the timestamp in the product. Real Windows TTY help and local service
startup/shutdown were checked; no provider/model calls were made. The execution environment itself sets
TERM=dumb and NO_COLOR, so the colored smoke check used process-local terminal settings. No global settings
were changed. Narrow layout has focused rendering coverage; this is not a claim that every terminal/font
or assistive technology has been tested.

No commit, push or installation update was performed. Try the working version directly:

```powershell
node 'E:\Threshold lite\src\cli.mjs' --help
```
