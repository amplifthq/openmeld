import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { isReleaseReadyPath } from "../release/release-ready-paths.mjs";

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
const DELIVERY_INFRASTRUCTURE_PREFIXES = [".github/", ".husky/", "scripts/"];
const DELIVERY_INFRASTRUCTURE_PATHS = new Set([
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

export function createFinalCandidatePlan(input) {
  const changedPaths = [...new Set(input.changedPaths ?? [])].toSorted();
  const confidence = input.confidence ?? "standard";
  if (!(confidence === "standard" || confidence === "full")) {
    throw new Error(`Unknown final-candidate confidence: ${confidence}`);
  }

  const context = {
    baseSha: input.baseSha,
    boundaryChange: changedPaths.some(isBoundaryPath),
    changedPaths,
    confidence,
    databaseChange: changedPaths.some(isDatabasePath),
    deliveryInfrastructureChange: changedPaths.some(
      isDeliveryInfrastructurePath
    ),
    deliveryInfrastructureOnly:
      changedPaths.length > 0 &&
      changedPaths.every(isDeliveryInfrastructurePath),
    docsOnly:
      changedPaths.length > 0 && changedPaths.every(isDocumentationPath),
    headSha: input.headSha,
    releaseReadyPaths: changedPaths.filter(isReleaseReadyPath),
    strictRelease: isVersionedReleaseBranch(input.branchName),
  };
  const selectedChecks = [
    check(
      "diff-integrity",
      ["git", "diff", "--check", `${input.baseSha}...${input.headSha}`],
      "Reject whitespace errors in the exact candidate diff."
    ),
  ];
  const skippedChecks = [];

  selectPrimaryChecks(context, selectedChecks, skippedChecks);
  selectIntegrationCheck(context, selectedChecks, skippedChecks);
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
    branchName: input.branchName,
    changedPaths,
    confidence,
    headSha: input.headSha,
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

  if (context.deliveryInfrastructureChange) {
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
      context.deliveryInfrastructureChange
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
  if (context.deliveryInfrastructureOnly) {
    skippedChecks.push(
      skipped(
        "affected-checks-and-unit-tests",
        "Delivery infrastructure is covered by its behavioral contract suite; no product workspace changed."
      )
    );
    return;
  }
  selectedChecks.push(
    check(
      "affected-checks-and-unit-tests",
      ["pnpm", "run", "verify:pr"],
      "Unit tests have independent defect-finding value and the changed workspaces need type and behavior checks."
    )
  );
}

function selectIntegrationCheck(context, selectedChecks, skippedChecks) {
  if (context.confidence === "full") {
    skippedChecks.push(
      skipped(
        "affected-integration-tests",
        "Full repository confidence already includes integration tests."
      )
    );
    return;
  }
  if (!context.boundaryChange) {
    skippedChecks.push(
      skipped(
        "affected-integration-tests",
        "No shared, service, runtime, or persistence boundary changed."
      )
    );
    return;
  }
  selectedChecks.push(
    check(
      "affected-integration-tests",
      [
        "pnpm",
        "run",
        "test:integration:affected",
        "--",
        "--concurrency=1",
        "--output-logs=errors-only",
      ],
      "A shared, service, runtime, or persistence boundary changed."
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

export function assertCandidateSnapshot(snapshot) {
  for (const [name, value] of [
    ["expected head", snapshot.expectedHeadSha],
    ["actual head", snapshot.actualHeadSha],
    ["expected base", snapshot.expectedBaseSha],
    ["pull request base", snapshot.pullRequestBaseSha],
    ["current main", snapshot.currentMainSha],
    ["tree", snapshot.treeSha],
  ]) {
    if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
      throw new Error(`Final Candidate requires an exact ${name} SHA.`);
    }
  }
  if (snapshot.actualHeadSha !== snapshot.expectedHeadSha) {
    throw new Error(
      `Candidate head drifted: expected ${snapshot.expectedHeadSha}, found ${snapshot.actualHeadSha}.`
    );
  }
  if (snapshot.pullRequestHeadSha !== snapshot.expectedHeadSha) {
    throw new Error(
      `Pull request head drifted: expected ${snapshot.expectedHeadSha}, found ${snapshot.pullRequestHeadSha}.`
    );
  }
  if (snapshot.pullRequestBaseSha !== snapshot.expectedBaseSha) {
    throw new Error(
      `Pull request base drifted: expected ${snapshot.expectedBaseSha}, found ${snapshot.pullRequestBaseSha}.`
    );
  }
  if (snapshot.currentMainSha !== snapshot.expectedBaseSha) {
    throw new Error(
      `Main advanced: candidate base ${snapshot.expectedBaseSha}, current main ${snapshot.currentMainSha}. Sync the branch and create a new candidate.`
    );
  }
  if (!snapshot.baseIsAncestorOfHead) {
    throw new Error(
      `Candidate ${snapshot.expectedHeadSha} does not contain current main ${snapshot.expectedBaseSha}. Sync the branch before validation.`
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
    let result;
    try {
      result = dependencies.runCommand(selectedCheck.command);
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
  return DOCUMENT_PATH_PATTERN.test(path);
}

function isChangelogPath(path) {
  return (
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

function isBoundaryPath(path) {
  return BOUNDARY_PREFIXES.some((prefix) => path.startsWith(prefix));
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
