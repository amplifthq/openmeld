#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const FINAL_CANDIDATE_EVIDENCE_VERSION = 5;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const TRAILING_SLASH_PATTERN = /\/$/u;
const POLICY_CHECK = Object.freeze({
  id: "release-branch-policy",
  reason:
    "Reject a premature local-component release stamp before dependency setup.",
});
const SCRIPT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const POLICY_SCRIPT = path.join(
  SCRIPT_ROOT,
  "scripts/release/release-branch-policy.mjs"
);

export function runFinalCandidateReleasePolicy(input) {
  const startedAt = new Date();
  const candidateRoot = path.resolve(input.candidateRoot);
  const command = [
    process.execPath,
    POLICY_SCRIPT,
    input.branchName,
    input.baseSha,
  ];
  let changedPaths = [];
  let result = null;
  try {
    assertInput(input);
    assertCandidateGitFacts(input, candidateRoot);
    changedPaths = readChangedPaths(
      candidateRoot,
      input.baseSha,
      input.headSha
    );
    result = spawnSync(command[0], command.slice(1), {
      cwd: candidateRoot,
      encoding: "utf8",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        String(result.stderr ?? "").trim() ||
          String(result.stdout ?? "").trim() ||
          `Release branch policy exited ${String(result.status)}.`
      );
    }
    process.stdout.write(result.stdout);
  } catch (error) {
    const message = boundedText(
      error instanceof Error ? error.message : String(error)
    );
    writeFailureEvidence({
      changedPaths,
      command,
      error: message,
      finishedAt: new Date(),
      input,
      result,
      startedAt,
    });
    throw new Error(message, { cause: error });
  }
}

function assertInput(input) {
  for (const [name, value] of [
    ["base", input.baseSha],
    ["head", input.headSha],
    ["tree", input.treeSha],
  ]) {
    if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
      throw new Error(
        `Final Candidate release policy requires an exact ${name} SHA.`
      );
    }
  }
  if (!String(input.branchName ?? "").trim()) {
    throw new Error("Final Candidate release policy requires a branch name.");
  }
  if (!REPOSITORY_PATTERN.test(String(input.repository ?? ""))) {
    throw new Error(
      "Final Candidate release policy requires owner/repository."
    );
  }
  if (
    !Number.isInteger(input.pullRequestNumber) ||
    input.pullRequestNumber < 1
  ) {
    throw new Error(
      "Final Candidate release policy requires a positive PR number."
    );
  }
  if (!(input.confidence === "standard" || input.confidence === "full")) {
    throw new Error(
      "Final Candidate release policy requires standard or full confidence."
    );
  }
  const serverUrl = new URL(input.serverUrl);
  if (!(serverUrl.protocol === "https:" || serverUrl.protocol === "http:")) {
    throw new Error(
      "Final Candidate release policy requires an HTTP(S) server URL."
    );
  }
}

function assertCandidateGitFacts(input, candidateRoot) {
  const actualHead = readGit(candidateRoot, ["rev-parse", "HEAD"]);
  const actualTree = readGit(candidateRoot, ["rev-parse", "HEAD^{tree}"]);
  const resolvedBase = readGit(candidateRoot, [
    "rev-parse",
    "--verify",
    `${input.baseSha}^{commit}`,
  ]);
  if (actualHead !== input.headSha || resolvedBase !== input.baseSha) {
    throw new Error(
      `Final Candidate release policy identity mismatch: expected head ${input.headSha} on base ${input.baseSha}, found head ${actualHead} on base ${resolvedBase}.`
    );
  }
  if (actualTree !== input.treeSha) {
    throw new Error(
      `Final Candidate release policy tree mismatch: expected ${input.treeSha}, found ${actualTree}.`
    );
  }
  const ancestry = spawnSync(
    gitBinary(),
    ["merge-base", "--is-ancestor", input.baseSha, input.headSha],
    { cwd: candidateRoot, encoding: "utf8" }
  );
  if (ancestry.status !== 0) {
    throw new Error(
      `Final Candidate release policy could not prove ${input.baseSha} is an ancestor of ${input.headSha}.`
    );
  }
  const dirty = readGit(candidateRoot, ["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      "Final Candidate release policy requires a clean exact candidate checkout."
    );
  }
}

function readChangedPaths(candidateRoot, baseSha, headSha) {
  return readGit(candidateRoot, [
    "diff",
    "--name-only",
    "--no-renames",
    `${baseSha}...${headSha}`,
    "--",
  ])
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)
    .toSorted();
}

function writeFailureEvidence(input) {
  const evidencePath = path.resolve(input.input.evidencePath);
  const commandLogsPath = `${evidencePath}.logs`;
  rmSync(commandLogsPath, { force: true, recursive: true });
  mkdirSync(commandLogsPath, { recursive: true });
  const stdout = boundedText(String(input.result?.stdout ?? ""));
  const stderr = boundedText(
    String(input.result?.stderr ?? "").trim() || input.error
  );
  writeFileSync(
    path.join(commandLogsPath, "release-branch-policy.log"),
    [
      `Command: ${input.command.map((part) => JSON.stringify(part)).join(" ")}`,
      `Exit code: ${String(input.result?.status ?? "not-started")}`,
      "",
      "stdout:",
      stdout,
      "",
      "stderr:",
      stderr,
      "",
    ].join("\n")
  );
  const selectedCheck = { command: input.command, ...POLICY_CHECK };
  const serverUrl = String(input.input.serverUrl).replace(
    TRAILING_SLASH_PATTERN,
    ""
  );
  const evidence = {
    baseSha: input.input.baseSha,
    bootstrapReason: null,
    branchName: input.input.branchName,
    candidateKind: "pull-request",
    changedPaths: input.changedPaths,
    conclusion: "failure",
    confidence: input.input.confidence,
    controlTrust: "current-main",
    error: input.error,
    finishedAt: input.finishedAt.toISOString(),
    headSha: input.input.headSha,
    mode: "remote",
    planSourceSha: input.input.baseSha,
    publicationErrors: [],
    pullRequestNumber: input.input.pullRequestNumber,
    pullRequestUrl: `${serverUrl}/${input.input.repository}/pull/${String(input.input.pullRequestNumber)}`,
    repository: input.input.repository,
    results: [
      {
        ...selectedCheck,
        durationMs: Math.max(
          0,
          input.finishedAt.getTime() - input.startedAt.getTime()
        ),
        execution: { inputFingerprint: null, kind: "executed" },
        exitCode: Number.isInteger(input.result?.status)
          ? input.result.status
          : null,
        spawnError: input.result?.error
          ? boundedText(
              String(input.result.error.message ?? input.result.error)
            )
          : null,
        status: "failed",
        stderrTail: stderr,
        stdoutTail: stdout,
      },
    ],
    riskTags: [],
    schemaVersion: FINAL_CANDIDATE_EVIDENCE_VERSION,
    selectedChecks: [selectedCheck],
    skippedChecks: [],
    startedAt: input.startedAt.toISOString(),
    treeSha: input.input.treeSha,
  };
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function readGit(cwd, args) {
  return execFileSync(gitBinary(), args, { cwd, encoding: "utf8" }).trim();
}

function gitBinary() {
  return process.platform === "win32" ? "git.exe" : "git";
}

function boundedText(value) {
  return String(value).slice(-8192);
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!(option?.startsWith("--") && value)) {
      throw new Error(
        `Invalid Final Candidate release policy option: ${String(option ?? "")}.`
      );
    }
    values.set(option, value);
  }
  return {
    baseSha: values.get("--base"),
    branchName: values.get("--branch"),
    candidateRoot: values.get("--candidate-root"),
    confidence: values.get("--confidence"),
    evidencePath: values.get("--evidence"),
    headSha: values.get("--head"),
    pullRequestNumber: Number.parseInt(values.get("--pr") ?? "", 10),
    repository: values.get("--repository"),
    serverUrl: values.get("--server-url"),
    treeSha: values.get("--tree"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFinalCandidateReleasePolicy(parseOptions(process.argv.slice(2)));
}
