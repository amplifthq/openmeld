#!/usr/bin/env node

// Shared mechanism for checking whether the production CLI download channel
// (R2-backed, served through the Web route documented in AGENTS.md) actually
// matches the release/local-components.json manifest a release is about to
// stamp/deploy. This module intentionally holds only mechanism (fetch the
// manifest, compare versions, probe binary URLs); each caller
// (verify-release-ready.mjs, release-cli.mjs) owns its own policy of what to
// do with the result and how to phrase the failure.
//
// Born from the 2026-07-10 half-release incident: commit 3bdbec9c9 stamped
// release/local-components.json and clients/openmeld-cli/package.json to
// 0.2.21 and Core was deployed, but the 0.2.21 CLI binary was never uploaded
// (upload-cli-binary.mjs only runs when the guarded CLI release selects
// --with-binary). Core compiles release/local-components.json in at build
// time (services/core/src/local-components/update-projection.ts), so it
// announced "update required 0.2.21" to every user while
// https://openmeld.ai/cli/manifest.json still served 0.2.20 and the 0.2.21
// binary URLs 404'd — an unbreakable update loop.

import {
  cliBinaryCompressedReleaseSchema,
  cliBinaryManifestSchema,
} from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";

import { compareSemverCore } from "./release-semver.mjs";
import {
  CLI_MANIFEST_OBJECT_KEY,
  DEFAULT_CLI_DOWNLOAD_BASE_URL,
} from "./upload-cli-binary.mjs";

// Derived from already-exported bucket/path constants rather than a new
// magic string, so this can never drift from what upload-cli-binary.mjs
// actually publishes to.
export const PRODUCTION_CLI_MANIFEST_URL = `${new URL(DEFAULT_CLI_DOWNLOAD_BASE_URL).origin}/${CLI_MANIFEST_OBJECT_KEY}`;

export const CHANNEL_SYNC_CHECK_ENV_VAR = "OPENMELD_RELEASE_CHANNEL_SYNC_CHECK";
export const SKIP_CHANNEL_SYNC_CHECK_ENV_VAR =
  "OPENMELD_SKIP_CHANNEL_SYNC_CHECK";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const TRUTHY_ENV_VALUES = new Set(["1", "true"]);

class CliChannelManifestValidationError extends Error {}

export function isEnvFlagEnabled(value) {
  return TRUTHY_ENV_VALUES.has(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

/**
 * release/local-components.json declares cli.packageVersion and
 * service.bundleVersion separately, but the CLI binary IS the OpenMeld
 * Service runtime — they must always be stamped together. A mismatch here is
 * a local, network-free error and is checked before any fetch.
 */
export function resolveCliServiceVersionConsistencyErrors(components) {
  const cliVersion = components?.cli?.packageVersion;
  const serviceVersion = components?.service?.bundleVersion;
  if (cliVersion === serviceVersion) {
    return [];
  }
  return [
    `release/local-components.json is internally inconsistent: cli.packageVersion (${String(cliVersion)}) must equal service.bundleVersion (${String(serviceVersion)}) because the CLI binary is the OpenMeld Service runtime.`,
  ];
}

export async function fetchCliChannelManifest(input = {}) {
  const url = input.url ?? PRODUCTION_CLI_MANIFEST_URL;
  const fetchImpl = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Unexpected status ${response.status}${response.statusText ? ` ${response.statusText}` : ""} fetching ${url}`
      );
    }
    const parsed = cliBinaryManifestSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new CliChannelManifestValidationError(parsed.error.message);
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveChannelVersionComparison(input) {
  const comparison = compareSemverCore(
    input.channelVersion,
    input.declaredVersion
  );
  const status = resolveComparisonStatus(comparison);
  return {
    channelVersion: input.channelVersion,
    declaredVersion: input.declaredVersion,
    status,
  };
}

function resolveComparisonStatus(comparison) {
  if (comparison < 0) {
    return "behind";
  }
  if (comparison > 0) {
    return "ahead";
  }
  return "match";
}

export async function probeChannelPlatformUrls(input = {}) {
  const fetchImpl = input.fetch ?? fetch;
  const platforms = input.platforms ?? {};
  const results = [];
  for (const [platform, meta] of Object.entries(platforms)) {
    results.push(
      await probeSinglePlatformUrl({
        artifactKind: "binary",
        fetchImpl,
        platform,
        url: meta.url,
      })
    );
    if (!cliBinaryCompressedReleaseSchema.safeParse(meta).success) {
      results.push({
        artifactKind: "archive",
        error: "the gzip archive manifest record is incomplete",
        ok: false,
        platform,
        status: null,
        url: typeof meta.archiveUrl === "string" ? meta.archiveUrl : null,
      });
      continue;
    }
    results.push(
      await probeSinglePlatformUrl({
        artifactKind: "archive",
        fetchImpl,
        platform,
        url: meta.archiveUrl,
      })
    );
    for (const delta of meta.deltas ?? []) {
      results.push(
        await probeSinglePlatformUrl({
          artifactKind: "delta",
          fetchImpl,
          platform,
          url: delta.patchUrl,
        })
      );
    }
  }
  return results;
}

async function probeSinglePlatformUrl(input) {
  try {
    const response = await input.fetchImpl(input.url, { method: "HEAD" });
    return {
      artifactKind: input.artifactKind,
      ok: response.ok,
      platform: input.platform,
      status: response.status,
      url: input.url,
    };
  } catch (error) {
    return {
      artifactKind: input.artifactKind,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      platform: input.platform,
      status: null,
      url: input.url,
    };
  }
}

/**
 * Full mechanism used by the verify-release-ready.mjs gate: local
 * consistency check, then fetch + compare + (when versions match) probe
 * every declared platform binary. Returns a discriminated `outcome` so
 * callers own their own error phrasing instead of parsing strings.
 */
export async function evaluateChannelSync(input) {
  const consistencyErrors = resolveCliServiceVersionConsistencyErrors(
    input.manifestComponents
  );
  const declaredVersion = input.manifestComponents?.cli?.packageVersion ?? null;

  let channelManifest;
  try {
    channelManifest = await fetchCliChannelManifest({
      fetch: input.fetch,
      timeoutMs: input.timeoutMs,
      url: input.url,
    });
  } catch (error) {
    return {
      consistencyErrors,
      outcome: {
        error: error instanceof Error ? error : new Error(String(error)),
        kind:
          error instanceof CliChannelManifestValidationError
            ? "malformed-manifest"
            : "fetch-failed",
      },
    };
  }

  const channelVersion = channelManifest?.channels?.stable?.version ?? null;
  if (!(channelVersion && declaredVersion)) {
    return {
      consistencyErrors,
      outcome: { kind: "malformed-manifest" },
    };
  }

  const comparison = resolveChannelVersionComparison({
    channelVersion,
    declaredVersion,
  });
  if (comparison.status !== "match") {
    return {
      consistencyErrors,
      outcome: { ...comparison, kind: comparison.status },
    };
  }

  const platformProbe = await probeChannelPlatformUrls({
    fetch: input.fetch,
    platforms: channelManifest.channels.stable.platforms ?? {},
  });
  return {
    consistencyErrors,
    outcome: { ...comparison, kind: "match", platformProbe },
  };
}
