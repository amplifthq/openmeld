# Bounded Computer synchronization

The Worker SDK and native daemon use Cloudflare Computer 0.5.0, source commit
`ec39cb693a5be73a735d375e228b4e2adb754abb`. The Dockerfile verifies the archive
SHA-256, applies `upstream.patch`, and builds the official SEA entrypoint.
The image records source, dependency lock, patch and binary hashes in
`/usr/local/share/openmeld/computerd-source.json`.

## Work and correctness boundaries

Both producers prepare a durable generation through indexed pages of at most
4096 reads. Candidate paths, ancestor traversal, aliases and tombstones resume
from SQLite, including within one revision. UTF-16 path ordering matches the
wire cursor. One invocation transfers at most 256 metadata entries, 1 MiB of
metadata and a streamed object batch of at most 256 objects and 8 MiB. Small
files fit together without repeatedly rebuilding their entire metadata page;
large files still stage bounded batches before metadata application. A file
with more than 8,192 chunks is rejected explicitly
without advancing its ACK. Pack transport is disabled on this bounded path.
The legacy whole-window utility is not used by production synchronization.

Recursive path resolution fixes the SQLite join order so each path segment is
known before looking up its directory entry. This uses the complete existing
`(parent_inode, name)` primary key instead of scanning all siblings for every
imported file. The Worker SDK and native patch carry the same query. This changes
no file, cursor, acknowledgement or recovery semantics; a fresh native mirror
still requires its accepted input to be synchronized before execution.

Receivers detach a deleted or replaced directory atomically. A durable queue
reclaims at most 128 child/chunk units per step. Later path recreation and
external hardlinks survive cleanup. Delayed tombstones cannot overwrite newer
deletion history. Path resolution checks read-only destinations through symlinks.
Metadata, deliberate refusals and accepted source cursors commit together.
ACK loss replays the exact source page without overwriting receiver-local work.
Push watermarks can include a requested retention slot's generation and closed
flag in the same read transaction as its epoch and cursors. After reconciliation,
a matching open generation avoids repeated retention-head and admission calls.
This projection is not persisted and is not a lease: all pinning and writes
still validate the original scope. Initial ownership uses the existing
expected-generation compare-and-set; closed cleanup remains idempotent.
Import receipts are acknowledged immediately, including the final page.

The object receiver buffers at most 256 objects and 8 MiB per transaction,
with at most one additional filesystem chunk read ahead to select that boundary.
It reads the stream outside the transaction, rechecks its original retention
scope inside each transaction, and commits bytes, pins and maintenance dirtiness
together. Interrupted streams discard the uncommitted tail; prior complete
groups can remain staged without advancing metadata or receipt cursors.
Capacity or commit failures retain their original error. An acknowledged object
batch still does not authorize execution without the existing metadata ACK.

Preparation exposes an opaque digest of its actual durable traversal position,
including pending deletion traversal, without revealing file paths. Repeating
a read without work produces the same checkpoint.

Generation closure atomically fences late writes and persists a retirement
record. That durable handoff acknowledges cleanup responsibility before physical
reclamation. Existing native and Worker maintenance loops reclaim the retired
generation in bounded pages after restart. Launch readiness depends on input
ACK and epoch checks, not on deleting every obsolete pin and plan first.

Every database has a durable epoch. A new peer epoch resets transfer cursors,
not user files. Before dispatch, native shell execution synchronously checks
the expected epoch and accepted input cursor. An explicit pre-dispatch rejection
permits another preparation step; an uncertain dispatch never permits replay.
Failed and lost sync targets remain diagnostic history. Only active targets
participate in regression detection, so repeated checks of a replacement peer
converge without clearing a historical failure or replaying its command.

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

## Preparation timing

AgentComputer enables the existing SDK `sync.block` log for execution
preparation as well as public synchronization. Preparation records carry
`purpose: execution-preparation`, generation, phase, opaque checkpoint,
block entry/byte counts and accepted revision cursors. Revision values are not
file counts. Failed blocks omit unconfirmed progress and retain `failedStage`;
logging failures cannot change the sync result or its original exception.

Each block reports `startedAtMs` and `finishedAtMs` for correlation, monotonic
`blockMs`, and scalar elapsed intervals: `watermarksMs`, `retentionMs`,
`prepareMs`, `planMs`, `hasObjectsMs`, `pushObjectsMs`, `pushEntriesMs`,
`importAckMs`, `cleanupMs` and `localMs`. Counts include `preparationReads`,
`plannedEntries`, `plannedObjects` and successfully acknowledged `stagedObjects`.
The existing log owner emits one record per driven block, with no file paths,
contents, commands, credentials, new durable statistics or RPC fields.

Use one Computer and generation to separate active blocks from gaps between
blocks, then compare the stage intervals. Keep the platform invocation wall/CPU
measurements alongside these records. Production Workers timers advance only
after I/O, so synchronous planning can report zero and its elapsed work can be
charged to the next I/O interval. These are observations, not SQL CPU profiles
or isolated network RTTs. CPU headroom is omitted unless the host supplies an
actual CPU measurement. See the [Workers timer contract](https://developers.cloudflare.com/workers/runtime-apis/performance/).
Query sampling or missing records prevents an exact gap or total calculation.
Object-transfer time includes streaming and receiver writes; it does not
separate native stream waits from individual SQLite commits.

## Imported-file confirmation

An import receipt avoids reverse enumeration only after proving that the
receiver's entire unacknowledged window equals the source entries. The proof
runs in the metadata transaction with a shared 4096-unit budget for nodes,
ancestor/alias lookups and manifest chunks. Partial cursors, extra local files,
aliases, tombstones, pending removal work and exhausted budgets keep the normal
bounded transfer. Files retain source mode and modification time as well as
content; identical bytes alone do not make an incoming metadata update a no-op.

Each receiver slot retains one receipt, bound to both database epochs and the
existing transfer generation. It returns that receipt only after native flush
succeeds, including retries with an empty entry stream. The source atomically
commits its original transfer cursors and one outgoing acknowledgement before
sending the ACK. The receiver advances its original push cursor only on that
ACK. An operation cannot close while its ACK is pending. Late local writes lie
beyond the receipt's fixed end and remain ordinary unsynchronized work.
Receipt records use the existing maintenance reserve, like transfer cursors;
reaching the content limit must not block acknowledgement of accepted files.

The next push also carries the source's durable fetch cursor as a real ACK, so
a window that required normal transfer does not permanently disable receipts.
That cursor is sent only for its observed peer epoch. A replacement between
watermark inspection and retention admission rejects the step; the existing
reconciliation path resets cursors on the next attempt without changing files.
Older peers without this optional exchange use the existing bounded transfer;
the mandatory retention and execution fences remain unchanged. Once a receipt
is pending, its receiver must retain acknowledgement support: rolling back only
that receiver fails explicitly and preserves the pending receipt. Existing data
without proof is not retroactively declared synchronized. No new command
state, replay authority, expiry-based cleanup or directory exclusion is added.

## Deployment boundary

Deploy compatible Core callback and frozen-result readers before Remote Agent.
The SDK and native image require the same retention protocol. Do not enable a
legacy synchronization fallback: missing retention support must fail before
advancing a cursor or starting a new command. The Center Agent must preserve
confirmed results and explain Computer unavailability during that window.

Cloudflare activates Worker code before replacing container images. A successful
deploy starts the rollout; it does not prove that the fleet uses the new image.
Follow the guarded production release, then verify the target image digest,
rollout completion and instance convergence before the user-path smoke. Existing
commands remain subject to container replacement: only confirmed canonical
synchronization proves that their files survive. Do not replay uncertain work.
See the official [container rollout contract](https://developers.cloudflare.com/containers/configuration/rollouts/).

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

The optional retention projection interoperates with the previously patched
0.5.0 protocol in both directions: new clients use the original retention RPCs
when old servers omit it; old clients use their original RPCs on new servers.
Object batching changes no wire fields. Metadata/receipt bounds, native dispatch
fences, file storage and command identities remain unchanged. This does not
extend compatibility to older unpatched peers without bounded sync support.
No public OpenMeld CLI, Service, Skills, Core, Gateway or Web contract changes.

The 0.5.1 upgrade was assessed separately. Its deletion/replay and mount-schema
changes overlap the current ownership patch: applying the existing patch fails
in nine files across 23 hunks, including receiver apply and sync-engine code.
Adopting it requires a separate merge and deletion/replay migration check. Its
object receiver still stages one object at a time and its watermarks have no
retention projection, so the present bounded cost correction stays on 0.5.0.

Focused source checks cover bounded planning, receiver reclamation, large file
objects, source replacement, refusal retention, dispatch fencing and execution
result recovery. The opt-in native check uses actual Linux/FUSE, disposable
storage, independent HTTP steps, receiver-committed lost ACKs and Computer restart:

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs bounded candidate
```

The focused nonempty-object check transfers 256 distinct small files and a
10 MiB file in both directions. It counts objects and bytes in the actual RPC
streams, verifies both batch ceilings and content, and uses separate HTTP steps:

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs objects candidate --stress
```

The same check retains the original command output and exit code, disposes its
native execution logs, and confirms `ENOENT` for that execution record. Cold
Workspace instances then resume the original synchronization window. File bytes
and the single command launch are checked independently of the expired logs.

This applies the same native CPU and memory limits after warmup, on one
disposable instance. It complements rather than replaces the large-directory
restart matrix. SDK progress byte counts describe a metadata block and must
not be treated as measured transport bytes.

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
