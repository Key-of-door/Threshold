# Release preflight and WSL2 validation

Checked on 2026-09-16 (UTC). This is an observation record, not a support guarantee or frozen contract.
Scope: release blockers for the existing trusted-local-user alpha; no new product mechanisms.

**Result:** no new code/package release blockers found in the checks below. A contradictory
upgrade paragraph was corrected. Both GitHub repositories were still private at review time:
their source, issues and cookbook links remain unavailable to unauthenticated users until the
owner makes them public. Public npm installation already works; that is distinct from public
source availability. This review did not change visibility or publish another package.

## Package and repository checks

| Check | Observed result |
| --- | --- |
| Core revision | `307bc589f51d7fb4ea7013c514bd98fb6d405a10` |
| Capability revision | `9066cdb51ab5485b4845475fe22e4aba13f6285f` |
| Public npm package | `threshold-lite@0.2.0-alpha.3`; `alpha` and `latest` both point to it |
| Package boundary | 21 files, 54,446 compressed bytes at the audited revision; runtime, docs, model example and Apache-2.0 license; no local DB, credentials or experiments |
| Dependency audit | `npm audit --omit=dev`: zero reported vulnerabilities at review time |
| License metadata | Both repositories declare Apache-2.0; no missing license fields in the core lockfile |
| Git history pattern scan | All locally available refs: core 24 commits, capability 8; no matches for the checked credential/private-key patterns or tracked runtime data paths |
| Windows regressions | Core 50/50; capability 6/6 |
| Linux regressions | Same core 50/50 and capability 6/6, from Git exports installed with Linux `npm ci` |

The history scan checked text objects, not image OCR. It is a pattern scan, not proof that every
possible secret is absent. Dependency license metadata is not a comprehensive legal review.
The npm deprecation/installation-script warnings remained visible; no blanket script approval
was added, and the tested runtime paths worked.

The user guide's general upgrade section previously said this release added no DB migration.
Alpha.3 actually adds schema v7 (`projects.archived_at`). The guide now consistently says to
stop the service, back up the closed home and retain that backup for downgrade. Runtime code,
schema and machine interfaces were not changed by this review.

## WSL2 environment and actual workflow

WSL 2.7.8.0, kernel `6.18.33.1-microsoft-standard-WSL2`, Ubuntu 24.04.5 LTS x64,
Linux Node 24.18.0, npm 11.16.0, Git 2.43.0, Pi 0.85.1. A separate Ubuntu distro was installed;
Docker's distro was retained. Tests ran as an ordinary Linux user, on the Linux filesystem.

The normal online WSL installer made no visible progress. The official Ubuntu image was downloaded
directly, SHA-256 checked against Microsoft's WSL distribution manifest, and installed locally.
Node's Linux archive was checked against its official SHA-256 list. The host warned that its Windows
localhost proxy was not mirrored into WSL NAT networking; direct downloads and npm access worked.
No global proxy/networking change was needed for this validation.

Threshold was freshly installed **from the public npm registry**, not a local tarball or linked
checkout. Its installed executable was `/home/yang/.local/bin/threshold` and ran on Linux Node.

The installed package passed:

- `--version`, `--help`, background service start/reuse/status/stop.
- A separate WSL invocation from a different cwd found the same default service home and PID.
- Project/Task creation in a Git repository with no commits, using a path with Chinese text and spaces.
- Real Pi tool calls: `read_task`, Bash file write/check, `save_checkpoint`, `send_message`, and
  `fake_deploy` returning ASK without affecting ordinary collaboration.
- A Linux PTY detached from an interactive Run, reattached, submitted another input and received a
  second reply. Detaching retained the worker. Explicit Run stop recorded an interruption and exit 0;
  Task completion was not inferred from that exit.
- After service restart, a fresh Pi session read the stored checkpoint and inbox, rechecked the file
  with Bash, saved its own checkpoint and explicitly assessed the Task as done.
- Archive hid the Project from the default index; restart preserved it; restore returned the same IDs.
- After normal service shutdown and terminating/restarting the Ubuntu distro, the installed CLI still
  worked and service state remained stopped. No Pi/Threshold workers were left running.

The first smoke script incorrectly expected an explicitly stopped Run's error to be null. It was
corrected to expect the existing interruption record, and rerun in a fresh isolated scene. This was
a test expectation correction, not a product fix; the first observation was retained locally.

## Limits and remaining public-release action

The successful two-Run workflow used **13 local deterministic model-fixture responses**, including
real tool dispatch, not external provider inference. It establishes the installed Linux runtime and
project continuity path, not model reasoning quality or provider availability. No existing provider
credentials were used or copied. Existing capability regression tests include real Pi selection/load
checks; this was not a new live GitHub/network-capability experiment.

Native Linux, other WSL distributions, macOS, Windows-mounted WSL workspaces, unattended operation
for weeks and arbitrary descendant-process cleanup are outside this run's evidence. WSL validation
does not expand Threshold into an OS sandbox or a multi-user service.

Before presenting the repositories as publicly accessible open source, change their visibility when
ready and check their links without authentication. That is the remaining publication prerequisite
observed here, not a reason to add core features. README now states the tested WSL scope explicitly.

Local logs/scripts are retained under `.local/wsl2-preflight/` in the development checkout and
`~/threshold-validation/` in the Ubuntu distro. They are excluded from the npm package.
