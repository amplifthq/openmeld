import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseCodexModels,
  prepareUpdate,
  renderReview,
} from "./catalog-update.mjs";
import { assertAdditionsOnly, publicationDecision } from "./publish-update.mjs";

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
  const review = renderReview(
    result.evidence,
    "Verify the installed model/list."
  );
  assert.ok(review.includes("creationDefaults"));
  assert.ok(review.includes("No authenticated harness probe"));
});

test("acknowledged observations stay quiet despite the next collection timestamp", () => {
  const first = prepareUpdate(input);
  const second = prepareUpdate({
    ...input,
    catalog: first.catalog,
    previous: first.evidence,
    observedAt: "2026-09-05T12:00:00.000Z",
  });
  assert.equal(second.changed, false);
  assert.equal(second.catalog.updatedAt, first.catalog.updatedAt);
});

test("missing or changed inventory never retires a model or rewrites an existing selection", () => {
  const first = prepareUpdate(input);
  const changed = structuredClone(input.codexModels);
  changed[0].entry.supportedReasoningLevels = ["low"];
  const next = prepareUpdate({
    ...input,
    catalog: first.catalog,
    codexModels: changed,
  });
  assert.deepEqual(next.catalog, first.catalog);
  assert.ok(next.evidence.manual.length);
  const missing = prepareUpdate({ ...input, codexModels: [] });
  assert.deepEqual(missing.catalog, catalog);
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

test("review ownership and a declined exact proposal prevent bot churn", () => {
  const fingerprint = "a".repeat(64);
  const base = { controller: "codex", fingerprint, changed: true };
  assert.equal(
    publicationDecision({
      ...base,
      pulls: [
        { state: "OPEN", headRefName: "codex/catalog-update-codex-older" },
      ],
    }),
    "review-in-progress"
  );
  assert.equal(
    publicationDecision({
      ...base,
      pulls: [
        {
          state: "CLOSED",
          headRefName: `codex/catalog-update-codex-${fingerprint}`,
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

test("publication rejects a default change even when the catalog itself is valid", () => {
  const prepared = prepareUpdate(input);
  assert.doesNotThrow(() =>
    assertAdditionsOnly(catalog, prepared.catalog, prepared.evidence)
  );
  prepared.catalog.agentControllers.codex.defaultModelId = raw.models[0].slug;
  assert.throws(() =>
    assertAdditionsOnly(catalog, prepared.catalog, prepared.evidence)
  );
});
