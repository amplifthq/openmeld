import { cliBinaryCompressedReleaseSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";

import { compareSemverCore } from "./release-semver.mjs";

const NO_PENDING_D1_MIGRATIONS_PATTERN = /No migrations to apply[.!]?/iu;
const NPM_MISSING_VERSION_PATTERN =
  /\bE404\b|is not in this registry|No match found/iu;
const CANONICAL_CLI_RELEASE_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function decideD1MigrationStage(input) {
  if (input.status !== 0) {
    return probeFailureDecision(
      "D1 completion probe",
      readCommandFailure(input)
    );
  }
  if (
    input.stdout.trim().length === 0 ||
    NO_PENDING_D1_MIGRATIONS_PATTERN.test(input.stdout)
  ) {
    return {
      action: "SKIP",
      criterion: "remote-pending-list-empty",
      reason: "the remote D1 pending migration list is empty",
    };
  }
  return {
    action: "RUN",
    reason: "the remote D1 pending migration list is not empty",
  };
}

export function decideCliBinaryStage(input) {
  if (input.probeError) {
    return {
      action: "FAIL",
      probeFailure: true,
      reason: `CLI binary completion probe could not prove whether ${input.targetVersion} is already published: ${String(input.probeError).trim() || "unknown failure"}; refusing to rerun immutable binary publication without conclusive evidence`,
    };
  }
  const stable = input.manifest?.channels?.stable;
  if (!stable) {
    return {
      action: "RUN",
      reason: "the production CLI manifest is missing channels.stable",
    };
  }
  const versionDecision = decideCliBinaryManifestVersionStage(input, stable);
  if (versionDecision) {
    return versionDecision;
  }
  if (
    input.targetMinRequiredCliVersion &&
    stable.minRequiredCliVersion !== input.targetMinRequiredCliVersion
  ) {
    return {
      action: "FAIL",
      reason: `the production CLI manifest for ${input.targetVersion} is immutable with required floor ${String(stable.minRequiredCliVersion ?? "missing")}, not target ${input.targetMinRequiredCliVersion}; publish a new release instead of retrying this version`,
    };
  }
  const artifact = stable.platforms?.[input.platform];
  if (!cliBinaryCompressedReleaseSchema.safeParse(artifact).success) {
    return immutableCliBinaryArtifactFailure(
      input,
      "the manifest record is incomplete"
    );
  }
  if (!input.artifactProbe?.ok) {
    return immutableCliBinaryArtifactFailure(
      input,
      `the raw artifact is not downloadable (HTTP ${String(input.artifactProbe?.status ?? "unknown")})`
    );
  }
  if (input.artifactProbe.contentLength !== artifact.sizeBytes) {
    return immutableCliBinaryArtifactFailure(
      input,
      `the raw artifact size does not match the manifest record (${String(input.artifactProbe.contentLength ?? "missing")} != ${String(artifact.sizeBytes)})`
    );
  }
  if (!input.archiveProbe?.ok) {
    return immutableCliBinaryArtifactFailure(
      input,
      `the gzip archive is not downloadable (HTTP ${String(input.archiveProbe?.status ?? "unknown")})`
    );
  }
  if (input.archiveProbe.contentLength !== artifact.archiveSizeBytes) {
    return immutableCliBinaryArtifactFailure(
      input,
      `the gzip archive size does not match the manifest record (${String(input.archiveProbe.contentLength ?? "missing")} != ${String(artifact.archiveSizeBytes)})`
    );
  }
  if (input.archiveProbe.sha256 !== artifact.archiveSha256) {
    return immutableCliBinaryArtifactFailure(
      input,
      "the gzip archive sha256 does not match the manifest record"
    );
  }
  if (
    input.archiveProbe.reconstructedSizeBytes !== artifact.sizeBytes ||
    input.archiveProbe.reconstructedSha256 !== artifact.sha256
  ) {
    return immutableCliBinaryArtifactFailure(
      input,
      "the gzip archive does not reconstruct the recorded binary"
    );
  }
  return {
    action: "SKIP",
    criterion: "verified-published-record",
    reason: `the production manifest has ${input.targetVersion} with required floor ${input.targetMinRequiredCliVersion}, the ${input.platform} raw URL matches its recorded size, and the gzip archive hashes and reconstructs the recorded binary`,
  };
}

function decideCliBinaryManifestVersionStage(input, stable) {
  const versionRelation = classifyCliBinaryManifestVersion({
    stableVersion: stable.version,
    targetVersion: input.targetVersion,
  });
  if (versionRelation === "behind") {
    return {
      action: "RUN",
      reason: `the production CLI manifest is at ${stable.version}, below target ${input.targetVersion}`,
    };
  }
  if (versionRelation === "ahead") {
    return {
      action: "FAIL",
      reason: `the production CLI manifest is already at ${stable.version}, ahead of target ${input.targetVersion}; refusing to publish an older CLI or move the stable channel backward`,
    };
  }
  if (versionRelation === "unsafe") {
    return {
      action: "FAIL",
      reason: `the production CLI manifest version ${stable.version} cannot be safely compared with target ${input.targetVersion}; exact canonical x.y.z identity is required before probing immutable target artifacts`,
    };
  }
  return null;
}

export function classifyCliBinaryManifestVersion(input) {
  if (
    !(
      CANONICAL_CLI_RELEASE_VERSION_PATTERN.test(input.stableVersion) &&
      CANONICAL_CLI_RELEASE_VERSION_PATTERN.test(input.targetVersion)
    )
  ) {
    return "unsafe";
  }
  if (input.stableVersion === input.targetVersion) {
    return "exact";
  }
  const comparison = compareSemverCore(
    input.stableVersion,
    input.targetVersion
  );
  if (comparison < 0) {
    return "behind";
  }
  if (comparison > 0) {
    return "ahead";
  }
  return "unsafe";
}

function immutableCliBinaryArtifactFailure(input, detail) {
  return {
    action: "FAIL",
    reason: `the production CLI manifest already publishes ${input.targetVersion}, so its ${input.platform} artifacts are immutable; ${detail}; investigate the published record or publish a new version instead of retrying this version`,
  };
}

export function decideNpmPublishStage(input) {
  if (input.status !== 0) {
    const detail = readCommandFailure(input);
    if (NPM_MISSING_VERSION_PATTERN.test(detail)) {
      return {
        action: "RUN",
        criterion: "npm-target-version-missing",
        reason: `npm does not publish openmeld@${input.targetVersion}`,
      };
    }
    return probeFailureDecision("npm completion probe", detail);
  }
  const published = parseNpmPackageProjection(input.stdout);
  const publishedVersion = published.version;
  if (publishedVersion === input.targetVersion) {
    if (
      input.targetMinRequiredCliVersion &&
      published.minRequiredCliVersion !== input.targetMinRequiredCliVersion
    ) {
      return {
        action: "FAIL",
        reason: `npm openmeld@${input.targetVersion} is immutable with required floor ${String(published.minRequiredCliVersion ?? "missing")}, not target ${input.targetMinRequiredCliVersion}; publish a new release instead of retrying this version`,
      };
    }
    return {
      action: "SKIP",
      criterion: "npm-version-and-floor-exist",
      reason: `npm already publishes openmeld@${input.targetVersion} with required floor ${input.targetMinRequiredCliVersion}`,
    };
  }
  return probeFailureDecision(
    "npm completion probe",
    `npm returned an unexpected version projection for openmeld@${input.targetVersion}`
  );
}

export function decideReleaseTagStage(input) {
  if (input.localProbeError) {
    return probeFailureDecision(
      "Local release tag completion probe",
      input.localProbeError
    );
  }
  if (input.localTagSha && input.localTagSha !== input.headSha) {
    return {
      action: "FAIL",
      reason: `local ${input.tagName} already points to ${input.localTagSha}, not ${input.headSha}; refusing to overwrite an immutable release tag`,
    };
  }
  if (input.remoteProbeError) {
    return probeFailureDecision(
      "Origin release tag completion probe",
      input.remoteProbeError
    );
  }
  if (input.remoteTagSha && input.remoteTagSha !== input.headSha) {
    return {
      action: "FAIL",
      reason: `origin ${input.tagName} already points to ${input.remoteTagSha}, not ${input.headSha}; refusing to overwrite an immutable release tag`,
    };
  }
  if (
    input.localTagSha === input.headSha &&
    input.remoteTagSha === input.headSha
  ) {
    return {
      action: "SKIP",
      criterion: "local-and-origin-tag-target-match",
      reason: `${input.tagName} already points to ${input.headSha} locally and on origin`,
    };
  }
  if (!(input.localTagSha || input.remoteTagSha)) {
    return {
      action: "RUN",
      reason: `${input.tagName} does not exist locally or on origin`,
    };
  }
  if (!input.localTagSha) {
    return {
      action: "RUN",
      reason: `${input.tagName} does not exist locally`,
    };
  }
  return {
    action: "RUN",
    reason: `${input.tagName} is not published to origin`,
  };
}

export function decideCoreProjectionStage(input) {
  if (input.probeError) {
    return probeFailureDecision(
      "Core projection completion probe",
      input.probeError
    );
  }
  if (!(Array.isArray(input.deployments) && Array.isArray(input.versions))) {
    return probeFailureDecision(
      "Core projection completion probe",
      "Wrangler returned an invalid deployments or versions payload"
    );
  }
  const currentDeployment = input.deployments
    .toSorted((left, right) =>
      String(left?.created_on ?? "").localeCompare(
        String(right?.created_on ?? "")
      )
    )
    .at(-1);
  const currentTraffic = Array.isArray(currentDeployment?.versions)
    ? currentDeployment.versions
    : [];
  const currentVersionIds = currentTraffic
    .map((entry) => entry?.version_id)
    .filter((value) => typeof value === "string" && value.length > 0);
  const versionsById = new Map(
    input.versions
      .filter((version) => typeof version?.id === "string")
      .map((version) => [version.id, version])
  );
  const matchingTraffic = currentTraffic.find((entry) => {
    if (entry?.percentage !== 100) {
      return false;
    }
    const version = versionsById.get(entry.version_id);
    return version?.annotations?.["workers/tag"] === input.targetTag;
  });
  if (matchingTraffic) {
    return {
      action: "SKIP",
      criterion: "active-worker-version-tag",
      currentVersionIds,
      reason: `Core production version ${matchingTraffic.version_id} already carries ${input.targetTag}`,
    };
  }
  return {
    action: "RUN",
    currentVersionIds,
    reason: `the active Core deployment does not carry target tag ${input.targetTag}`,
  };
}

export function decideChannelAlignmentStage(input) {
  const failure = [input.binary, input.npm, input.core].find(
    (decision) => decision?.action === "FAIL"
  );
  if (failure) {
    return failure;
  }
  const incomplete = [
    ["R2", input.binary],
    ["npm", input.npm],
    ["Core", input.core],
  ].filter(([, decision]) => decision?.action !== "SKIP");
  if (incomplete.length === 0) {
    return {
      action: "SKIP",
      criterion: "r2-npm-core-aligned",
      reason:
        "R2, npm, and the active Core projection already match the target release",
    };
  }
  return {
    action: "RUN",
    reason: `final channel alignment is incomplete: ${incomplete
      .map(([name]) => name)
      .join(", ")}`,
  };
}

export function readCurrentWorkerVersionIds(deployments) {
  if (!Array.isArray(deployments)) {
    throw new Error("Wrangler returned an invalid deployments payload");
  }
  const currentDeployment = deployments
    .toSorted((left, right) =>
      String(left?.created_on ?? "").localeCompare(
        String(right?.created_on ?? "")
      )
    )
    .at(-1);
  if (!currentDeployment) {
    return [];
  }
  if (!Array.isArray(currentDeployment.versions)) {
    throw new Error("Wrangler deployment is missing versions");
  }
  return currentDeployment.versions
    .map((entry) => ({
      percentage: entry?.percentage,
      versionId: entry?.version_id,
    }))
    .filter(
      (entry) =>
        typeof entry.versionId === "string" && entry.versionId.length > 0
    );
}

function parseNpmPackageProjection(stdout) {
  const normalized = String(stdout ?? "").trim();
  if (!normalized) {
    return { minRequiredCliVersion: null, version: null };
  }
  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed === "string") {
      return { minRequiredCliVersion: null, version: parsed.trim() };
    }
    if (parsed && typeof parsed === "object") {
      const version =
        typeof parsed.version === "string" ? parsed.version.trim() : null;
      const minRequiredCliVersion =
        typeof parsed["openmeld.minRequiredCliVersion"] === "string"
          ? parsed["openmeld.minRequiredCliVersion"].trim()
          : null;
      return { minRequiredCliVersion, version };
    }
    return { minRequiredCliVersion: null, version: null };
  } catch {
    return { minRequiredCliVersion: null, version: normalized };
  }
}

function probeFailureDecision(label, detail) {
  return {
    action: "RUN",
    probeFailure: true,
    reason: `${label} failed: ${String(detail).trim() || "unknown failure"}`,
  };
}

function readCommandFailure(input) {
  return (
    String(input.stderr ?? "").trim() ||
    String(input.stdout ?? "").trim() ||
    `exit ${String(input.status)}`
  );
}
