import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { formatCommand } from "./final-candidate-policy.mjs";

export function printPlan(plan, dirtyPaths) {
  process.stdout.write(
    [
      "Final Candidate plan",
      `Head: ${plan.headSha}`,
      `Base: ${plan.baseSha}`,
      `Tree: ${plan.treeSha}`,
      `Mode: ${plan.mode}`,
      `Candidate kind: ${plan.candidateKind}`,
      `Control trust: ${plan.controlTrust}`,
      `Plan source: ${plan.planSourceSha}`,
      ...(plan.bootstrapReason
        ? [`Bootstrap reason: ${plan.bootstrapReason}`]
        : []),
      `Branch: ${plan.branchName}`,
      `Confidence: ${plan.confidence}`,
      `Risk: ${plan.riskTags.join(", ") || "none"}`,
      "Cost: paid GitHub Actions for ready PRs and explicit retries; selected checks may be high latency.",
      "Use: final merge certification, not development, debugging, or review discovery.",
      "Practical trigger: keep development and batch leaves in draft; ready PRs run automatically. Observe an existing run before requesting a retry.",
      "Changed paths:",
      ...(plan.changedPaths.length > 0
        ? plan.changedPaths.map((candidatePath) => `- ${candidatePath}`)
        : ["- none"]),
      "Selected checks:",
      ...plan.selectedChecks.map(
        (selectedCheck) =>
          `- ${selectedCheck.id}: ${formatCommand(selectedCheck.command)}\n  Why: ${selectedCheck.reason}`
      ),
      "Skipped checks:",
      ...plan.skippedChecks.map(
        (skippedCheck) => `- ${skippedCheck.id}: ${skippedCheck.reason}`
      ),
      ...(dirtyPaths.length > 0
        ? [
            "Uncommitted paths (a run will fail until these are committed or removed):",
            ...dirtyPaths.map((candidatePath) => `- ${candidatePath}`),
          ]
        : []),
      "",
    ].join("\n")
  );
}

export function renderEvidenceSummary(evidence, evidencePath, options = {}) {
  const durationMs = Math.max(
    0,
    Date.parse(evidence.finishedAt) - Date.parse(evidence.startedAt)
  );
  return [
    "## OpenMeld Final Candidate Evidence",
    "",
    `- Candidate validation: **${evidence.conclusion}**`,
    `- Evidence publication: **${resolvePublicationSummary(evidence, options)}**`,
    `- Mode: \`${evidence.mode}\``,
    `- Candidate kind: \`${evidence.candidateKind}\``,
    `- Control trust: \`${evidence.controlTrust}\``,
    `- Head: \`${evidence.headSha ?? "unresolved"}\``,
    `- Base: \`${evidence.baseSha ?? "unresolved"}\``,
    `- Tree: \`${evidence.treeSha ?? "unresolved"}\``,
    `- Plan source: \`${evidence.planSourceSha ?? "unresolved"}\``,
    ...(evidence.bootstrapReason
      ? [`- Bootstrap reason: ${evidence.bootstrapReason}`]
      : []),
    `- Risk: ${evidence.riskTags?.join(", ") || "unresolved"}`,
    `- Duration: ${formatDuration(durationMs)}`,
    `- Evidence file: \`${evidencePath}\``,
    ...(options.commandLogsLocation
      ? [`- Full command logs: ${options.commandLogsLocation}`]
      : []),
    ...(evidence.pullRequestUrl
      ? [`- Pull request: ${evidence.pullRequestUrl}`]
      : []),
    ...(evidence.error ? [`- Error: ${evidence.error}`] : []),
    "",
    "### Checks",
    "",
    ...(evidence.results?.length > 0
      ? evidence.results.flatMap((result) => [
          `- **${result.status}${result.execution.kind === "reused" ? " (reused)" : ""}** \`${formatCommand(result.command)}\` (${formatDuration(result.durationMs)}) — ${result.reason}`,
          ...(result.execution.kind === "reused"
            ? [
                `  Identical task inputs previously passed at \`${shortSha(result.execution.source.headSha)}\` on base \`${shortSha(result.execution.source.baseSha)}\`; original duration ${formatDuration(result.execution.source.durationMs)}.`,
              ]
            : []),
          ...(result.exitCode === null
            ? []
            : [`  Exit code: \`${String(result.exitCode)}\``]),
          ...(result.spawnError ? [`  Spawn error: ${result.spawnError}`] : []),
          ...renderOutputTail("stderr", result.stderrTail),
          ...renderOutputTail("stdout", result.stdoutTail),
        ])
      : ["- No check completed."]),
    "",
    "### Skipped",
    "",
    ...(evidence.skippedChecks?.length > 0
      ? evidence.skippedChecks.map(
          (skippedCheck) => `- \`${skippedCheck.id}\` — ${skippedCheck.reason}`
        )
      : ["- None recorded."]),
    "",
    "### Publication",
    "",
    ...(evidence.publicationErrors.length > 0
      ? evidence.publicationErrors.map(
          (publicationError) =>
            `- **failed** \`${publicationError.operation}\` at ${publicationError.occurredAt}: ${publicationError.message}`
        )
      : [
          "- Pending/final shared evidence publication completed or was not requested.",
        ]),
  ].join("\n");
}

function resolvePublicationSummary(evidence, options) {
  if (evidence.publicationErrors.length > 0) {
    return "failed";
  }
  if (options.finalStatusPending) {
    return "evidence shared; exact commit status follows this comment";
  }
  return "complete";
}

export function writeEvidence(evidencePath, evidence) {
  const parsedEvidence = finalCandidateEvidenceSchema.parse(evidence);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(
    evidencePath,
    `${JSON.stringify(parsedEvidence, null, 2)}\n`,
    "utf8"
  );
}

export function readEvidence(evidencePath) {
  return finalCandidateEvidenceSchema.parse(
    JSON.parse(readFileSync(evidencePath, "utf8"))
  );
}

export function appendWorkflowSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, `${summary}\n`, "utf8");
  }
}

export function resolveEvidencePath(requestedPath, headSha) {
  if (requestedPath) {
    return path.resolve(requestedPath);
  }
  return path.join(
    "dev-tmp",
    `final-candidate-${shortSha(headSha ?? "unresolved")}.json`
  );
}

export function resolveTargetUrl(mode, repository, pullRequestUrl) {
  if (mode === "remote" && process.env.GITHUB_RUN_ID) {
    return `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  }
  return pullRequestUrl;
}

export function summarizeRisk(riskTags) {
  return (riskTags?.join("+") || "candidate").slice(0, 72);
}

export function shortSha(value) {
  return String(value ?? "unresolved").slice(0, 12);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "unknown";
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function renderOutputTail(stream, value) {
  if (!value) {
    return [];
  }
  return [`  ${stream} tail:`, "", "```text", value, "```"];
}
