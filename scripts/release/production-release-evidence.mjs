import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { productionReleaseEvidenceSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import { productionReleaseScopeSchema } from "../../packages/schemas/src/schemas/release/production-scope-lease.ts";
import {
  createProductionScopeLeaseGitEnvironment,
  resolveHostedLeaseRemote,
} from "./production-scope-lease.mjs";

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

  if (
    input.receipts &&
    (Object.keys(input.receipts).length !== scopes.length ||
      scopes.some((scope) => !input.receipts[scope]))
  ) {
    throw new Error(
      "Component receipts must cover exactly the selected scopes."
    );
  }
  const currentEvidence = readGuardedLocalReleaseEvidence(
    context,
    new Set(scopes)
  );
  const pending = [];
  for (const scope of scopes) {
    const current = currentEvidence.get(scope);
    const metadata = createEvidenceMetadata(
      context,
      scope,
      sourceSha,
      input.receipts?.[scope]
    );
    const prepared = prepareEvidenceProof(context, current, metadata, {
      recoveryProof: input.recoveryProof?.[scope],
      reconciliation: input.reconciliation?.[scope],
    });
    if (!prepared) {
      continue;
    }
    const { proofSha } = prepared;
    pending.push({
      evidenceSha: createEvidenceCommit(context, current, metadata, proofSha),
      expectedSha: current?.evidenceSha ?? "",
      metadata,
      ref: evidenceRef(scope),
      scope,
    });
  }

  if (pending.length === 0) {
    return { published: true, scopes, sourceSha };
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
    scopes,
    sourceSha,
  };
}

function prepareEvidenceProof(context, current, metadata, input) {
  const recoveryProof = input.recoveryProof;
  let proofMetadata;
  if (input.reconciliation) {
    proofMetadata = createReconciliationProofMetadata(
      context,
      current,
      metadata,
      input.reconciliation
    );
  } else if (recoveryProof) {
    proofMetadata = createRecoveryProofMetadata(
      context,
      current,
      metadata,
      recoveryProof
    );
  }
  if (
    isRecordedReceipt(
      current?.metadata,
      metadata,
      Boolean(recoveryProof),
      Boolean(input.reconciliation)
    )
  ) {
    return null;
  }
  let proofSha;
  if (proofMetadata) {
    proofSha = createEvidenceCommit(context, current, proofMetadata);
  } else if (
    current?.metadata.receipt?.attemptId === metadata.receipt?.attemptId
  ) {
    proofSha = current?.reconciliationProofSha;
  }
  if (
    ["reconciled-hosted", "reconciled-secret-addition"].includes(
      metadata.receipt?.identity?.proof
    ) &&
    !proofSha
  ) {
    throw new Error(
      "Reconciled identity requires its retained hosted provenance."
    );
  }
  return { proofSha };
}

export function readGuardedLocalReleaseSources(input = {}) {
  const context = {
    ...resolveContext(input),
    gitEnvironment: input.gitEnvironment,
  };
  return new Map(
    [...readGuardedLocalReleaseEvidence(context)].map(([scope, evidence]) => {
      const verifiedHistoryBaseline = readVerifiedHistoryBaseline(
        context,
        evidence
      );
      return [
        scope,
        {
          recordedAt: evidence.metadata.recordedAt,
          ...(evidence.metadata.receipt
            ? {
                receipt: evidence.metadata.receipt,
                evidenceSha: evidence.evidenceSha,
              }
            : {}),
          sha: evidence.metadata.sourceSha,
          source: "guarded-local",
          url:
            evidence.reconciliation?.kind === "reconciled-hosted-core-receiver"
              ? `https://github.com/${evidence.reconciliation.repository}/actions/runs/${evidence.reconciliation.runId}`
              : undefined,
          ...(evidence.reconciliation
            ? {
                reconciliation: evidence.reconciliation,
                reconciliationEvidenceSha: evidence.reconciliationProofSha,
              }
            : {}),
          ...(verifiedHistoryBaseline ? { verifiedHistoryBaseline } : {}),
        },
      ];
    })
  );
}

function readGuardedLocalReleaseEvidence(context, selectedScopes) {
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
    if (selectedScopes && !selectedScopes.has(scope)) {
      continue;
    }
    const evidenceSha = requireExactSha(
      `${scope} guarded local release evidence`,
      shaValue
    );
    runGit(context, ["fetch", "--quiet", "--no-tags", context.remote, ref]);
    evidenceByScope.set(scope, {
      ref,
      ...readEvidenceCommit(context, evidenceSha, scope),
    });
  }
  return evidenceByScope;
}

function readEvidenceCommit(context, evidenceSha, scope) {
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
  return {
    evidenceSha,
    metadata,
    ...readReconciliationProof(context, evidenceSha, metadata),
  };
}

function readVerifiedHistoryBaseline(context, latest) {
  if (
    !latest.metadata.receipt ||
    latest.metadata.receipt.status === "verified"
  ) {
    return undefined;
  }
  let current = latest;
  for (;;) {
    // The first parent is receipt chronology; a second parent is a recovery
    // proof. The first receipt points directly to its released source commit.
    const parentSha = runGit(context, [
      "rev-parse",
      `${current.evidenceSha}^1`,
    ]).stdout.trim();
    if (parentSha === current.metadata.sourceSha) {
      return undefined;
    }
    const previous = readEvidenceCommit(
      context,
      parentSha,
      latest.metadata.scope
    );
    if (
      Date.parse(previous.metadata.recordedAt) >
      Date.parse(current.metadata.recordedAt)
    ) {
      throw new Error(
        "Guarded local release evidence history moves backward in time."
      );
    }
    if (previous.metadata.receipt?.status === "verified") {
      return {
        evidenceSha: previous.evidenceSha,
        recordedAt: previous.metadata.recordedAt,
        receipt: previous.metadata.receipt,
        sha: previous.metadata.sourceSha,
      };
    }
    current = previous;
  }
}

function createReconciliationProofMetadata(
  context,
  current,
  metadata,
  reconciliation
) {
  if (reconciliation.kind === "reconciled-core-secret-addition") {
    if (
      metadata.schemaVersion !== 3 ||
      metadata.scope !== "core" ||
      metadata.receipt.status !== "applied" ||
      current?.metadata.receipt?.status !== "verified" ||
      current.evidenceSha !== reconciliation.supersededReceipt.evidenceSha ||
      current.metadata.sourceSha !== metadata.sourceSha ||
      !isDeepStrictEqual(
        current.metadata.receipt.identity,
        reconciliation.baselineIdentity
      ) ||
      metadata.receipt.attemptId === current.metadata.receipt.attemptId ||
      Date.parse(current.metadata.recordedAt) >=
        Date.parse(reconciliation.deployedAt) ||
      Date.parse(metadata.receipt.startedAt) <
        Date.parse(reconciliation.deployedAt)
    ) {
      throw new Error(
        "Secret reconciliation must retain the exact verified predecessor and start a new evidence-only attempt."
      );
    }
    return productionReleaseEvidenceSchema.parse({
      ...metadata,
      schemaVersion: 7,
      reconciliation,
    });
  }
  if (reconciliation.kind === "reconciled-postgresql-rollback") {
    const proof = productionReleaseEvidenceSchema.parse({
      ...metadata,
      schemaVersion: 6,
      reconciliation,
    });
    const baseline = parseEvidenceMetadata({
      scope: "db",
      evidenceSha: reconciliation.baselineReceipt.evidenceSha,
      message: runGit(context, [
        "show",
        "-s",
        "--format=%B",
        reconciliation.baselineReceipt.evidenceSha,
      ]).stdout,
    });
    if (
      current?.evidenceSha !== reconciliation.supersededReceipt.evidenceSha ||
      current.metadata.sourceSha !==
        reconciliation.supersededReceipt.sourceSha ||
      current.metadata.scope !== "db" ||
      current.metadata.receipt?.status !== "failed" ||
      current.metadata.receipt.application !== "unknown" ||
      current.metadata.receipt.identity ||
      metadata.receipt.attemptId === current.metadata.receipt.attemptId ||
      baseline.sourceSha !== reconciliation.baselineReceipt.sourceSha ||
      baseline.receipt?.status !== "verified" ||
      baseline.receipt.identity?.kind !== "release-source" ||
      Date.parse(baseline.recordedAt) >
        Date.parse(current.metadata.receipt.startedAt) ||
      Date.parse(reconciliation.verifiedAt) <
        Date.parse(current.metadata.recordedAt) ||
      runGit(
        context,
        [
          "merge-base",
          "--is-ancestor",
          reconciliation.baselineReceipt.evidenceSha,
          current.evidenceSha,
        ],
        { allowFailure: true }
      ).status !== 0 ||
      runGit(
        context,
        [
          "merge-base",
          "--is-ancestor",
          baseline.sourceSha,
          current.metadata.sourceSha,
        ],
        { allowFailure: true }
      ).status !== 0 ||
      runGit(
        context,
        [
          "merge-base",
          "--is-ancestor",
          current.metadata.sourceSha,
          metadata.sourceSha,
        ],
        { allowFailure: true }
      ).status !== 0 ||
      runGit(
        context,
        [
          "diff",
          "--quiet",
          current.metadata.sourceSha,
          metadata.sourceSha,
          "--",
          "packages/db/postgresql/migrations",
          "tooling/postgresql/resources.json",
        ],
        { allowFailure: true }
      ).status !== 0 ||
      runGit(
        context,
        [
          "diff",
          "--quiet",
          baseline.sourceSha,
          current.metadata.sourceSha,
          "--",
          "tooling/postgresql/resources.json",
        ],
        { allowFailure: true }
      ).status !== 0
    ) {
      throw new Error(
        "PostgreSQL rollback proof must preserve its exact failed attempt and verified baseline."
      );
    }
    return proof;
  }
  if (metadata.schemaVersion !== 3 || metadata.receipt.status !== "applied") {
    throw new Error(
      "Reconciliation must first retain an applied identity, never fabricate an original start event."
    );
  }
  if (
    current?.evidenceSha !== reconciliation.supersededReceipt.evidenceSha ||
    current.metadata.sourceSha !== reconciliation.supersededReceipt.sourceSha ||
    current.metadata.receipt?.status !== "failed" ||
    current.metadata.receipt.application !== "unknown" ||
    Date.parse(current.metadata.recordedAt) >=
      Date.parse(reconciliation.deployedAt)
  ) {
    throw new Error(
      "Reconciliation must preserve the exact superseded historical receipt."
    );
  }
  return productionReleaseEvidenceSchema.parse({
    ...metadata,
    recordedAt: context.now.toISOString(),
    schemaVersion: 5,
    reconciliation,
  });
}

function readReconciliationProof(context, evidenceSha, metadata) {
  const parents = runGit(context, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    evidenceSha,
  ])
    .stdout.trim()
    .split(WHITESPACE_PATTERN);
  if (parents.length < 3) {
    if (
      ["reconciled-hosted", "reconciled-secret-addition"].includes(
        metadata.receipt?.identity?.proof
      )
    ) {
      throw new Error("Reconciled identity is missing its hosted provenance.");
    }
    return {};
  }
  const proofSha = parents[2];
  const message = runGit(context, [
    "show",
    "-s",
    "--format=%B",
    proofSha,
  ]).stdout.trim();
  const raw = JSON.parse(message);
  if (![5, 6, 7].includes(raw.schemaVersion)) {
    if (
      ["reconciled-hosted", "reconciled-secret-addition"].includes(
        metadata.receipt?.identity?.proof
      )
    ) {
      throw new Error("Reconciled identity has the wrong provenance schema.");
    }
    return {};
  }
  const proof = productionReleaseEvidenceSchema.parse(raw);
  if (
    proof.scope !== metadata.scope ||
    proof.sourceSha !== metadata.sourceSha ||
    proof.receipt.attemptId !== metadata.receipt?.attemptId ||
    proof.receipt.operationKey !== metadata.receipt?.operationKey ||
    proof.receipt.startedAt !== metadata.receipt?.startedAt ||
    proof.receipt.componentIndex !== metadata.receipt?.componentIndex ||
    runGit(context, ["show", "-s", "--format=%P", proofSha]).stdout.trim() !==
      proof.reconciliation.supersededReceipt.evidenceSha ||
    runGit(context, ["rev-parse", `${proofSha}^{tree}`]).stdout.trim() !==
      runGit(context, [
        "rev-parse",
        `${metadata.sourceSha}^{tree}`,
      ]).stdout.trim() ||
    ([5, 7].includes(proof.schemaVersion) &&
      JSON.stringify(proof.receipt.identity) !==
        JSON.stringify(metadata.receipt?.identity))
  ) {
    throw new Error(
      "Reconciled provenance does not match the canonical applied receiver."
    );
  }
  return {
    reconciliation: proof.reconciliation,
    reconciliationProofSha: proofSha,
  };
}

function resolveContext(input) {
  const environment = input.environment ?? process.env;
  const context = {
    cwd: path.resolve(input.cwd ?? process.cwd()),
    environment,
    now: input.now ? new Date(input.now) : new Date(),
    remote: input.remote ?? resolveHostedLeaseRemote(environment) ?? "origin",
    gitEnvironment: input.gitEnvironment,
  };
  if (Number.isNaN(context.now.getTime())) {
    throw new Error("Guarded local release evidence requires a valid time.");
  }
  return context;
}

function evidenceRef(scope) {
  return `${EVIDENCE_REF_PREFIX}/${scope}`;
}

function createEvidenceMetadata(context, scope, sourceSha, receipt) {
  let schemaVersion = receipt ? 2 : 1;
  if (receipt?.operationKey) {
    schemaVersion = 3;
  }
  return productionReleaseEvidenceSchema.parse({
    evidenceId: randomUUID(),
    kind: EVIDENCE_KIND,
    recordedAt: context.now.toISOString(),
    schemaVersion,
    scope,
    sourceSha,
    ...(receipt ? { receipt } : {}),
  });
}

function createRecoveryProofMetadata(context, current, next, receipt) {
  if (
    next.scope !== "remote-agent" ||
    current?.metadata.schemaVersion !== 3 ||
    current.metadata.receipt?.status !== "failed" ||
    current.metadata.receipt.application !== "unknown" ||
    next.schemaVersion !== 3 ||
    !["verified", "failed"].includes(next.receipt?.status) ||
    receipt.recovery?.originalEvidenceSha !== current.evidenceSha ||
    receipt.attemptId !== next.receipt.attemptId ||
    receipt.operationKey !== next.receipt.operationKey ||
    receipt.startedAt !== next.receipt.startedAt ||
    receipt.componentIndex !== next.receipt.componentIndex ||
    receipt.status !== next.receipt.status ||
    receipt.application !== next.receipt.application ||
    JSON.stringify(receipt.identity) !==
      JSON.stringify(next.receipt.identity) ||
    (next.receipt.status === "failed" &&
      (next.receipt.application !== "unknown" || next.receipt.identity)) ||
    (next.receipt.status === "verified" &&
      (next.receipt.application !== "applied" ||
        receipt.identity?.kind !== "worker-deployment" ||
        receipt.identity.workerName !== "openmeld-remote-agent-prod"))
  ) {
    throw new Error(
      "Recovery proof must match the exact retained failed Remote Agent attempt and completion."
    );
  }
  return productionReleaseEvidenceSchema.parse({
    evidenceId: randomUUID(),
    kind: EVIDENCE_KIND,
    recordedAt: context.now.toISOString(),
    schemaVersion: 4,
    scope: next.scope,
    sourceSha: next.sourceSha,
    receipt,
  });
}

function isRecordedReceipt(
  current,
  next,
  recoveryProved = false,
  reconciliationProved = false
) {
  if (!current) {
    return false;
  }
  if (next.schemaVersion < current.schemaVersion) {
    throw new Error(
      "An existing receipt cannot be downgraded; use current release tooling to reconcile it."
    );
  }
  if (!next.receipt) {
    return false;
  }
  const previous = current.receipt;
  if (
    previous &&
    previous.status !== "verified" &&
    previous.attemptId !== next.receipt.attemptId &&
    !reconciliationProved
  ) {
    throw new Error(
      "An unresolved component attempt cannot be replaced; reconcile its deployment first."
    );
  }
  if (
    previous?.attemptId === next.receipt.attemptId &&
    current.sourceSha !== next.sourceSha
  ) {
    throw new Error("A retained release attempt cannot change its source SHA.");
  }
  if (
    previous?.attemptId === next.receipt.attemptId &&
    previous.componentIndex === next.receipt.componentIndex &&
    previous.status === next.receipt.status
  ) {
    if (
      current.sourceSha !== next.sourceSha ||
      JSON.stringify(previous) !== JSON.stringify(next.receipt)
    ) {
      throw new Error(
        "An existing component event cannot be rewritten with different evidence."
      );
    }
    return !recoveryProved;
  }
  if (Date.parse(next.recordedAt) < Date.parse(current.recordedAt)) {
    throw new Error(
      "Refusing an older component receipt; reconcile the latest deployment evidence first."
    );
  }
  const recovered = validateCorrelationTransition(
    current,
    next,
    recoveryProved
  );
  if (previous?.attemptId === next.receipt.attemptId) {
    const order = { started: 0, applied: 1, verified: 2, failed: 2 };
    if (
      next.receipt.componentIndex < previous.componentIndex ||
      (next.receipt.componentIndex === previous.componentIndex &&
        order[next.receipt.status] <= order[previous.status] &&
        !recovered)
    ) {
      throw new Error(
        "A completed component event cannot move backward or change its terminal outcome."
      );
    }
  }
  return false;
}

function validateCorrelationTransition(current, next, recoveryProved) {
  const previous = current.receipt;
  if (
    current.schemaVersion !== 3 ||
    previous?.attemptId !== next.receipt.attemptId ||
    previous.componentIndex !== next.receipt.componentIndex
  ) {
    return false;
  }
  const retained = previous.remoteAgent;
  const continuing = next.receipt.remoteAgent;
  const nextPhase = {
    "worker-only": "retained",
    retained: "rollout",
    rollout: "complete",
    complete: "complete",
  };
  if (
    retained &&
    continuing &&
    continuing.phase !== retained.phase &&
    continuing.phase !== nextPhase[retained.phase]
  ) {
    throw new Error(
      "A retained native release cannot skip its explicit rollout stage."
    );
  }
  if (
    retained &&
    (!continuing ||
      JSON.stringify({
        ...retained,
        phase: undefined,
        workerIdentity: undefined,
      }) !==
        JSON.stringify({
          ...continuing,
          phase: undefined,
          workerIdentity: undefined,
        }) ||
      (retained.workerIdentity &&
        JSON.stringify(retained.workerIdentity) !==
          JSON.stringify(continuing.workerIdentity)))
  ) {
    throw new Error(
      "Retained native provenance cannot be removed or changed within a release attempt."
    );
  }
  if (
    current.scope === "remote-agent" &&
    retained?.phase === "retained" &&
    continuing?.phase === "rollout" &&
    previous.status === "applied" &&
    next.receipt.status === "started" &&
    next.receipt.application === "unknown" &&
    !next.receipt.identity &&
    previous.operationKey === next.receipt.operationKey &&
    previous.startedAt === next.receipt.startedAt &&
    JSON.stringify({ ...retained, phase: "rollout" }) ===
      JSON.stringify(continuing) &&
    JSON.stringify(previous.identity) ===
      JSON.stringify(retained.workerIdentity)
  ) {
    return true;
  }
  if (
    previous.operationKey !== next.receipt.operationKey ||
    previous.startedAt !== next.receipt.startedAt ||
    (previous.identity &&
      JSON.stringify(previous.identity) !==
        JSON.stringify(next.receipt.identity))
  ) {
    throw new Error(
      "A correlated component attempt cannot change its target or applied identity."
    );
  }
  if (recoveryProved) {
    return previous.status === "failed" && previous.application === "unknown";
  }
  // The native PostgreSQL executor verifies the registered target journal and
  // grants under its lease before completing this same-source unknown attempt.
  if (
    current.scope === "db" &&
    previous.status === "failed" &&
    previous.application === "unknown" &&
    !previous.identity &&
    next.receipt.status === "verified" &&
    next.receipt.application === "applied" &&
    next.receipt.identity?.kind === "release-source"
  ) {
    return true;
  }
  // The guarded Core executor proves the previous verified deployment is still
  // active before retrying, then captures a fresh command-correlated activation.
  if (
    current.scope === "core" &&
    previous.status === "failed" &&
    previous.application === "unknown" &&
    !previous.identity &&
    next.receipt.status === "applied" &&
    next.receipt.application === "applied" &&
    next.receipt.identity?.kind === "worker-deployment" &&
    next.receipt.identity.sourceSha === next.sourceSha
  ) {
    return true;
  }
  return (
    previous.status === "failed" &&
    previous.application === "applied" &&
    previous.identity &&
    next.receipt.status === "verified"
  );
}

function createEvidenceCommit(context, current, metadata, proofSha) {
  const parentSha = current?.evidenceSha ?? metadata.sourceSha;
  const result = spawnSync(
    "git",
    [
      "commit-tree",
      `${metadata.sourceSha}^{tree}`,
      "-p",
      parentSha,
      ...(proofSha ? ["-p", proofSha] : []),
    ],
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
  const parsed = productionReleaseEvidenceSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.scope !== input.scope) {
    throw new Error(
      `Guarded local release evidence ${input.evidenceSha} violates its metadata contract.`
    );
  }
  return parsed.data;
}

function runGit(context, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: context.cwd,
    encoding: "utf8",
    env:
      context.gitEnvironment ??
      createProductionScopeLeaseGitEnvironment(context.environment, {
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
