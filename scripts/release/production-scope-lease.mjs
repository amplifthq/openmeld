#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import os from "node:os";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  productionReleaseScopeSchema,
  productionScopeLeaseRecoverySchema,
  productionScopeLeaseSchema,
} from "../../packages/schemas/src/schemas/release/production-scope-lease.ts";

const DEFAULT_TTL_SECONDS = 4 * 60 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const WHITESPACE_PATTERN = /\s+/u;

export function acquireProductionScopeLease(input) {
  const context = resolveContext(input);
  const existing = readProductionScopeLease(context);
  if (existing) {
    throw new Error(renderHeldLease(existing, context.now));
  }

  const metadata = createLeaseMetadata(context);
  const leaseSha = createLeaseCommit(context, metadata);
  printAcquirePlan(context, metadata, leaseSha);
  const push = runGit(
    context,
    [
      "push",
      "--porcelain",
      `--force-with-lease=${context.ref}:`,
      context.remote,
      `${leaseSha}:${context.ref}`,
    ],
    { allowFailure: true }
  );
  if (push.status !== 0) {
    const winner = readProductionScopeLease(context);
    throw new Error(
      [
        "Production scope lease acquisition lost an atomic race.",
        winner
          ? renderHeldLease(winner, context.now)
          : redactGitOutput(push.stderr),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  const acquired = { leaseSha, metadata, ref: context.ref };
  process.stdout.write(renderLease("ACQUIRED", acquired));
  if (input.githubOutput) {
    appendFileSync(input.githubOutput, `lease_sha=${leaseSha}\n`, "utf8");
  }
  return acquired;
}

export function inspectProductionScopeLease(input) {
  const context = resolveContext(input, {
    requireOwner: false,
    requireSource: false,
  });
  return readProductionScopeLease(context);
}

export function inspectProductionScopeLeaseRecovery(input) {
  const context = resolveContext(input, {
    requireOwner: false,
    requireSource: false,
  });
  const leaseSha = requireExactSha("recovered lease", input.leaseSha);
  return readProductionScopeLeaseRecovery(context, leaseSha);
}

export function releaseProductionScopeLease(input) {
  const context = resolveContext(input, {
    requireOwner: false,
    requireSource: false,
  });
  const leaseSha = requireExactSha("lease", input.leaseSha);
  const current = readProductionScopeLease(context);
  if (!current) {
    process.stdout.write(
      `Production scope lease already absent.\nScope: ${context.scope}\nRef: ${context.ref}\n`
    );
    return { released: false };
  }
  if (current.leaseSha !== leaseSha) {
    throw new Error(
      [
        `Refusing to release stale lease ${leaseSha}.`,
        renderHeldLease(current, context.now),
      ].join("\n")
    );
  }
  const push = runGit(
    context,
    [
      "push",
      "--porcelain",
      `--force-with-lease=${context.ref}:${leaseSha}`,
      context.remote,
      `:${context.ref}`,
    ],
    { allowFailure: true }
  );
  if (push.status !== 0) {
    const winner = readProductionScopeLease(context);
    throw new Error(
      [
        "Production scope lease changed before atomic release; no newer lease was deleted.",
        winner
          ? renderHeldLease(winner, context.now)
          : redactGitOutput(push.stderr),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  process.stdout.write(renderLease("RELEASED", current));
  return { released: true };
}

export function recoverExpiredProductionScopeLease(input) {
  const context = resolveContext(input, {
    requireOwner: true,
    requireSource: false,
  });
  const expectedLeaseSha = requireExactSha("expected lease", input.leaseSha);
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 10 || reason.length > 2000) {
    throw new Error(
      "Expired lease recovery requires --reason with 10 to 2000 characters."
    );
  }
  const current = readProductionScopeLease(context);
  if (!current) {
    throw new Error("No production scope lease exists to recover.");
  }
  if (current.leaseSha !== expectedLeaseSha) {
    throw new Error(
      [
        `Recovery expected lease ${expectedLeaseSha}, but the shared ref changed.`,
        renderHeldLease(current, context.now),
      ].join("\n")
    );
  }
  if (Date.parse(current.metadata.expiresAt) > context.now.getTime()) {
    throw new Error(
      `Production scope lease is still active until ${current.metadata.expiresAt}; recovery is fail-closed.`
    );
  }
  const recovery = createRecoveryMetadata(context, current, reason);
  const recoverySha = createRecoveryCommit(context, current, recovery);
  const recoveryRef = recoveryRefFor(context.scope, expectedLeaseSha);
  const push = runGit(
    context,
    [
      "push",
      "--porcelain",
      "--atomic",
      `--force-with-lease=${context.ref}:${expectedLeaseSha}`,
      `--force-with-lease=${recoveryRef}:`,
      context.remote,
      `:${context.ref}`,
      `${recoverySha}:${recoveryRef}`,
    ],
    { allowFailure: true }
  );
  if (push.status !== 0) {
    throw new Error(
      "Expired lease changed during atomic recovery; no newer lease was deleted."
    );
  }
  process.stdout.write(
    [
      "Production scope lease RECOVERED",
      `Scope: ${context.scope}`,
      `Recovered lease: ${expectedLeaseSha}`,
      `Previous owner: ${current.metadata.owner}`,
      `Previous source: ${current.metadata.sourceSha}`,
      `Previous start: ${current.metadata.startedAt}`,
      `Previous expiry: ${current.metadata.expiresAt}`,
      `Recovery reason: ${reason}`,
      `Recovered by: ${recovery.recoveredBy}`,
      `Recovery SHA: ${recoverySha}`,
      `Recovery ref: ${recoveryRef}`,
      "Next: rerun the guarded production release so it atomically acquires a fresh lease.",
      "",
    ].join("\n")
  );
  return { reason, recovered: current, recovery, recoveryRef, recoverySha };
}

function resolveContext(input, requirements = {}) {
  const scope = productionReleaseScopeSchema.parse(input.scope);
  const requireOwner = requirements.requireOwner ?? true;
  const requireSource = requirements.requireSource ?? true;
  const owner = requireOwner
    ? String(
        input.owner ?? `local:${os.hostname()}:${String(process.pid)}`
      ).trim()
    : null;
  if (requireOwner && (!owner || owner.length > 1024)) {
    throw new Error(
      "Production scope lease owner must be 1 to 1024 characters."
    );
  }
  const sourceSha = requireSource
    ? requireExactSha("source", input.sourceSha)
    : null;
  const ttlSeconds = Number(input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  if (
    !(
      Number.isInteger(ttlSeconds) &&
      ttlSeconds >= MIN_TTL_SECONDS &&
      ttlSeconds <= MAX_TTL_SECONDS
    )
  ) {
    throw new Error(
      `Production scope lease TTL must be ${String(MIN_TTL_SECONDS)} to ${String(MAX_TTL_SECONDS)} seconds.`
    );
  }
  const context = {
    cwd: input.cwd ?? process.cwd(),
    now: input.now ? new Date(input.now) : new Date(),
    owner,
    ref: `refs/heads/openmeld-production-leases/${scope}`,
    remote: input.remote ?? "origin",
    scope,
    sourceSha,
    ttlSeconds,
  };
  if (Number.isNaN(context.now.getTime())) {
    throw new Error("Production scope lease requires a valid current time.");
  }
  if (sourceSha) {
    runGit(context, ["cat-file", "-e", `${sourceSha}^{commit}`]);
  }
  return context;
}

function createLeaseMetadata(context) {
  const startedAt = context.now.toISOString();
  return productionScopeLeaseSchema.parse({
    expiresAt: new Date(
      context.now.getTime() + context.ttlSeconds * 1000
    ).toISOString(),
    kind: "openmeld-production-scope-lease",
    leaseId: randomUUID(),
    owner: context.owner,
    schemaVersion: 1,
    scope: context.scope,
    sourceSha: context.sourceSha,
    startedAt,
  });
}

function createRecoveryMetadata(context, current, reason) {
  return productionScopeLeaseRecoverySchema.parse({
    kind: "openmeld-production-scope-lease-recovery",
    reason,
    recoveredAt: context.now.toISOString(),
    recoveredBy: context.owner,
    recoveredLease: current.metadata,
    recoveredLeaseSha: current.leaseSha,
    recoveryId: randomUUID(),
    schemaVersion: 1,
  });
}

function createLeaseCommit(context, metadata) {
  const result = spawnSync(
    "git",
    ["commit-tree", `${context.sourceSha}^{tree}`, "-p", context.sourceSha],
    {
      cwd: context.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: metadata.startedAt,
        GIT_AUTHOR_EMAIL: "production-lease@openmeld.local",
        GIT_AUTHOR_NAME: "OpenMeld Production Lease",
        GIT_COMMITTER_DATE: metadata.startedAt,
        GIT_COMMITTER_EMAIL: "production-lease@openmeld.local",
        GIT_COMMITTER_NAME: "OpenMeld Production Lease",
      },
      input: `${JSON.stringify(metadata)}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not create production scope lease commit: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return requireExactSha("created lease", result.stdout.trim());
}

function createRecoveryCommit(context, current, metadata) {
  const result = spawnSync(
    "git",
    [
      "commit-tree",
      `${current.metadata.sourceSha}^{tree}`,
      "-p",
      current.leaseSha,
    ],
    {
      cwd: context.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: metadata.recoveredAt,
        GIT_AUTHOR_EMAIL: "production-lease@openmeld.local",
        GIT_AUTHOR_NAME: "OpenMeld Production Lease Recovery",
        GIT_COMMITTER_DATE: metadata.recoveredAt,
        GIT_COMMITTER_EMAIL: "production-lease@openmeld.local",
        GIT_COMMITTER_NAME: "OpenMeld Production Lease Recovery",
      },
      input: `${JSON.stringify(metadata)}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not create production scope lease recovery commit: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return requireExactSha("created recovery", result.stdout.trim());
}

function readProductionScopeLease(context) {
  const result = runGit(
    context,
    ["ls-remote", "--refs", context.remote, context.ref],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read shared production scope lease: ${redactGitOutput(result.stderr)}`
    );
  }
  const line = result.stdout.trim();
  if (!line) {
    return null;
  }
  const leaseSha = requireExactSha(
    "remote lease",
    line.split(WHITESPACE_PATTERN)[0]
  );
  runGit(context, [
    "fetch",
    "--quiet",
    "--no-tags",
    context.remote,
    context.ref,
  ]);
  const message = runGit(context, [
    "show",
    "-s",
    "--format=%B",
    leaseSha,
  ]).stdout.trim();
  let decoded;
  try {
    decoded = JSON.parse(message);
  } catch {
    throw new Error(
      `Shared production scope lease ${leaseSha} has malformed metadata; fail closed and inspect ${context.ref}.`
    );
  }
  const parsed = productionScopeLeaseSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.scope !== context.scope) {
    throw new Error(
      `Shared production scope lease ${leaseSha} violates the canonical metadata contract; fail closed and inspect ${context.ref}.`
    );
  }
  return { leaseSha, metadata: parsed.data, ref: context.ref };
}

function readProductionScopeLeaseRecovery(context, leaseSha) {
  const recoveryRef = recoveryRefFor(context.scope, leaseSha);
  const result = runGit(
    context,
    ["ls-remote", "--refs", context.remote, recoveryRef],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read shared production scope lease recovery: ${redactGitOutput(result.stderr)}`
    );
  }
  const line = result.stdout.trim();
  if (!line) {
    return null;
  }
  const recoverySha = requireExactSha(
    "remote recovery",
    line.split(WHITESPACE_PATTERN)[0]
  );
  runGit(context, [
    "fetch",
    "--quiet",
    "--no-tags",
    context.remote,
    recoveryRef,
  ]);
  const parentSha = requireExactSha(
    "recovered lease parent",
    runGit(context, ["rev-parse", `${recoverySha}^`]).stdout.trim()
  );
  const message = runGit(context, [
    "show",
    "-s",
    "--format=%B",
    recoverySha,
  ]).stdout.trim();
  let decoded;
  try {
    decoded = JSON.parse(message);
  } catch {
    throw new Error(
      `Shared production scope lease recovery ${recoverySha} has malformed metadata; fail closed and inspect ${recoveryRef}.`
    );
  }
  const parsed = productionScopeLeaseRecoverySchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.recoveredLease.scope !== context.scope ||
    parsed.data.recoveredLeaseSha !== leaseSha ||
    parentSha !== leaseSha
  ) {
    throw new Error(
      `Shared production scope lease recovery ${recoverySha} violates the canonical metadata contract; fail closed and inspect ${recoveryRef}.`
    );
  }
  return {
    metadata: parsed.data,
    recoveredLeaseSha: leaseSha,
    recoverySha,
    ref: recoveryRef,
  };
}

function recoveryRefFor(scope, leaseSha) {
  return `refs/heads/openmeld-production-lease-recoveries/${scope}/${leaseSha}`;
}

function runGit(context, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: context.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!(options.allowFailure || (!result.error && result.status === 0))) {
    throw new Error(
      `git ${args.join(" ")} failed: ${redactGitOutput(result.error?.message ?? result.stderr)}`
    );
  }
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
}

function renderHeldLease(lease, now) {
  const expired = Date.parse(lease.metadata.expiresAt) <= now.getTime();
  return [
    `Production scope ${lease.metadata.scope} is already held by a shared lease.`,
    `Lease SHA: ${lease.leaseSha}`,
    `Owner: ${lease.metadata.owner}`,
    `Source SHA: ${lease.metadata.sourceSha}`,
    `Started: ${lease.metadata.startedAt}`,
    `Expires: ${lease.metadata.expiresAt}`,
    `State: ${expired ? "expired; verify the owner stopped, then use explicit recover with this lease SHA and a reason" : "active; wait for its owner to finish"}`,
  ].join("\n");
}

function renderLease(state, lease) {
  return [
    `Production scope lease ${state}`,
    `Scope: ${lease.metadata.scope}`,
    `Lease SHA: ${lease.leaseSha}`,
    `Owner: ${lease.metadata.owner}`,
    `Source SHA: ${lease.metadata.sourceSha}`,
    `Started: ${lease.metadata.startedAt}`,
    `Expires: ${lease.metadata.expiresAt}`,
    `Ref: ${lease.ref}`,
    "",
  ].join("\n");
}

function renderRecovery(recovery) {
  return [
    "Production scope lease recovery FOUND",
    `Scope: ${recovery.metadata.recoveredLease.scope}`,
    `Recovered lease: ${recovery.recoveredLeaseSha}`,
    `Previous owner: ${recovery.metadata.recoveredLease.owner}`,
    `Previous source: ${recovery.metadata.recoveredLease.sourceSha}`,
    `Previous start: ${recovery.metadata.recoveredLease.startedAt}`,
    `Previous expiry: ${recovery.metadata.recoveredLease.expiresAt}`,
    `Recovery reason: ${recovery.metadata.reason}`,
    `Recovered by: ${recovery.metadata.recoveredBy}`,
    `Recovered at: ${recovery.metadata.recoveredAt}`,
    `Recovery SHA: ${recovery.recoverySha}`,
    `Recovery ref: ${recovery.ref}`,
    "",
  ].join("\n");
}

function printAcquirePlan(context, metadata, leaseSha) {
  process.stdout.write(
    [
      "Production scope lease plan",
      `Scope: ${context.scope}`,
      `Owner: ${metadata.owner}`,
      `Source SHA: ${metadata.sourceSha}`,
      `Start: ${metadata.startedAt}`,
      `Expiry: ${metadata.expiresAt}`,
      `Shared ref: ${context.ref}`,
      `Candidate lease SHA: ${leaseSha}`,
      `Atomic command: git push --force-with-lease=${context.ref}: ${context.remote} ${leaseSha}:${context.ref}`,
      "",
    ].join("\n")
  );
}

function requireExactSha(label, value) {
  if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
    throw new Error(
      `${label} SHA must be an exact 40-character lowercase SHA.`
    );
  }
  return value;
}

function redactGitOutput(value) {
  return String(value ?? "")
    .replaceAll(/(https?:\/\/)[^/@\s]+@/giu, "$1[REDACTED]@")
    .trim();
}

function parseOptions(argv) {
  const [command, ...args] = argv;
  if (
    !new Set([
      "acquire",
      "inspect",
      "inspect-recovery",
      "recover",
      "release",
    ]).has(command)
  ) {
    throw new Error(
      "Production scope lease command must be acquire, inspect, inspect-recovery, recover, or release."
    );
  }
  const options = { command };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--") {
      continue;
    }
    if (!option.startsWith("--")) {
      throw new Error(`Unexpected production scope lease argument: ${option}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    index += 1;
    const name = option.slice(2).replaceAll("-", "_");
    const key = {
      github_output: "githubOutput",
      lease_sha: "leaseSha",
      owner: "owner",
      reason: "reason",
      remote: "remote",
      scope: "scope",
      source_sha: "sourceSha",
      ttl_seconds: "ttlSeconds",
    }[name];
    if (!key) {
      throw new Error(`Unknown production scope lease option: ${option}`);
    }
    options[key] = value;
  }
  if (!options.scope) {
    throw new Error("Production scope lease requires --scope.");
  }
  return options;
}

function main(argv) {
  const options = parseOptions(argv);
  if (options.command === "acquire") {
    acquireProductionScopeLease(options);
    return;
  }
  if (options.command === "inspect") {
    const lease = inspectProductionScopeLease(options);
    process.stdout.write(
      lease
        ? renderLease("HELD", lease)
        : `Production scope lease is free.\nScope: ${options.scope}\n`
    );
    return;
  }
  if (options.command === "inspect-recovery") {
    const recovery = inspectProductionScopeLeaseRecovery(options);
    process.stdout.write(
      recovery
        ? renderRecovery(recovery)
        : `Production scope lease recovery was not found.\nScope: ${options.scope}\nRecovered lease: ${options.leaseSha}\n`
    );
    return;
  }
  if (options.command === "recover") {
    recoverExpiredProductionScopeLease(options);
    return;
  }
  releaseProductionScopeLease(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
