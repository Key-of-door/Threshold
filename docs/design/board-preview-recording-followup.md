# Compact Board previews and recording follow-up

2026-09-15. Ordinary presentation change, not a schema or runtime increment.

Historical snapshot of this increment. Interactive Runs were implemented afterward;
see the [interactive Run report](../interactive-runs-report.md) and
[current user guide](../user-guide.md#interactive-runs) for the later behavior.

The first real recording exposed long single-paragraph objectives/checkpoints
overflowing the overview. Board now gives objective and checkpoint prose one
terminal text line each, with an explicit ellipsis for omitted content. Run
state and short ID stay on a separate line; errors remain explicit. Narrow
terminals retain stacked labels. The overview leaves one column of margin.

The CLI uses [string-width](https://github.com/sindresorhus/string-width), pinned
at 8.2.2, and Intl.Segmenter to measure columns without splitting grapheme
clusters. Tabs in previews become spaces. CJK, combining accents, flags and ZWJ
emoji have focused coverage. Ambiguous Unicode width and font rendering can
vary across terminals; this is ordinary width handling, not universal font control.

Full stored text, Task checkpoint inspection, Messages, Run detail and JSON are
unchanged. The normal CLI still emits static snapshots. No attached/live Run
TTY, watch mode, or conversation/output endpoint currently exists. Therefore
no animation or invented conversation surface was added. Recorded tool names
are runtime observations; Messages/checkpoints are attributed Agent summaries.

Validation: npm test, 30/30 passed. Added two focused preview regressions and
an exact CLI Board JSON comparison to the real service response. Existing
NO_COLOR/non-TTY/TERM=dumb/JSON visual behavior remains covered.

Old footage remains in E:/Threshold-demo with its original Runs and code
identity. New footage uses the separate E:/Threshold-film Project. Its raw
footage, command timing, Agent observations, edits and final verification are
documented in that recording directory; no old observation is rebound.
