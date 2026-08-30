import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { productionReleaseScopeSchema } from "../../packages/schemas/src/schemas/release/production-scope-lease.ts";
import { createProductionScopeLeaseGitEnvironment } from "./production-scope-lease.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const EVIDENCE_REF_PREFIX = "refs/heads/openmeld-production-release-evidence";
const EVIDENCE_KIND = "openmeld-guarded-local-release-evidence";
const LINE_SPLIT_PATTERN = /\r?\n/u;
const WHITESPACE_PATTERN = /\s+/u;

export function publishGuardedLocalReleaseEvidence(input) {
  const context = resolveContext(input);
  const sourceSha = requireExactSha("release source", input.sourceSha);
  runGit(context, ["cat-file", "-e", `${sourceSha}^{commit}`]);
  const scopes = [
    ...new Set(
      input.scopes.map((scope) => productionReleaseScopeSchema.parse(scope))
    ),
  ];
  if (scopes.length === 0) {
    throw new Error(
      "Guarded local release evidence requires at least one production scope."
    );
  }

  const currentEvidence = readGuardedLocalReleaseEvidence(context);
  const pending = [];
  for (const scope of scopes) {
    const current = currentEvidence.get(scope);
    if (current?.metadata.sourceSha === sourceSha) {
      continue;
    }
    const metadata = createEvidenceMetadata(context, scope, sourceSha);
    pending.push({
      evidenceSha: createEvidenceCommit(context, current, metadata),
      expectedSha: current?.evidenceSha ?? "",
      metadata,
      ref: evidenceRef(scope),
      scope,
    });
  }
  if (pending.length === 0) {
    return { published: false, scopes, sourceSha };
  }

  const args = ["push", "--no-verify", "--porcelain", "--atomic"];
  for (const item of pending) {
    args.push(`--force-with-lease=${item.ref}:${item.expectedSha}`);
  }
  args.push(
    context.remote,
    ...pending.map((item) => `${item.evidenceSha}:${item.ref}`)
  );
  const result = runGit(context, args, { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(
      `Could not publish guarded local release evidence atomically: ${redactGitOutput(result.stderr)}`
    );
  }
  return {
    published: true,
    scopes: pending.map((item) => item.scope),
    sourceSha,
  };
}

export function readGuardedLocalReleaseSources(input = {}) {
  const context = resolveContext(input);
  return new Map(
    [...readGuardedLocalReleaseEvidence(context)].map(([scope, evidence]) => [
      scope,
      {
        recordedAt: evidence.metadata.recordedAt,
        sha: evidence.metadata.sourceSha,
        source: "guarded-local",
        url: undefined,
      },
    ])
  );
}

function readGuardedLocalReleaseEvidence(context) {
  const result = runGit(
    context,
    ["ls-remote", "--refs", context.remote, `${EVIDENCE_REF_PREFIX}/*`],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read guarded local release evidence: ${redactGitOutput(result.stderr)}`
    );
  }
  const evidenceByScope = new Map();
  for (const line of result.stdout
    .trim()
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)) {
    const [shaValue, ref] = line.split(WHITESPACE_PATTERN);
    const prefix = `${EVIDENCE_REF_PREFIX}/`;
    if (!ref?.startsWith(prefix)) {
      continue;
    }
    const scope = productionReleaseScopeSchema.parse(ref.slice(prefix.length));
    const evidenceSha = requireExactSha(
      `${scope} guarded local release evidence`,
      shaValue
    );
    runGit(context, ["fetch", "--quiet", "--no-tags", context.remote, ref]);
    const message = runGit(context, [
      "show",
      "-s",
      "--format=%B",
      evidenceSha,
    ]).stdout.trim();
    const metadata = parseEvidenceMetadata({ evidenceSha, message, scope });
    runGit(context, ["cat-file", "-e", `${metadata.sourceSha}^{commit}`]);
    const evidenceTree = runGit(context, [
      "rev-parse",
      `${evidenceSha}^{tree}`,
    ]).stdout.trim();
    const sourceTree = runGit(context, [
      "rev-parse",
      `${metadata.sourceSha}^{tree}`,
    ]).stdout.trim();
    if (evidenceTree !== sourceTree) {
      throw new Error(
        `Guarded local release evidence ${evidenceSha} does not preserve the exact released source tree.`
      );
    }
    evidenceByScope.set(scope, {
      evidenceSha,
      metadata,
      ref,
    });
  }
  return evidenceByScope;
}

function resolveContext(input) {
  const context = {
    cwd: path.resolve(input.cwd ?? process.cwd()),
    environment: input.environment ?? process.env,
    now: input.now ? new Date(input.now) : new Date(),
    remote: input.remote ?? "origin",
  };
  if (Number.isNaN(context.now.getTime())) {
    throw new Error("Guarded local release evidence requires a valid time.");
  }
  return context;
}

function evidenceRef(scope) {
  return `${EVIDENCE_REF_PREFIX}/${scope}`;
}

function createEvidenceMetadata(context, scope, sourceSha) {
  return {
    evidenceId: randomUUID(),
    kind: EVIDENCE_KIND,
    recordedAt: context.now.toISOString(),
    schemaVersion: 1,
    scope,
    sourceSha,
  };
}

function createEvidenceCommit(context, current, metadata) {
  const parentSha = current?.evidenceSha ?? metadata.sourceSha;
  const result = spawnSync(
    "git",
    ["commit-tree", `${metadata.sourceSha}^{tree}`, "-p", parentSha],
    {
      cwd: context.cwd,
      encoding: "utf8",
      env: {
        ...createProductionScopeLeaseGitEnvironment(context.environment),
        GIT_AUTHOR_DATE: metadata.recordedAt,
        GIT_AUTHOR_EMAIL: "production-release-evidence@openmeld.local",
        GIT_AUTHOR_NAME: "OpenMeld Production Release Evidence",
        GIT_COMMITTER_DATE: metadata.recordedAt,
        GIT_COMMITTER_EMAIL: "production-release-evidence@openmeld.local",
        GIT_COMMITTER_NAME: "OpenMeld Production Release Evidence",
      },
      input: `${JSON.stringify(metadata)}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not create guarded local release evidence: ${redactGitOutput(result.error?.message ?? result.stderr)}`
    );
  }
  return requireExactSha("created release evidence", result.stdout.trim());
}

function parseEvidenceMetadata(input) {
  let metadata;
  try {
    metadata = JSON.parse(input.message);
  } catch {
    throw new Error(
      `Guarded local release evidence ${input.evidenceSha} has malformed metadata.`
    );
  }
  const recordedAt = new Date(metadata.recordedAt);
  if (
    metadata.kind !== EVIDENCE_KIND ||
    metadata.schemaVersion !== 1 ||
    metadata.scope !== input.scope ||
    !EXACT_SHA_PATTERN.test(String(metadata.sourceSha ?? "")) ||
    typeof metadata.evidenceId !== "string" ||
    metadata.evidenceId.length === 0 ||
    Number.isNaN(recordedAt.getTime())
  ) {
    throw new Error(
      `Guarded local release evidence ${input.evidenceSha} violates its metadata contract.`
    );
  }
  return metadata;
}

function runGit(context, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: context.cwd,
    encoding: "utf8",
    env: createProductionScopeLeaseGitEnvironment(context.environment, {
      authenticate: true,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outcome = {
    status: result.error ? 1 : (result.status ?? 1),
    stderr: [String(result.stderr ?? "").trim(), result.error?.message]
      .filter(Boolean)
      .join("\n"),
    stdout: String(result.stdout ?? ""),
  };
  if (!(options.allowFailure || outcome.status === 0)) {
    throw new Error(
      `git ${args.join(" ")} failed: ${redactGitOutput(outcome.stderr)}`
    );
  }
  return outcome;
}

function requireExactSha(label, value) {
  if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
    throw new Error(`${label} must be an exact 40-character lowercase SHA.`);
  }
  return value;
}

function redactGitOutput(value) {
  return String(value ?? "")
    .replaceAll(/(https?:\/\/)[^/@\s]+@/giu, "$1[REDACTED]@")
    .trim();
}
