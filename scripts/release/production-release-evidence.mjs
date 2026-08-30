import { spawnSync } from "node:child_process";
import path from "node:path";

import { productionReleaseScopeSchema } from "../../packages/schemas/src/schemas/release/production-scope-lease.ts";
import { createProductionScopeLeaseGitEnvironment } from "./production-scope-lease.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const EVIDENCE_REF_PREFIX = "refs/heads/openmeld-production-release-evidence";
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

  const currentSources = readGuardedLocalReleaseSources(context);
  const pendingScopes = [];
  for (const scope of scopes) {
    const current = currentSources.get(scope);
    if (current?.sha === sourceSha) {
      continue;
    }
    if (current && !isAncestor(context, current.sha, sourceSha)) {
      throw new Error(
        `Guarded local release evidence for ${scope} points to ${current.sha}; refusing to move it backward or across history to ${sourceSha}.`
      );
    }
    pendingScopes.push(scope);
  }
  if (pendingScopes.length === 0) {
    return { published: false, scopes, sourceSha };
  }

  const args = ["push", "--no-verify", "--porcelain", "--atomic"];
  for (const scope of pendingScopes) {
    const ref = evidenceRef(scope);
    const expected = currentSources.get(scope)?.sha ?? "";
    args.push(`--force-with-lease=${ref}:${expected}`);
  }
  args.push(
    context.remote,
    ...pendingScopes.map((scope) => `${sourceSha}:${evidenceRef(scope)}`)
  );
  const result = runGit(context, args, { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(
      `Could not publish guarded local release evidence atomically: ${redactGitOutput(result.stderr)}`
    );
  }
  return { published: true, scopes: pendingScopes, sourceSha };
}

export function readGuardedLocalReleaseSources(input = {}) {
  const context = resolveContext(input);
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
  const sources = new Map();
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
    sources.set(scope, {
      sha: requireExactSha(`${scope} guarded local release`, shaValue),
      source: "guarded-local",
      url: undefined,
    });
  }
  return sources;
}

function resolveContext(input) {
  return {
    cwd: path.resolve(input.cwd ?? process.cwd()),
    environment: input.environment ?? process.env,
    remote: input.remote ?? "origin",
  };
}

function evidenceRef(scope) {
  return `${EVIDENCE_REF_PREFIX}/${scope}`;
}

function isAncestor(context, ancestor, descendant) {
  const result = runGit(
    context,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { allowFailure: true }
  );
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(
    `Could not compare guarded local release evidence ${ancestor} with ${descendant}: ${redactGitOutput(result.stderr)}`
  );
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
