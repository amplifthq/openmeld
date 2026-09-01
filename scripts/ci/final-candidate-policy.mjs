import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import {
  isEngineeringOnlySchemaPath,
  isReleaseReadyPath,
} from "../release/release-ready-paths.mjs";
import { isFinalCandidateControlPath } from "./final-candidate-control-paths.mjs";

export const FINAL_CANDIDATE_LABELS = Object.freeze({
  full: "final-candidate-full",
  standard: "final-candidate",
});
export const FINAL_CANDIDATE_LABEL = FINAL_CANDIDATE_LABELS.standard;
export const FINAL_CANDIDATE_STATUS_CONTEXT = "OpenMeld Final Candidate";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_COMMAND_PART_PATTERN = /^[\w./:=@+-]+$/u;
const VERSIONED_RELEASE_BRANCH_PATTERN =
  /^codex\/release-\d+\.\d+\.\d+-[0-9a-f]{8,40}$/iu;
const DOCUMENT_PATH_PATTERN = /(?:^|\/)(?:AGENTS|CLAUDE|README)\.md$|\.md$/u;
const DELIVERY_INFRASTRUCTURE_PREFIXES = [
  ".github/",
  ".husky/",
  "scripts/release/",
];
const DELIVERY_INFRASTRUCTURE_PATHS = new Set([
  "scripts/ci/check-candidate-code-quality.mjs",
  "scripts/ci/check-candidate-code-quality.test.mjs",
  "scripts/ci/final-candidate-bootstrap.mjs",
  "scripts/ci/final-candidate-bootstrap.test.mjs",
  "scripts/ci/fast-pr-test-plan.mjs",
  "scripts/ci/fast-pr-test-plan.test.mjs",
  "scripts/ci/final-candidate-output.mjs",
  "scripts/ci/final-candidate-control-paths.mjs",
  "scripts/ci/final-candidate-policy.mjs",
  "scripts/ci/final-candidate-policy.test.mjs",
  "scripts/ci/final-candidate-publisher.mjs",
  "scripts/ci/final-candidate-publisher.test.mjs",
  "scripts/ci/final-candidate-reuse.mjs",
  "scripts/ci/final-candidate-reuse.test.mjs",
  "scripts/ci/final-candidate-state.mjs",
  "scripts/ci/final-candidate-workflow.test.mjs",
  "scripts/ci/final-candidate.mjs",
  "scripts/ci/final-candidate.test.mjs",
  "scripts/ci/install-isolated-candidate-dependencies.sh",
  "scripts/ci/install-isolated-candidate-dependencies.test.mjs",
  "scripts/ci/merge-group-final-candidate-workflow.test.mjs",
  "scripts/ci/resolve-approved-native-builds.mjs",
  "scripts/ci/resolve-approved-native-builds.test.mjs",
  "scripts/ci/run-isolated-candidate-command.sh",
  "scripts/ci/trusted-git-network.mjs",
  "scripts/ci/trusted-git-network.test.mjs",
  "scripts/ci/trusted-final-candidate-entrypoint.test.mjs",
  "scripts/ci/trusted-final-candidate.sh",
  "scripts/ci/verify-trusted-candidate-entrypoints.mjs",
  "scripts/ci/verify-trusted-candidate-entrypoints.test.mjs",
]);
const REPOSITORY_CONTROL_PREFIXES = [".github/", ".husky/", "scripts/"];
const REPOSITORY_CONTROL_PATHS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);
const BOUNDARY_PREFIXES = [
  "packages/agent-runtime/",
  "packages/db/",
  "packages/schemas/",
  "runtime/",
  "services/auth/",
  "services/core/",
  "services/gateway/",
  "services/remote-agent/",
];
const DATABASE_PREFIXES = ["packages/db/drizzle/", "packages/db/src/"];

const check = (id, command, reason) => ({ command, id, reason });

function resolvePlanAuthority(input) {
  const confidence = input.confidence ?? "standard";
  const mode = input.mode ?? "local";
  const controlTrust = input.controlTrust ?? "current-main";
  if (!(confidence === "standard" || confidence === "full")) {
    throw new Error(`Unknown final-candidate confidence: ${confidence}`);
  }
  if (!(mode === "local" || mode === "remote")) {
    throw new Error(`Unknown final-candidate mode: ${mode}`);
  }
  if (
    !(controlTrust === "current-main" || controlTrust === "explicit-bootstrap")
  ) {
    throw new Error(`Unknown final-candidate control trust: ${controlTrust}`);
  }
  if (controlTrust === "explicit-bootstrap" && mode !== "local") {
    throw new Error("Explicit Final Candidate bootstrap is local-only.");
  }
  const bootstrapReason =
    controlTrust === "explicit-bootstrap"
      ? String(input.bootstrapReason ?? "").trim()
      : null;
  if (controlTrust === "explicit-bootstrap" && bootstrapReason.length < 20) {
    throw new Error("Explicit Final Candidate bootstrap requires a reason.");
  }
  return { bootstrapReason, confidence, controlTrust, mode };
}

export function createFinalCandidatePlan(input) {
  const changedPaths = [...new Set(input.changedPaths ?? [])].toSorted();
  const candidateKind = input.candidateKind ?? "pull-request";
  if (!(candidateKind === "pull-request" || candidateKind === "merge-group")) {
    throw new Error(`Unknown final-candidate kind: ${candidateKind}`);
  }
  const { bootstrapReason, confidence, controlTrust, mode } =
    resolvePlanAuthority(input);

  const context = {
    baseSha: input.baseSha,
    boundaryChange: changedPaths.some(isBoundaryPath),
    changedPaths,
    confidence,
    controlTrust,
    databaseChange: changedPaths.some(isDatabasePath),
    deliveryInfrastructureChange: changedPaths.some(
      isDeliveryInfrastructurePath
    ),
    deliveryInfrastructureOnly:
      changedPaths.length > 0 &&
      changedPaths.some(isDeliveryInfrastructurePath) &&
      changedPaths.every(
        (path) =>
          isDeliveryInfrastructurePath(path) || isDocumentationPath(path)
      ),
    docsOnly:
      changedPaths.length > 0 && changedPaths.every(isDocumentationPath),
    headSha: input.headSha,
    mode,
    planSourceSha:
      input.planSourceSha ??
      (controlTrust === "explicit-bootstrap" ? input.headSha : input.baseSha),
    releaseReadyPaths: changedPaths.filter(isReleaseReadyPath),
    repositoryControlChange: changedPaths.some(isRepositoryControlPath),
    strictRelease:
      candidateKind === "merge-group" ||
      isVersionedReleaseBranch(input.branchName),
  };
  const selectedChecks = [
    check(
      "diff-integrity",
      ["git", "diff", "--check", `${input.baseSha}...${input.headSha}`],
      "Reject whitespace errors in the exact candidate diff."
    ),
  ];
  const skippedChecks = [];

  if (
    context.mode === "remote" ||
    (context.controlTrust === "current-main" &&
      changedPaths.some(isFinalCandidateControlPath))
  ) {
    selectedChecks.push(
      check(
        "trusted-control-entrypoints",
        ["node", "scripts/ci/verify-trusted-candidate-entrypoints.mjs"],
        "Current-main validation must use unchanged test-control entrypoints unless an explicit local bootstrap is recorded."
      )
    );
  }

  selectPrimaryChecks(context, selectedChecks, skippedChecks);
  selectIntegrationCheck(context, skippedChecks);
  selectDatabaseCheck(context, selectedChecks, skippedChecks);
  selectReleaseReadyCheck(context, selectedChecks, skippedChecks);
  skippedChecks.push(
    skipped(
      "deep-confidence",
      "Deep Confidence remains an explicit diagnostic escalation, not a default paid gate."
    ),
    skipped(
      "production-health-and-smoke",
      "Health and real-user smoke prove the deployed SHA after release; they cannot be replaced by pre-merge CI."
    )
  );

  return {
    baseSha: input.baseSha,
    bootstrapReason,
    branchName: input.branchName,
    candidateKind,
    changedPaths,
    confidence,
    controlTrust,
    headSha: input.headSha,
    mode,
    planSourceSha: context.planSourceSha,
    releaseReadyPaths: context.releaseReadyPaths,
    riskTags: resolveRiskTags(context),
    selectedChecks,
    skippedChecks,
    treeSha: input.treeSha,
  };
}

function selectPrimaryChecks(context, selectedChecks, skippedChecks) {
  if (context.docsOnly) {
    selectedChecks.push(
      check(
        "documentation-contracts",
        ["pnpm", "run", "verify:docs", "--", "--strict"],
        "The candidate changes only tracked documentation and agent routing."
      )
    );
    if (context.changedPaths.some(isChangelogPath)) {
      selectedChecks.push(
        check(
          "changelog-contract",
          ["pnpm", "run", "verify:changelog"],
          "The candidate changes the public Changelog source or projection."
        )
      );
    }
    skippedChecks.push(
      skipped(
        "affected-checks-and-unit-tests",
        "No executable workspace source or test changed."
      )
    );
    return;
  }

  if (context.repositoryControlChange) {
    selectedChecks.push(
      check(
        "repository-code-quality",
        [
          "node",
          "scripts/ci/check-candidate-code-quality.mjs",
          context.baseSha,
          context.headSha,
        ],
        "Repository control code changed, so Biome must inspect every existing file in the exact candidate diff."
      )
    );
  }
  selectedChecks.push(
    check(
      "repository-contracts",
      ["pnpm", "run", "verify:pre-push:checks"],
      context.repositoryControlChange
        ? "CI, release, dependency, or repository control files changed."
        : "Executable source changed, so repository-wide static contracts remain relevant."
    )
  );
  if (context.confidence === "full") {
    selectedChecks.push(
      check(
        "full-repository-confidence",
        ["pnpm", "run", "verify:pr:full"],
        "The agent explicitly selected full local confidence."
      )
    );
    return;
  }
  skippedChecks.push(
    skipped(
      "affected-checks-and-unit-tests",
      context.deliveryInfrastructureOnly
        ? "Delivery infrastructure is covered by its behavioral contract suite during development and review; no product workspace changed."
        : "Focused and affected behavior validation belongs to development and review; standard Final Candidate does not repeat the broad workspace lane. Use full confidence when that extra repository-wide closeout is worth the latency."
    )
  );
}

function selectIntegrationCheck(context, skippedChecks) {
  if (context.confidence === "full") {
    skippedChecks.push(
      skipped(
        "affected-integration-tests",
        "Full repository confidence already includes integration tests."
      )
    );
    return;
  }
  skippedChecks.push(
    skipped(
      "affected-integration-tests",
      context.boundaryChange
        ? "Cross-boundary integration validation belongs to development and review; standard Final Candidate does not repeat the broad integration lane. Use full confidence when the exact candidate still needs repository-wide integration coverage."
        : "No shared, service, runtime, or persistence boundary changed; focused validation remains owned by development and review."
    )
  );
}

function selectDatabaseCheck(context, selectedChecks, skippedChecks) {
  if (!context.databaseChange) {
    skippedChecks.push(
      skipped("database-contract", "No database owner path changed.")
    );
    return;
  }
  selectedChecks.push(
    check(
      "database-contract",
      ["pnpm", "run", "db:check"],
      "Database schema or migration truth changed."
    )
  );
}

function selectReleaseReadyCheck(context, selectedChecks, skippedChecks) {
  if (context.releaseReadyPaths.length === 0) {
    skippedChecks.push(
      skipped(
        "local-components-release-ready",
        "No CLI, OpenMeld Service, managed Skill, daemon schema, or release manifest path changed."
      )
    );
    return;
  }
  selectedChecks.push(
    check(
      "local-components-release-ready",
      context.strictRelease
        ? ["pnpm", "run", "verify:release-ready"]
        : [
            "pnpm",
            "run",
            "verify:release-ready",
            "--",
            "--defer-release",
            "--base",
            context.baseSha,
          ],
      context.strictRelease
        ? "A versioned release branch must prove the stamped local-component artifact."
        : `Local-component source changed on a feature branch; deferred verification preserves the release invariant for ${context.releaseReadyPaths.length} path(s).`
    )
  );
}

function resolveRiskTags(context) {
  return [
    ...(context.docsOnly ? ["documentation"] : ["executable"]),
    ...(context.deliveryInfrastructureChange
      ? ["delivery-infrastructure"]
      : []),
    ...(context.boundaryChange ? ["cross-boundary"] : []),
    ...(context.databaseChange ? ["database"] : []),
    ...(context.releaseReadyPaths.length > 0 ? ["local-components"] : []),
    ...(context.confidence === "full" ? ["full-confidence"] : []),
  ];
}

function assertExactCandidateFacts(snapshot, candidateKind) {
  const exactFacts = [
    ["expected head", snapshot.expectedHeadSha],
    ["actual head", snapshot.actualHeadSha],
    ["expected base", snapshot.expectedBaseSha],
    ["current main", snapshot.currentMainSha],
    ["tree", snapshot.treeSha],
  ];
  if (candidateKind === "pull-request") {
    exactFacts.push(["pull request base", snapshot.pullRequestBaseSha]);
  }
  for (const [name, value] of exactFacts) {
    if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
      throw new Error(`Final Candidate requires an exact ${name} SHA.`);
    }
  }
}

function assertPullRequestSnapshot(snapshot, requireCurrentBase) {
  if (snapshot.pullRequestHeadSha !== snapshot.expectedHeadSha) {
    throw new Error(
      `Pull request head drifted: expected ${snapshot.expectedHeadSha}, found ${snapshot.pullRequestHeadSha}.`
    );
  }
  if (
    requireCurrentBase &&
    snapshot.pullRequestBaseSha !== snapshot.expectedBaseSha
  ) {
    throw new Error(
      `Pull request base drifted: expected ${snapshot.expectedBaseSha}, found ${snapshot.pullRequestBaseSha}.`
    );
  }
  if (snapshot.pullRequestBaseRef !== "main") {
    throw new Error(
      `Final Candidate requires a pull request into main, found ${snapshot.pullRequestBaseRef}.`
    );
  }
  if (snapshot.pullRequestDraft) {
    throw new Error("A draft pull request cannot become a final candidate.");
  }
  if (snapshot.pullRequestState !== "open") {
    throw new Error(
      `Final Candidate requires an open pull request, found ${snapshot.pullRequestState}.`
    );
  }
}

export function assertCandidateSnapshot(snapshot, options = {}) {
  const candidateKind = options.candidateKind ?? "pull-request";
  const requireCurrentBase = options.requireCurrentBase ?? true;
  assertExactCandidateFacts(snapshot, candidateKind);
  if (snapshot.actualHeadSha !== snapshot.expectedHeadSha) {
    throw new Error(
      `Candidate head drifted: expected ${snapshot.expectedHeadSha}, found ${snapshot.actualHeadSha}.`
    );
  }
  if (
    requireCurrentBase &&
    snapshot.currentMainSha !== snapshot.expectedBaseSha
  ) {
    throw new Error(
      `Main advanced: candidate base ${snapshot.expectedBaseSha}, current main ${snapshot.currentMainSha}. Sync the branch and create a new candidate.`
    );
  }
  if (!snapshot.baseIsAncestorOfHead) {
    throw new Error(
      `Candidate ${snapshot.expectedHeadSha} does not contain current main ${snapshot.expectedBaseSha}. Sync the branch before validation.`
    );
  }
  if (candidateKind === "pull-request") {
    assertPullRequestSnapshot(snapshot, requireCurrentBase);
  }
  if ((snapshot.dirtyPaths ?? []).length > 0) {
    throw new Error(
      [
        "Final Candidate requires the exact committed tree; the worktree is dirty:",
        ...snapshot.dirtyPaths.map((path) => `- ${path}`),
      ].join("\n")
    );
  }
}

export function executeCandidateChecks(checks, dependencies) {
  const results = [];
  for (const selectedCheck of checks) {
    const startedAt = dependencies.now();
    const reuse = dependencies.resolveReuse?.(selectedCheck) ?? null;
    if (reuse?.reusedFrom) {
      const finishedAt = dependencies.now();
      results.push({
        command: selectedCheck.command,
        durationMs: Math.max(0, finishedAt - startedAt),
        execution: {
          inputFingerprint: reuse.inputFingerprint,
          kind: "reused",
          source: reuse.reusedFrom,
        },
        exitCode: 0,
        id: selectedCheck.id,
        reason: selectedCheck.reason,
        spawnError: null,
        status: "passed",
        stderrTail: "",
        stdoutTail: "",
      });
      dependencies.onReuse?.(selectedCheck, reuse.reusedFrom);
      continue;
    }
    let result;
    try {
      result = dependencies.runCommand(selectedCheck.command, selectedCheck);
    } catch (error) {
      result = {
        spawnError: String(
          error instanceof Error ? error.message : error
        ).slice(-8192),
        status: null,
        stderrTail: "",
        stdoutTail: "",
      };
    }
    const finishedAt = dependencies.now();
    const passed = result.status === 0 && !result.spawnError;
    const checkResult = {
      command: selectedCheck.command,
      durationMs: Math.max(0, finishedAt - startedAt),
      execution: {
        inputFingerprint: reuse?.inputFingerprint ?? null,
        kind: "executed",
      },
      exitCode: Number.isInteger(result.status) ? result.status : null,
      id: selectedCheck.id,
      reason: selectedCheck.reason,
      spawnError: result.spawnError ?? null,
      status: passed ? "passed" : "failed",
      stderrTail: result.stderrTail ?? "",
      stdoutTail: result.stdoutTail ?? "",
    };
    results.push(checkResult);
    if (!passed) {
      return {
        conclusion: "failure",
        failedCheckId: selectedCheck.id,
        results,
      };
    }
  }
  return { conclusion: "success", failedCheckId: null, results };
}

export function evidenceMatchesCandidate(evidence, candidate) {
  const parsedEvidence = finalCandidateEvidenceSchema.safeParse(evidence);
  if (!parsedEvidence.success) {
    return false;
  }
  const value = parsedEvidence.data;
  return (
    value.conclusion === "success" &&
    value.publicationErrors.length === 0 &&
    value.headSha === candidate.headSha &&
    value.baseSha === candidate.baseSha &&
    value.treeSha === candidate.treeSha
  );
}

export function resolveFinalCandidateLabel(confidence) {
  const label = FINAL_CANDIDATE_LABELS[confidence];
  if (!label) {
    throw new Error(`Unknown final-candidate confidence: ${confidence}`);
  }
  return label;
}

export function formatCommand(command) {
  return command
    .map((part) =>
      SAFE_COMMAND_PART_PATTERN.test(part) ? part : JSON.stringify(part)
    )
    .join(" ");
}

function isDocumentationPath(path) {
  return DOCUMENT_PATH_PATTERN.test(path) || isChangelogPath(path);
}

function isChangelogPath(path) {
  return (
    path === "CHANGELOG.md" ||
    path.startsWith("changelog/") ||
    path === "developing/engineering/changelog.md"
  );
}

function isDeliveryInfrastructurePath(path) {
  return (
    DELIVERY_INFRASTRUCTURE_PATHS.has(path) ||
    DELIVERY_INFRASTRUCTURE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isRepositoryControlPath(path) {
  return (
    REPOSITORY_CONTROL_PATHS.has(path) ||
    REPOSITORY_CONTROL_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isBoundaryPath(path) {
  return (
    !isEngineeringOnlySchemaPath(path) &&
    BOUNDARY_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isDatabasePath(path) {
  return DATABASE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isVersionedReleaseBranch(branchName) {
  return VERSIONED_RELEASE_BRANCH_PATTERN.test(String(branchName ?? ""));
}

function skipped(id, reason) {
  return { id, reason };
}
