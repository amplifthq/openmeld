import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCodexModels, prepareUpdate } from "./catalog-update.mjs";
import { combineUpdates } from "./collect-update.mjs";
import {
  assertAdditionsOnly,
  findLatestScanComment,
  publicationDecision,
  renderLatestScanComment,
} from "./publish-update.mjs";
import {
  discoveryCandidates,
  renderBatchReview,
  renderRetirementReview,
} from "./review.mjs";

const existing = {
  id: "existing-model",
  displayName: "Existing model",
  unavailable: false,
  supportedReasoningLevels: ["high"],
  minCliVersion: null,
};
const catalog = {
  schemaVersion: 1,
  updatedAt: "2026-09-01T00:00:00.000Z",
  agentControllers: {
    codex: {
      defaultModelId: existing.id,
      creationDefaults: { modelId: existing.id, reasoningLevel: "high" },
      models: [existing],
    },
    "claude-code": { defaultModelId: existing.id, models: [existing] },
  },
};
// Captured from the official rust-v0.153.4 release, not an OpenMeld-shaped mock.
const raw = JSON.parse(
  await readFile(
    new URL("./fixtures/codex-rust-v0.153.4.json", import.meta.url),
    "utf8"
  )
);
const sources = [
  {
    url: "https://github.com/openai/codex/releases/tag/rust-v0.153.4",
    kind: "official-harness-catalog",
    data: raw,
  },
];
const input = {
  catalog,
  controller: "codex",
  sources,
  codexModels: parseCodexModels(raw),
  observedAt: "2026-09-05T00:00:00.000Z",
};

test("retirement handoff rechecks old cataloged models without changing policy", () => {
  const current = structuredClone(catalog);
  current.agentControllers.codex.models[0].retirement = {
    status: "announced",
    date: { kind: "not_before", value: "2026-10-15" },
    scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
    sourceUrl: "https://example.com/notice",
    verifiedAt: "2026-09-23T00:00:00Z",
  };
  const before = JSON.stringify(current);
  const evidence = {
    controller: "codex",
    sources: [
      {
        kind: "official-document",
        url: "https://example.com/notice",
        data: "Existing model will not retire before October 15.\n\nExisting model retirement has been postponed.",
      },
    ],
  };
  const brief = renderRetirementReview(evidence, current);
  for (const text of [
    "existing-model",
    "not_before: 2026-10-15",
    "postponed",
    "stopped / postponed / unconfirmed",
  ]) {
    assert.ok(brief.includes(text), `Missing retirement evidence: ${text}`);
  }
  assert.equal(JSON.stringify(current), before);
  assert.ok(
    renderRetirementReview({ ...evidence, sources: [] }, current).includes(
      "not proof of continued availability"
    )
  );
  const scan = (data, previous) =>
    prepareUpdate({
      catalog: current,
      controller: "codex",
      sources: [{ ...evidence.sources[0], data }],
      observedAt: input.observedAt,
      previous,
    });
  const original = scan("Existing model will retire on October 15.");
  assert.equal(original.changed, true);
  for (const [data, expected] of [
    [
      "Existing model will retire on October 15.\n\nNew installation instructions.",
      false,
    ],
    ["Existing model will   retire on October 15.", false],
    ["Existing model will retire on October 20.", true],
    ["Existing model retirement has been postponed.", true],
    ["Existing model retirement has been withdrawn.", true],
    ["Existing model retirement has been extended to October 20.", true],
    ["Retirement notice removed; verify the official source.", true],
  ]) {
    const result = scan(data, original.evidence);
    assert.equal(result.changed, expected, data);
    assert.deepEqual(result.catalog, current);
  }
  assert.equal(scan("An unrelated model will retire tomorrow.").changed, false);
  assert.equal(
    scan("Existing model supports extended context.").changed,
    false
  );
});

test("a real upstream addition becomes a reviewable catalog change without moving either default", () => {
  const result = prepareUpdate(input);
  const upstream = raw.models[0];
  const added = result.catalog.agentControllers.codex.models.find(
    (model) => model.id === upstream.slug
  );
  assert.deepEqual(
    added.supportedReasoningLevels,
    upstream.supported_reasoning_levels.map((level) => level.effort)
  );
  assert.equal(added.minCliVersion, upstream.minimal_client_version);
  assert.equal(
    result.catalog.agentControllers.codex.models[0].id,
    upstream.slug
  );
  assert.deepEqual(
    result.catalog.agentControllers.codex.models.slice(1),
    catalog.agentControllers.codex.models
  );
  assert.equal(
    result.catalog.agentControllers.codex.defaultModelId,
    catalog.agentControllers.codex.defaultModelId
  );
  assert.deepEqual(
    result.catalog.agentControllers.codex.creationDefaults,
    catalog.agentControllers.codex.creationDefaults
  );
  assert.deepEqual(
    result.catalog.agentControllers["claude-code"],
    catalog.agentControllers["claude-code"]
  );
  assert.equal(
    catalog.agentControllers.codex.models.some(
      (model) => model.id === upstream.slug
    ),
    false
  );
  const review = renderBatchReview(
    [result.evidence],
    { codex: { verification: "Verify the installed model/list." } },
    catalog
  );
  assert.ok(review.includes("creationDefaults"));
  assert.ok(review.includes("No authenticated probe"));
});

test("acknowledged observations stay quiet after timestamps and unrelated source edits", () => {
  const first = prepareUpdate(input);
  for (const extraSources of [
    [],
    [
      {
        kind: "official-document",
        url: "https://example.com/docs",
        data: "Updated installation instructions.",
      },
    ],
    [
      {
        kind: "official-release",
        url: "https://example.com/release",
        data: { tag: "v2", notes: "Fix terminal rendering." },
      },
    ],
  ]) {
    const second = prepareUpdate({
      ...input,
      sources: [...sources, ...extraSources],
      catalog: first.catalog,
      previous: first.evidence,
      observedAt: "2026-09-05T12:00:00.000Z",
    });
    assert.equal(second.changed, false);
    assert.deepEqual(second.catalog, first.catalog);
    const baseline = prepareUpdate({
      ...input,
      catalog: first.catalog,
      previous: first.evidence,
    });
    assert.equal(
      combineUpdates(first.catalog, [second]).fingerprint,
      combineUpdates(first.catalog, [baseline]).fingerprint
    );
  }
});

test("missing or changed inventory never retires a model or rewrites an existing selection", () => {
  const first = prepareUpdate(input);
  const reordered = structuredClone(input.codexModels);
  for (const model of reordered) {
    model.entry.supportedReasoningLevels.reverse();
  }
  assert.equal(
    prepareUpdate({
      ...input,
      catalog: first.catalog,
      codexModels: reordered,
      previous: first.evidence,
    }).changed,
    false
  );
  const changed = structuredClone(input.codexModels);
  changed[0].entry.supportedReasoningLevels = ["low"];
  const next = prepareUpdate({
    ...input,
    catalog: first.catalog,
    codexModels: changed,
  });
  assert.deepEqual(next.catalog, first.catalog);
  assert.ok(next.evidence.manual.length);
  assert.equal(next.changed, true);
  assert.equal(
    prepareUpdate({
      ...input,
      catalog: first.catalog,
      codexModels: changed,
      previous: next.evidence,
    }).changed,
    false
  );
  const missing = prepareUpdate({ ...input, codexModels: [] });
  assert.deepEqual(missing.catalog, catalog);
  assert.equal(missing.changed, false);
});

test("unknown upstream reasoning shape fails before publishing a candidate", () => {
  const invalid = structuredClone(raw);
  invalid.models[0].supported_reasoning_levels = [{ renamedField: "high" }];
  assert.throws(() =>
    prepareUpdate({ ...input, codexModels: parseCodexModels(invalid) })
  );
  assert.throws(() => parseCodexModels({ models: [] }));
});

test("upstream model instructions are excluded from the handoff", () => {
  const model = {
    ...raw.models[0],
    base_instructions: "untrusted instructions",
    model_messages: { instructions: "untrusted" },
  };
  const [parsed] = parseCodexModels({ models: [model] });
  assert.equal(Object.hasOwn(parsed.facts, "base_instructions"), false);
  assert.equal(Object.hasOwn(parsed.facts, "model_messages"), false);
});

test("open review refresh and a declined exact proposal prevent branch churn", () => {
  const fingerprint = "a".repeat(64);
  const base = { controller: "codex", fingerprint, changed: true };
  const openPull = {
    state: "OPEN",
    headRefName: "codex/catalog-update-codex-older",
    url: "https://github.com/amplifthq/openmeld/pull/1138",
  };
  assert.equal(
    publicationDecision({
      ...base,
      changed: false,
      pulls: [openPull, openPull],
    }),
    "update-review"
  );
  assert.throws(() =>
    publicationDecision({
      ...base,
      pulls: [
        openPull,
        {
          ...openPull,
          headRefName: "codex/catalog-update-another-review",
          url: "https://github.com/amplifthq/openmeld/pull/1204",
        },
      ],
    })
  );
  assert.equal(
    publicationDecision({
      ...base,
      pulls: [
        {
          state: "CLOSED",
          headRefName: `codex/catalog-update-batch-${fingerprint}`,
        },
      ],
    }),
    "already-proposed"
  );
  assert.equal(
    publicationDecision({ ...base, fingerprint: "b".repeat(64), pulls: [] }),
    "create"
  );
});

test("latest scan handoff updates only the bot-owned stable comment", () => {
  const runUrl = "https://github.com/amplifthq/openmeld/actions/runs/123";
  const rendered = renderLatestScanComment(
    "# Model catalog update\n\nFresh evidence.\n",
    runUrl
  );
  assert.ok(rendered.includes("Latest model catalog scan"));
  assert.ok(rendered.includes(runUrl));
  assert.ok(rendered.includes("Fresh evidence."));
  const human = {
    id: 1,
    user: { login: "lumpinif" },
    body: rendered,
  };
  const bot = {
    id: 2,
    user: { login: "github-actions[bot]" },
    body: rendered,
  };
  assert.equal(findLatestScanComment([human]), null);
  assert.equal(findLatestScanComment([human, bot]), bot);
  assert.throws(() => findLatestScanComment([bot, { ...bot, id: 3 }]));
});

test("publication rejects a default change even when the catalog itself is valid", () => {
  const prepared = prepareUpdate(input);
  assert.doesNotThrow(() =>
    assertAdditionsOnly(catalog, prepared.catalog, [prepared.evidence])
  );
  prepared.catalog.agentControllers.codex.defaultModelId = raw.models[0].slug;
  assert.throws(() =>
    assertAdditionsOnly(catalog, prepared.catalog, [prepared.evidence])
  );
});

test("one handoff names discovery-only candidates and flags actual source disagreements", async () => {
  // Captured from the first hosted collection on 2026-09-05, run 33951500949.
  const discovery = JSON.parse(
    await readFile(
      new URL("./fixtures/discovery-2026-09-05.json", import.meta.url),
      "utf8"
    )
  );
  const codex = prepareUpdate({
    ...input,
    sources: [
      ...sources,
      {
        kind: "discovery-only",
        url: "https://models.dev/api.json",
        data: { openai: discovery.openai },
      },
    ],
  });
  const claude = prepareUpdate({
    ...input,
    controller: "claude-code",
    codexModels: [],
    sources: [
      {
        kind: "discovery-only",
        url: "https://models.dev/api.json",
        data: { anthropic: discovery.anthropic },
      },
    ],
  });
  const combined = combineUpdates(catalog, [codex, claude]);
  assertAdditionsOnly(catalog, combined.catalog, combined.evidence);
  assert.deepEqual(
    combined.catalog.agentControllers["claude-code"],
    catalog.agentControllers["claude-code"]
  );
  const config = {
    codex: { verification: "Check model/list" },
    "claude-code": { verification: "Check installed account" },
  };
  const review = renderBatchReview(combined.evidence, config, catalog);
  assert.ok(review.includes("## codex"));
  assert.ok(review.includes("## claude-code"));
  assert.ok(review.includes("anthropic/claude-fable-5-1"));
  assert.ok(review.includes("Discovery only; exact harness ID"));
  assert.ok(review.includes("Different surfaces; verify against the harness"));
  assert.ok(review.includes("ultra"));
  assert.equal(claude.changed, true);
  const metadata = structuredClone(claude.evidence.sources);
  for (const model of Object.values(metadata[0].data.anthropic)) {
    model.name = `${model.name} updated description`;
    for (const option of model.reasoning_options ?? []) {
      option.values.reverse();
    }
  }
  const repeated = prepareUpdate({
    ...input,
    controller: "claude-code",
    codexModels: [],
    previous: claude.evidence,
    sources: [
      ...metadata,
      {
        kind: "official-document",
        url: "https://example.com/docs",
        data: "New installation instructions.",
      },
    ],
  });
  assert.equal(repeated.changed, false);
  assert.equal(
    combineUpdates(catalog, [repeated]).fingerprint,
    combineUpdates(catalog, [claude]).fingerprint
  );
  assert.equal(
    combineUpdates(catalog, [codex, claude]).fingerprint,
    combined.fingerprint
  );
  assert.throws(() =>
    assertAdditionsOnly(
      catalog,
      { ...combined.catalog, updatedAt: catalog.updatedAt },
      combined.evidence
    )
  );
});

test("review classification preserves exact routes while identifying cataloged Cursor bases", () => {
  const cursorIds = [
    "claude-fable-5-1[thinking=true,context=300k,effort=high]",
    "gemini-3.8-flash[reasoning_effort=high]",
  ];
  const current = {
    agentControllers: {
      cursor: {
        defaultModelId: "default[]",
        models: cursorIds.map((id) => ({ ...existing, id })),
      },
      opencode: {
        defaultModelId: "openai/gpt-6-astra",
        models: [{ ...existing, id: "openai/gpt-6-astra" }],
      },
    },
  };
  const cursorEvidence = {
    changes: [],
    controller: "cursor",
    manual: [],
    observedAt: "2026-09-16T00:00:00.000Z",
    sources: [
      {
        kind: "discovery-only",
        url: "https://models.dev/api.json",
        data: {
          cursor: {
            "claude-fable-5-1": {
              id: "claude-fable-5-1",
              name: "Claude Fable 5.1",
            },
            "gemini-3.8-flash": {
              id: "gemini-3.8-flash",
              name: "Gemini 3.8 Flash",
            },
            "grok-4.6": { id: "grok-4.6", name: "Grok 4.6" },
          },
        },
      },
    ],
  };
  const candidates = discoveryCandidates(cursorEvidence, current);
  assert.deepEqual(
    candidates.map(({ matchingExistingIds, model }) => ({
      id: model.id,
      matchingExistingIds,
    })),
    [
      {
        id: "claude-fable-5-1",
        matchingExistingIds: [cursorIds[0]],
      },
      {
        id: "gemini-3.8-flash",
        matchingExistingIds: [cursorIds[1]],
      },
      { id: "grok-4.6", matchingExistingIds: [] },
    ]
  );
  const review = renderBatchReview(
    [cursorEvidence],
    { cursor: { verification: "Check authenticated ACP inventory" } },
    current
  );
  assert.ok(
    review.includes("Already cataloged; additional ACP variants require review")
  );
  for (const id of cursorIds) {
    assert.ok(review.includes(id));
  }
  assert.ok(
    review.includes("cursor/grok-4.6 | unknown | not declared | Discovery only")
  );
  assert.deepEqual(
    current.agentControllers.cursor.models.map((model) => model.id),
    cursorIds
  );

  const [openCodeCandidate] = discoveryCandidates(
    {
      ...cursorEvidence,
      controller: "opencode",
      sources: [
        {
          kind: "discovery-only",
          url: "https://models.dev/api.json",
          data: {
            opencode: {
              "gpt-6-astra": { id: "gpt-6-astra", name: "GPT-6 Astra" },
            },
          },
        },
      ],
    },
    current
  );
  assert.equal(openCodeCandidate.candidateId, "opencode/gpt-6-astra");
  assert.deepEqual(openCodeCandidate.matchingExistingIds, []);
});
