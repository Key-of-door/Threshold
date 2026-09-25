# Windows Pi exit validation — 2026-09-26

## Decision

Use Node **24 LTS >=24.20.0 on Windows**, and pin **24.21.0** for the proposed
Task-targeting behavioral pilot. This adopts an upstream runtime fix, not an
artificial provider delay or a change to Threshold's shutdown/error semantics.
The machine's default Node was not changed during this investigation.

The package's generic Node engine floor remains 24.18.0 for other platforms;
it does not encode this stricter Windows requirement. Historical WSL validation
on Linux Node 24.18.0 remains historical evidence, not a new test of this increment.

## Diagnosis and evidence

The real Pi fixture previously completed a tool call and model turn, then exited
with code `3221226505` and a native assertion in Windows `src/win/async.c`:
`UV_HANDLE_CLOSING`. An immediate reply reproduced it using both the new addressed
message and the existing `read_task` tool. A simple standalone fetch probe did not
reproduce it, so HTTP alone was not established as a sufficient trigger.

Node's [upstream fix #61999](https://github.com/nodejs/node/pull/61999/files) prevents
delayed V8 worker tasks from being posted after their scheduler has shut down.
The [24.20.0 release](https://nodejs.org/en/blog/release/v24.20.0) includes that fix.
The observed failure signature and the version-controlled reproductions below
support using this fix for the local Pi teardown failure. This was not an
instruction-level debugger trace or a build bisect of that single commit.

Same test/source/dependencies and immediate localhost fixture, changing only the
Node executable; no real provider requests:

| Windows x64 Node | Completed fixture trials | Result |
| --- | --- | --- |
| 24.18.0 | 0/3, n=3 | Source Pi exit 3221226505 |
| 24.19.0 | 0/3, n=3 | Source Pi exit 3221226505 |
| 24.20.0 | 3/3, n=3 | Source + fresh target Pi exit cleanly |
| 24.21.0 | 10/10, n=10 | Source + fresh target Pi exit cleanly |

Each passing trial sends a peer message, ends the source Run, restarts the
Threshold service, and starts a distinct target Pi session which reads it.
The full test suite also passes **70/70 on Windows Node 24.21.0**, including the
immediate-response fixture. Finite regression coverage is not a claim that every
possible runtime exit failure has been eliminated.

The previous 250ms final-response delay and its environment override have been
removed from `tests/peer-message-pi.test.mjs`. No production sleeps, suppressed
assertions, rewritten exit codes, automatic retries or Pi dependency patches
were added. The existing abnormal-exit classification is preserved.

## Reproduction and local audit artifacts

After selecting a Node 24.20+ executable on Windows, from the repository:

```sh
node --version
node --test --test-reporter=tap tests/peer-message-pi.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
```

Running the first test with an affected older Windows Node reproduces the
diagnostic without an additional flag. Tests use isolated temporary service
homes and dummy provider credentials, not the user's live project or Pi config.

Local investigation artifacts (not bundled into the npm package):

- `E:/实验/runtime-validation/matrix.jsonl`: trial timestamps, Node binary hashes,
  test hash, exit outcomes and per-trial log paths.
- `E:/实验/runtime-validation/source-hashes.json`: relevant source and lockfile hashes.
- `E:/实验/runtime-validation/run-matrix.mjs`: local verification driver.
- `E:/实验/runtime-validation/full-suite-node-24.21.0.log`: complete test output.
- `E:/实验/peer-original-tool-exit-diagnostic.log`: earlier `read_task` reproduction.
- `E:/实验/pi-exit-probe.mjs` and its results JSON: standalone negative probes.

Portable official Windows binaries were downloaded into the local experiment
directory and checked against the matching nodejs.org `SHASUMS256.txt` entries:

| Version | node.exe SHA256 |
| --- | --- |
| 24.20.0 | `5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5` |
| 24.21.0 | `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32` |

## Behavioral pilot admission

Before model sampling, start an isolated service with the pinned Node 24.21.0
absolute path; Threshold uses `process.execPath` for its Pi child. Do not reuse
a service launched under an older Node. Record Node/Pi versions, binary and
source hashes for both conditions and require the zero-delay preflight to pass.

Any unexpected exit, forced termination, incomplete tool response or unknown
write outcome remains an infrastructure validity event. Preserve the full attempt
and do not silently count it as failed communication, successful completion, or
automatic replacement. Resolve the cause and use the same predeclared retry rule
for both conditions before resuming sampling. An apparently correct final artifact
does not retroactively prove the trajectory was valid.

No behavioral experiment or paid model calls were run during this investigation.
