# Center Agent memory baseline (#340)

This experiment separates capture, provider processing/search, adapter filtering,
context projection, and model use before changing production memory behavior.
It reuses the real Core memory service, recall-query assembly, Zep adapter, and
Remote Agent system/turn-envelope renderers. It runs the current worktree's
implementation. `RESULTS.md` preserves the initial baseline;
`CANDIDATE_RESULTS.md` records subsequent implementation and the remaining gap.

## Corpus and evidence boundary

`cases.ts` contains four sanitized reconstructions from the October 27–28 audit
and two derived controls for Task state and current work-target precedence.
Names, accounts, repository names, message
identifiers, and dates are fictional. Original transcripts and the local mapping
to source passages are not committed or sent to providers.

The stale-save case reconstructs a save from the Agent's visible report. The
original provider write payload and historical graph snapshot were not captured.
This experiment establishes what the current code does with the reconstructed
input; it does not establish what Zep received in that production incident.
Likewise, the continuation probe deliberately omits the authoritative work target
to isolate recall. It does not reproduce or invalidate the delivered goal-binding
fix. Task state and search coverage are supplied read-only evidence, not live tools.

The in-memory repository models enabled Organization memory and active-subject
lifecycle only. No PostgreSQL authorization, full native dispatch, tool execution,
compaction, private-memory disclosure, or end-to-end product claim follows.
Explicit retained-memory source-access checks are outside this initial experiment;
automatic recall's adapter provenance checks are exercised and observed.

## Run

Run the evaluator's deterministic integrity tests without credentials:

```sh
pnpm --filter @openmeld/core exec vitest run --config vitest.boundary.config.ts \
  tests-node/memory-baseline.test.ts --maxWorkers=1
```

Generate a complete offline report. Provider/model stages are explicitly
`not_run`; the transport stub does not simulate semantic extraction or search:

```sh
OPENMELD_MEMORY_BASELINE=offline pnpm --filter @openmeld/core exec vitest run \
  --config vitest.boundary.config.ts tests-node/memory-baseline.live.test.ts \
  --maxWorkers=1
```

The opt-in paid DEV mode uses the existing `openmeld-core/dev` Zep credential and
`OPENROUTER_SMOKE_API_KEY`. For a run authorized to send this sanitized corpus to
Zep and OpenRouter, inject only those secrets into the child process without
printing or writing them:

```sh
python3 - <<'PY'
import os, subprocess, sys
runtime_env = os.environ.copy()
for name in ['ZEP_OPENMELD_API_KEY', 'OPENROUTER_SMOKE_API_KEY']:
    value = subprocess.run(
        ['doppler', 'secrets', 'get', name, '--project', 'openmeld-core',
         '--config', 'dev', '--plain'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if value.returncode or not value.stdout.strip():
        raise SystemExit('Required development credential unavailable: ' + name)
    runtime_env[name] = value.stdout.strip()
runtime_env.update(DOPPLER_PROJECT='openmeld-core', DOPPLER_CONFIG='dev',
                   OPENMELD_MEMORY_BASELINE='live')
sys.exit(subprocess.run(
    ['pnpm', '--filter', '@openmeld/core', 'exec', 'vitest', 'run',
     '--config', 'vitest.boundary.config.ts',
     'tests-node/memory-baseline.live.test.ts', '--maxWorkers=1'],
    env=runtime_env).returncode)
PY
```

The current six-case corpus permits 18 model calls, each at most 100 KB of messages and
1,024 output tokens. A reported-cost threshold of USD 2 stops subsequent calls;
it is not a provider-enforced spending cap. Missing cost is reported separately.
Zep billing is not exposed by this adapter. Do not substitute production keys.

Each run owns unique UUID-prefixed subjects. The adapter enforces a hard maximum
of eight unique graph targets before creation, including source interventions.
Only graphs registered by that run are cleanup targets.
Empty captures never create a graph. Cleanup outcomes remain in the report, and
failures must be investigated using that exact run's identifiers. The runner
does not enumerate existing users or graphs and never uses installed Service state.

## Stages and interventions

1. Replay completed shared turns and any reconstructed explicit save through
   `createCenterAgentMemoryService`. Record attempted writes and accepted receipts.
2. In live mode, poll each accepted episode's processing state, bounded to 90
   seconds plus one in-flight read. Processing completion is not recall success.
3. Assemble the actual recall query and execute the normal memory service. Record
   raw SDK graph results, provenance reads, adapter results, the 3-second service
   deadline outcome, final memory envelope, and rendered model messages.
4. Compare three arms with identical question, system prompt, model, and output
   budget: no memory, current pipeline, and manually verified context. Arm order
   alternates between cases. Expected answers are not sent to the model.
5. For the three cases with source history, supply the complete corrected turns
   to a separate disposable graph, bypassing the capture policy **only as an
   experimental intervention**. Compare the actual query and a manually focused
   query. Raw and adapter outputs from each individual call can be compared
   without introducing a second search/ranking result.
6. A separately labeled deterministic projection intervention supplies a long
   candidate containing a late qualifier. It measures whether the existing
   envelope budget preserves the qualifier; it is not a production frequency claim.

The observed live client disables retries and bounds transport to 15 seconds.
Core keeps its normal 3-second recall and 5-second write deadlines. The observer
waits for already-started operations before cleanup. Direct intervention searches
are not subject to Core's 3-second recall deadline; their measured latency is
reported separately. Headers and credentials are never included in observations.

## Reading the report

Reports are generated under ignored `dev-tmp/memory-baseline/<run-id>/report.json`.
Tracked code never reads that directory as an input. Reports include failed
outcomes and all arms; no best-run selection or post-result rubric changes.

- No attempted write means the source did not reach the provider through that
  capture path. It does not prove an existing production graph lacked the fact.
- A stale supplied summary that is faithfully returned identifies an upstream
  information-selection problem in that replay, not provider corruption.
- A processed receipt plus correct raw facts distinguishes extraction from recall.
  A focused-query miss alone does not prove absence from the graph.
- Compare raw results and adapter items for the **same call** to locate provenance
  filtering. Compare adapter items, envelope, and rendered prompt to locate budget
  or assembly loss. Do not remove authorization checks to improve a score.
- A verified-context success shows that this model can answer this bounded probe
  when given the needed evidence. It does not prove that a live Agent will choose
  the right tools or actions.
- Scores measure attainment of the held-out factual target. An honest unknown in
  a no-memory arm can miss that target without being a model reasoning failure.
  `not_run`, invalid responses, provider errors, and factual misses stay distinct.
- One run per arm is a diagnostic observation, not a statistically reliable model
  benchmark. A seemingly more focused query is not presumed to improve recall.

Existing access/deletion/timeout tests remain separate evidence. The initial
baseline does not close #340's broader scope, learning, forgetting, and privacy
acceptance checklist, nor does it backfill historical business work.

## Ownership and release impact

The harness itself changes no production state. The subsequent runtime candidate
adds Space subjects and migration `0052_center_agent_space_memory`, with a draft
Changelog entry and the contract impact audit in
`developing/architecture/shared-contracts.md`. Its provider/Source ownership is
documented in `developing/architecture/data-and-observability.md`. Local results
do not imply a deployment or completion of the full #340 design.

The captured retrieval can be replayed without Zep access:

```sh
OPENMELD_MEMORY_GROUNDING_REPLAY=offline pnpm --filter @openmeld/core exec vitest run \
  --config vitest.boundary.config.ts tests-node/space-memory-grounding.test.ts \
  --maxWorkers=1
```

The separately authorized `live` mode of that replay makes exactly two bounded
OpenRouter calls and no Zep calls. It uses the same DEV smoke-key handling as
above. It records request-start state before transmission and has a 150-second
outer test deadline. An interrupted request is not permission to repeat it;
retain its unknown outcome and account for any potentially consumed call.
