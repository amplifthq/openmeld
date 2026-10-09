# Computer sync source patch

`upstream.patch` fixes ordered peer application in Cloudflare Computer 0.4.1,
source commit `070359ff2db12442845bfce84512ec9beae35cdf`. Receiver node revisions
and sender revisions use separate clocks. A fresh sender tombstone must not be
discarded because the receiver's local revision is larger.

Ordered peers pass the existing accepted source `(rev, path)` cursor to the
shared dofs apply owner. Entries at or below that cursor are replays. Metadata,
deliberate read-only refusals and cursor advancement commit together. The stored
cursor never moves backward; an ACK still echoes the exact submitted block.
New receiver writes survive retransmission after ACK loss. Unsequenced callers
retain the existing tombstone protection. This patch adds no database schema,
per-path version store or filesystem implementation.

The Remote Agent Dockerfile fetches the pinned archive, verifies its SHA-256,
applies this patch, installs its dependency lock without install scripts, and
builds the official computerd sources and SEA bootstrap. `build.mjs` restricts
the upstream binary build to the pinned Linux x64 Node target. The resulting
image records its source, lock, patch and binary hashes in
`/usr/local/share/openmeld/computerd-source.json`.

The Worker SDK's database, dofs apply, RPC sync-engine and runtime sync-driver
bundle regions are compiled from these same patched sources with the upstream
`@cloudflare/computer` build. They form part of
`patches/@cloudflare__computer@0.4.1.patch`. Regeneration must preserve the
existing bounded path planner, mode selection and stream cancellation
corrections. The patched
index does not advertise the vendor's unchanged source map. Review the source
patch here for the sync contract, rather than reading that original source map.

Deploy the native image, Worker patch and FUSE configuration together through
the normal Remote Agent release. A Worker-only package patch does not change a
precompiled native receiver. The FUSE configuration disables automatic cache
reuse across opens and refreshes attributes; per-open kernel caching and normal
block sizes remain enabled.

For focused source validation, apply the patch to the pinned archive, run
`npm ci --ignore-scripts` for the dofs, RPC and computer workspaces, build
`@cloudflare/computer-rpc`, and run the three upstream sync-engine test files.
Their cases include entry/pack ACK loss with newer receiver writes and SQLite
cursor-commit failure. Run heavy installation/build checks through `pnpm dev:run`.

Nested transactions belong to the storage adapter. Durable Objects use their
public synchronous transaction API, while native SQLite manages savepoints.
The focused workerd check also verifies that an inner failure rolls back its
writes while an outer transaction catches that failure and continues.

This correction prevents new source changes from being falsely acknowledged.
It does not replay deletions already acknowledged by an older receiver. Existing
Workspace state is retained; no production reset or full replay is introduced.

The opt-in native checker uses actual computerd and requires Docker:

```sh
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs matrix
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs pack
pnpm dev:run -- node services/remote-agent/scripts/verify-computer-container.mjs adoption
```

It uses disposable state and retains reports outside the cleaned state directory.
Reports include source hashes and actual FUSE mount evidence. These local native
checks do not certify production CPU limits or live rollout.
