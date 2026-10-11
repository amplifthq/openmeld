# Bounded Computer synchronization

The Worker SDK and native daemon use Cloudflare Computer 0.5.0, source commit
`ec39cb693a5be73a735d375e228b4e2adb754abb`. The Dockerfile verifies the archive
SHA-256, applies `upstream.patch`, and builds the official SEA entrypoint.
The image records source, dependency lock, patch and binary hashes in
`/usr/local/share/openmeld/computerd-source.json`.

## Work and correctness boundaries

Both producers prepare a durable generation through indexed pages of at most
512 reads. Candidate paths, ancestor traversal, aliases and tombstones resume
from SQLite, including within one revision. UTF-16 path ordering matches the
wire cursor. One invocation transfers at most 256 metadata entries, 1 MiB of
metadata and 16 objects. A file with more than 8,192 chunks is rejected explicitly
without advancing its ACK. Pack transport is disabled on this bounded path.
The legacy whole-window utility is not used by production synchronization.

Receivers detach a deleted or replaced directory atomically. A durable queue
reclaims at most 128 child/chunk units per step. Later path recreation and
external hardlinks survive cleanup. Delayed tombstones cannot overwrite newer
deletion history. Path resolution checks read-only destinations through symlinks.
Metadata, deliberate refusals and accepted source cursors commit together.
ACK loss replays the exact source page without overwriting receiver-local work.

Every database has a durable epoch. A new peer epoch resets transfer cursors,
not user files. Before dispatch, native shell execution synchronously checks
the expected epoch and accepted input cursor. An explicit pre-dispatch rejection
permits another preparation step; an uncertain dispatch never permits replay.

Each execution pins its accepted start cursor and its own settled output target.
A shared transfer finishing another command's earlier target is insufficient.
Read-only refusals are journaled by source epoch/revision/path. Completed outcomes
retain up to 16 refused paths plus a truncation flag. They can be read independently
of native execution logs. This proof does not invent stdout, exit or process state.
The execution owner retires old-epoch pins with an explicit lost outcome.
`maintainSync()` prunes eligible journal pages; AgentComputer alarms continue until
that maintenance finishes. Pending executions retain their necessary journal.

`MOUNT_IGNORE` is not enabled. Dependencies and user files retain their existing
storage semantics. Excluding a directory from FUSE is not an equivalent fix.

## Storage and transport ownership

The native filesystem uses file-backed SQLite at
`/var/lib/computerd/workspace.sqlite`, with a 4 GiB database ceiling, a bounded
64 MiB page cache, file-backed temporary storage and full commit synchronization.
FUSE writes use the direct range path instead of retaining a whole-file write
buffer for each open file. The canonical Workspace has the same 4 GiB application
budget. Both admit new content below that ceiling with 64 MiB reserved for
maintenance; capacity reports use allocated SQLite pages minus reusable pages.
The database budget leaves disk space for its WAL, temporary files and command
work on the production 12 GB native instance. It is an application budget, not
the provider's advertised maximum or a guarantee of free temporary disk.
Native `max_page_count` is a second, hard limit. Quota refusal preserves committed
files and reports ENOSPC. It does not reset the database or replay a command.
SQLite automatic rollback poisons the enclosing transaction, even if application
code catches the error, so subsequent writes cannot escape as auto-commits.

New paths reserve their deletion record before creation. Recursive removal
reuses that record and stores compact queue references; cleanup does not first
copy all descendant paths. Legacy databases prepare these reservations in
resumable pages before accepting namespace/content mutations. Reads remain
available. Preparation returns EAGAIN while incomplete. An already-full legacy
database may need operator-assisted export or additional headroom; migration
must not delete live files to make room.

Bounded content collection protects live file chunks, active read streams and
durable transfer generations. A receiver epoch and generation fence every
transfer pin and late response. Pins survive restart until acknowledged cleanup
or explicit retirement; elapsed time alone does not authorize deletion. Each
content-table scan has its own cursor and completion marker. New work dirties
the sweep and schedules another pass, including after cold start and file-only
operations. Legacy reservation work cannot prevent a new reclamation sweep.
The native loop stops scanning when maintenance completes. File mutations,
stream release and the shared transfer-retirement writer wake that same loop.
Unique deletion history remains durable; unlimited distinct names can still
reach the declared capacity. Directory rename retains its existing atomic
subtree operation and is not claimed to have bounded total work.

Both peers use Cap'n Web 0.12.0 with the same finite-RTT correction. Zero-duration
samples still acknowledge bytes but cannot turn the congestion window into NaN.
Connection POST and health probes consume the remaining connection deadline.
This is a connection bound, not a fixed lifetime timeout for a running command.
Native disk persistence covers process restart; container replacement still
requires confirmed synchronization to canonical storage.

## Regeneration and validation

Apply `upstream.patch` to the pinned archive, install its locked workspaces with
`npm ci --ignore-scripts`, and build `@cloudflare/computer`. Its distribution
generates `patches/@cloudflare__computer@0.5.0.patch`; do not hand-edit generated
bundle internals. Run builds and native checks through `pnpm dev:run`.

Focused source checks cover bounded planning, receiver reclamation, large file
objects, source replacement, refusal retention, dispatch fencing and execution
result recovery. The opt-in native check uses actual Linux/FUSE, disposable
storage, independent HTTP steps, receiver-committed lost ACKs and Computer restart:

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs bounded candidate
```

Reports retain exact source/binary provenance outside disposable runtime state.
Local checks do not certify production CPU limits or identify historical OOM
allocations. Deploy the native image and Worker patch together through the
guarded Remote Agent release; old peers do not implement bounded planning or
dispatch fencing. No merge or deployment is implied by these checks.

### Native resource stress

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs bounded candidate --stress
```

This isolated check applies the repository's production `standard-2` native
limits: 1 vCPU and 6 GiB memory, with swap disabled. It verifies both Docker
configuration and Linux cgroup limits before admitting each workload. Initial
empty-container warmup precedes limit installation; cumulative memory peaks
include warmup. This is not a cold-start limit test.

The workload adds 1,024 writes of 64 KiB and interleaved deletions during
synchronization, four actual container replacements, and a final drain. It also
checks the 20,200-file directory in each direction, deleted/recreated paths and
receiver-committed lost acknowledgements. File names and retained content are
checked against independent expected values. The fourth replacement occurs after
native-produced files reach canonical storage and verifies their restoration.
Lost acknowledgements cover Worker-to-native pushes, not reverse transfers.
An unsynchronized native file is a separate negative control: container loss can
remove it, so process exit alone must not claim durable file success.
Each replacement follows a final
kernel peak/OOM checkpoint; missing lifetime telemetry fails resource acceptance.
`resources.json` accompanies the normal provenance and file report.

Container CPU quota and Worker invocation CPU time are different limits. Local
Workerd does not reproduce Cloudflare's per-isolate memory and per-invocation CPU
enforcement. Local heap samples are diagnostic evidence only. Passing this check
does not certify the cloud Worker 128 MB memory or default 30-second CPU budget,
unbounded application writers, or workloads larger than the recorded scenario.

### Native storage capacity

Use the image ID produced by the bounded container check:

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-storage-capacity.mjs cloudflare-dev/computercontainerprobe:IMAGE_ID retain
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-storage-capacity.mjs cloudflare-dev/computercontainerprobe:IMAGE_ID churn
```

These checks apply 1 vCPU, 6 GiB RAM and no swap from cold start. The retain case
writes at least 3 GiB of unique 16 MiB files before normal capacity refusal, then checks every
successful file before deletion. The churn case writes 8 GiB cumulatively while
deleting each prior file. Both delete the directory, verify another write and
kill and restart the same container to verify that the post-reclamation file
survives an abrupt process stop. This is not a host power-loss test. Reports include
source provenance, cgroup peaks and OOM counters, file hashes and SQLite/WAL
sizes. An optional fourth argument selects the JSON evidence path. These checks
do not enforce the production 12 GB physical disk quota and do not replace
canonical synchronization and replacement-container tests.
