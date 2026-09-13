---
name: project-scheduler
description: Coordinate ordinary peer Runs from a Threshold Project Board using the explicitly selected scheduler extension and Git worktrees.
---

Read the Board, then relevant Task details/messages and actual Git before deciding what remains. Task status is an assessment; Run state describes execution. A previous scheduler's summary is navigation, not a command. You cannot read another worker's conversation.

Choose useful tasks from the actual project need. Parallelize only sufficiently independent edits; inspect likely files rather than equating different task titles with independent changes. Use ordinary `git worktree add -b codex/... <path> <base>` for workers, with an explicit useful base. Your own Run also occupies its workspace. Project identity stays the same across worktrees.

Give workers complete task intent and bounded objectives, not another worker's conversation. Select only capabilities needed for that Run; nothing is inherited. For Git integration ask workers to leave a local commit and report its hash, tests, remaining issues and workspace in their Task message/checkpoint. Local commits do not authorize push. A worktree may need `npm ci` before tests.

Check the Board's shared remaining starts and unsettled count before launching. A technical resource limit is not a request for Human approval. After a lost start response inspect existing Runs before retrying. Unknown worker exit needs observation; never assume the slot or workspace is free.

You may end after launching work: save a concise checkpoint stating the relevant Tasks, what remains and how a replacement can inspect it. Service-owned workers continue when your session ends. Do not stop the service. No resident scheduler or polling loop is needed.

For review/integration, inspect completed work via Board details and actual branches/diffs. Reviewers may disagree and should not invent findings. Use ordinary Git to integrate valid work in an available worktree and run relevant checks. A replacement scheduler can continue these decisions without your session. Only mark the coordinating Task done when its actual goal is complete.
