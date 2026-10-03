# Inbox query benchmark

Run from the repository root after building Core workspace dependencies:

```sh
pnpm exec turbo run build --filter=@openmeld/core^...
mkdir -p dev-tmp/inbox-benchmark
pnpm --filter @openmeld/core exec tsx scripts/inbox-query-benchmark.ts 2000 ../../dev-tmp/inbox-benchmark/current.json 20000
```

Arguments are item count, output path, unrelated-tenant item count (optional),
and a prior benchmark JSON file (optional). One seed item is additional to the
requested count. The optional prior file supplies the old summary SQL for a
four-request concurrency comparison on the same current schema and data.
Use trusted, locally generated benchmark files only.

This starts a disposable in-memory Miniflare/workerd D1 database with the
installed Wrangler runtime and real migration schema. It copies a fictional
fixture, never production data, and disposes the runtime on completion. The
workload deliberately concentrates current personal-Agent mentions and first
contacts in one recipient's Inbox to exercise relation-heavy classification.
The separate tenant has ordinary messages. This is a stress distribution, not
a claim about the production population.

The report contains three iterations of actual summary, feed creation/read,
and notification-observation queries, including SQL, bindings, query plans,
D1 rows read/written, and duration. A feed includes snapshot creation, member
insertion, snapshot read, counts and rows; sum those query metrics for a full
feed request. Batch wall-clock time is attached to every member statement and
must not be summed. Use individual D1 duration for query comparisons.

Capture the baseline before modifying source. Repeat at larger recipient sizes
and with unrelated-tenant rows. Inspect query plans rather than treating a CTE
name as proof of materialization. Snapshot membership writes are intentional:
reducing them must not change the frozen selection contract. Index maintenance
adds write work on Inbox insertion; the observation index buys two bounded
equality-range maximum lookups without a persisted high-watermark authority.

Local D1 metrics and concurrency timings do not establish production latency,
regional effects, queue capacity, or a user-count limit. Use production D1 query
insights and existing scheduled-retention logs after an authorized deployment
to verify the real workload. No production writes or load test are performed by
this benchmark.

## Recorded comparison

Local workerd run on 2026-10-03, against the query implementation at
`70c897b45f9c04977ff36c9056cf723b4b5f0679` and this change. Values below are
the median of three runs with 10,001 relation-heavy recipient items.

| Operation | Before rows read | After rows read | Before / after D1 duration | Before / after rows written |
| --- | ---: | ---: | ---: | ---: |
| Attention summary | 830,083 | 280,028 | 439 / 109 ms | 0 / 0 |
| Full feed, including frozen snapshot | 2,800,289 | 720,096 | 1,474 / 311 ms | 30,007 / 30,007 |
| Notification insertion watermark | 10,001 | 1 | below 1 ms / below 1 ms | 0 / 0 |

Four concurrent summary requests on the same current schema took 1,785 ms
with the baseline SQL and 441 ms with the changed SQL. Adding 20,000 unrelated
tenant items to a 2,001-item recipient fixture left summary reads at 56,028
and full-feed reads at 144,096. This supports recipient-scoped query work,
not a production concurrency or capacity claim. The existing frozen member
insertion remains the full-feed write cost; it was deliberately not replaced
with a watermark-only selection.
