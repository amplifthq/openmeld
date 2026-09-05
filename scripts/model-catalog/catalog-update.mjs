import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  modelCatalogSchema,
  modelCatalogUpdateEvidenceSchema,
} from "../../packages/schemas/src/schemas/config/model-catalog.ts";
import { renderBatchReview } from "./review.mjs";

export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const HTML_PATTERN = /<!doctype html|<html[\s>]/i;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

function validateRelease(release, url) {
  if (
    !release.tag_name ||
    release.prerelease ||
    release.draft ||
    !release.html_url
  ) {
    throw new Error(`Invalid stable release: ${url}`);
  }
}

async function get(url, json = true) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      "User-Agent": "OpenMeld-catalog-update",
      Accept: json ? "application/json" : "*/*",
      ...(new URL(url).origin === "https://api.github.com" &&
      process.env.GH_TOKEN
        ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
        : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}: ${url}`);
  }
  const text = await response.text();
  if (text.length > 30_000_000) {
    throw new Error(`Source exceeded size limit: ${url}`);
  }
  if (!json && HTML_PATTERN.test(text)) {
    throw new Error(`Expected Markdown, received HTML: ${url}`);
  }
  return json ? JSON.parse(text) : text;
}

export function parseCodexModels(payload) {
  if (!(Array.isArray(payload.models) && payload.models.length)) {
    throw new Error("Codex catalog has no model inventory");
  }
  const seen = new Set();
  return payload.models.map((model) => {
    if (
      typeof model.slug !== "string" ||
      seen.has(model.slug) ||
      !Array.isArray(model.supported_reasoning_levels)
    ) {
      throw new Error("Malformed or duplicate Codex model");
    }
    seen.add(model.slug);
    // Preserve capability evidence, never harness prompt bodies or execution instructions.
    const { base_instructions, model_messages, ...facts } = model;
    return {
      facts,
      entry: {
        id: model.slug,
        displayName: model.display_name,
        unavailable: false,
        supportedReasoningLevels: model.supported_reasoning_levels.map(
          (level) => level.effort
        ),
        minCliVersion: model.minimal_client_version ?? null,
      },
    };
  });
}

export async function collectSources(
  config,
  controller,
  catalog,
  fetchSource = get
) {
  const sources = [];
  let codexModels = [];
  if (config.releaseRepository) {
    const url = `https://api.github.com/repos/${config.releaseRepository}/releases/latest`;
    const release = await fetchSource(url);
    validateRelease(release, url);
    sources.push({
      url: release.html_url,
      kind: "official-release",
      data: {
        tag: release.tag_name,
        publishedAt: release.published_at,
        notes: release.body ?? "",
      },
    });
    if (config.catalogPath) {
      const commit = await fetchSource(
        `https://api.github.com/repos/${config.releaseRepository}/commits/${encodeURIComponent(release.tag_name)}`
      );
      if (!COMMIT_PATTERN.test(commit.sha)) {
        throw new Error("Missing exact source commit");
      }
      const catalogUrl = `https://raw.githubusercontent.com/${config.releaseRepository}/${commit.sha}/${config.catalogPath}`;
      codexModels = parseCodexModels(await fetchSource(catalogUrl));
      sources.push({
        url: catalogUrl,
        kind: "official-harness-catalog",
        data: {
          commit: commit.sha,
          models: codexModels.map((model) => model.facts),
        },
      });
    }
  }
  for (const url of config.documents) {
    const document = await fetchSource(url, false);
    if (!document.trim() || document.length > 250_000) {
      throw new Error(`Invalid document: ${url}`);
    }
    sources.push({ url, kind: "official-document", data: document.trim() });
  }
  if (config.providers.length) {
    const url = "https://models.dev/api.json";
    const database = await fetchSource(url);
    const providers = {};
    for (const id of config.providers) {
      const provider = database[id];
      if (!(provider?.models && Object.keys(provider.models).length)) {
        throw new Error(`Missing models.dev provider: ${id}`);
      }
      // First observation excludes historical models that were never curated. Later
      // observations include the same scope, so parameter changes remain visible.
      providers[id] = Object.fromEntries(
        Object.entries(provider.models)
          .filter(
            ([modelId, model]) =>
              catalog.agentControllers[controller].models.some(
                (entry) =>
                  entry.id === modelId ||
                  entry.id === `${id}/${modelId}` ||
                  entry.id.startsWith(`${modelId}[`)
              ) ||
              codexModels.some((candidate) => candidate.entry.id === modelId) ||
              model.release_date >= config.discoverySince
          )
          .sort(([a], [b]) => a.localeCompare(b))
      );
    }
    sources.push({ url, kind: "discovery-only", data: providers });
  }
  return { sources, codexModels };
}

function describeParameterChanges(existing, entry) {
  const differences = [];
  if (
    digest(existing.supportedReasoningLevels) !==
    digest(entry.supportedReasoningLevels)
  ) {
    differences.push(
      `reasoning ${JSON.stringify(existing.supportedReasoningLevels)} → ${JSON.stringify(entry.supportedReasoningLevels)}`
    );
  }
  if (existing.minCliVersion !== entry.minCliVersion) {
    differences.push(
      `minimum version ${existing.minCliVersion ?? "unknown"} → ${entry.minCliVersion ?? "unknown"}`
    );
  }
  return differences.join("; ");
}

function proposeCodexAdditions(target, codexModels, sources, discoverySince) {
  const changes = [];
  const manual = [];
  for (const { entry, facts } of codexModels) {
    const existing = target.models.find((model) => model.id === entry.id);
    if (facts.visibility !== "list") {
      if (existing) {
        manual.push(
          `${entry.id}: upstream visibility is ${facts.visibility}; no retirement or availability change was applied.`
        );
      }
      continue;
    }
    if (!existing) {
      const discovered = sources.find(
        (source) => source.kind === "discovery-only"
      )?.data?.openai?.[entry.id];
      if (discoverySince && discovered?.release_date < discoverySince) {
        manual.push(
          `${entry.id}: discovery source dates this model to ${discovered.release_date}, before monitoring began (${discoverySince}); historical backfill was not applied automatically.`
        );
        continue;
      }
      target.models.push(entry);
      changes.push({ modelId: entry.id, before: null, after: entry });
    } else if (
      digest(existing.supportedReasoningLevels) !==
        digest(entry.supportedReasoningLevels) ||
      existing.minCliVersion !== entry.minCliVersion
    ) {
      manual.push(
        `${entry.id}: ${describeParameterChanges(existing, entry)}. Review before changing existing selections or compatibility policy.`
      );
    }
  }
  return { changes, manual };
}

export function prepareUpdate({
  catalog,
  controller,
  sources,
  codexModels = [],
  observedAt,
  previous,
  discoverySince,
}) {
  const updated = structuredClone(catalog);
  const target = updated.agentControllers[controller];
  if (!target || target.hostedRuntimePolicy) {
    throw new Error(`Unsupported local controller: ${controller}`);
  }
  const { changes, manual } = proposeCodexAdditions(
    target,
    codexModels,
    sources,
    discoverySince
  );
  if (!codexModels.length) {
    manual.push(
      "Discovery evidence only: exact authenticated harness IDs and parameter options still require verification; no API-to-harness mapping was guessed."
    );
  }
  const fingerprint = digest(sources.map(({ kind, data }) => ({ kind, data })));
  const evidence = modelCatalogUpdateEvidenceSchema.parse({
    schemaVersion: 1,
    controller,
    observedAt,
    fingerprint,
    sources,
    changes,
    manual,
  });
  const sourceChanged = previous?.fingerprint !== fingerprint;
  if (changes.length) {
    updated.updatedAt = observedAt;
  }
  modelCatalogSchema.parse(updated);
  return {
    catalog: updated,
    evidence,
    changed: sourceChanged || changes.length > 0,
  };
}

export async function runUpdate({ root = process.cwd(), controller, output }) {
  const config = JSON.parse(
    await readFile(resolve(root, "scripts/model-catalog/sources.json"), "utf8")
  )[controller];
  if (!config) {
    throw new Error(`Unknown controller: ${controller}`);
  }
  const catalog = modelCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(root, "release/vendor-models.json"), "utf8")
    )
  );
  let previous;
  try {
    previous = modelCatalogUpdateEvidenceSchema.parse(
      JSON.parse(
        await readFile(
          resolve(root, `release/model-catalog-evidence/${controller}.json`),
          "utf8"
        )
      )
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const collected = await collectSources(config, controller, catalog);
  const result = prepareUpdate({
    catalog,
    controller,
    ...collected,
    observedAt: new Date().toISOString(),
    previous,
    discoverySince: config.discoverySince,
  });
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "catalog.json"),
    `${JSON.stringify(result.catalog, null, 2)}\n`
  );
  await writeFile(
    resolve(output, "evidence.json"),
    `${JSON.stringify(result.evidence, null, 2)}\n`
  );
  await writeFile(
    resolve(output, "review.md"),
    renderBatchReview([result.evidence], { [controller]: config }, catalog)
  );
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify({
      changed: result.changed,
      fingerprint: result.evidence.fingerprint,
      controller,
    })
  );
  console.log(
    JSON.stringify({
      controller,
      changed: result.changed,
      additions: result.evidence.changes.map((change) => change.modelId),
      output,
    })
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = process.argv[2];
  const output = resolve(
    process.argv[3] ?? `dev-tmp/model-catalog/${controller}`
  );
  await runUpdate({ controller, output });
}
