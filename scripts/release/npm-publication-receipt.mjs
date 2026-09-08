import { spawnSync } from "node:child_process";
import process from "node:process";

import { createTrustedGitEnvironment } from "../ci/trusted-git-network.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA = /^[a-f0-9]{40}$/u;
const LINES = /\r?\n/u;
const WHITESPACE = /\s+/u;
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s]+@/giu;

// These immutable refs record submission, not registry availability. Keep them
// across runners so a 404 after an interrupted publish never authorizes a retry.
function receiptRef(input, state) {
  if (!(VERSION.test(input.version) && SHA.test(input.headSha))) {
    throw new Error(
      "npm publication receipt requires an exact version and source SHA."
    );
  }
  if (state !== "attempted" && state !== "accepted") {
    throw new Error("Invalid npm publication receipt state.");
  }
  return `refs/heads/openmeld-npm-publication/${input.version}/${state}`;
}

export function readNpmPublicationReceipt(input) {
  const refs = [receiptRef(input, "attempted"), receiptRef(input, "accepted")];
  const output = git(input, [
    "ls-remote",
    "--refs",
    input.remoteUrl ?? "origin",
    ...refs,
  ]);
  const found = new Set();
  for (const line of output.trim().split(LINES).filter(Boolean)) {
    const [sha, ref] = line.split(WHITESPACE);
    if (!refs.includes(ref) || sha !== input.headSha) {
      throw new Error(
        `npm publication receipt conflicts with source ${input.headSha}; inspect the original release before continuing.`
      );
    }
    found.add(ref);
  }
  if (found.has(refs[1])) {
    return "accepted";
  }
  return found.has(refs[0]) ? "attempted" : null;
}

export function recordNpmPublicationReceipt(input) {
  const ref = receiptRef(input, input.state);
  // The CLI/Core scope lease serializes publishers; create-only also prevents
  // accidentally replacing another source's evidence.
  git(input, [
    "push",
    "--porcelain",
    `--force-with-lease=${ref}:`,
    input.remoteUrl ?? "origin",
    `${input.headSha}:${ref}`,
  ]);
}

function git(input, args) {
  const result = spawnSync("git", args, {
    cwd: input.cwd,
    encoding: "utf8",
    env:
      input.gitEnvironment ??
      createTrustedGitEnvironment(input.env ?? process.env, {
        preserveCredentialConfig: true,
      }),
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.error?.message ?? ""} ${result.stderr ?? ""}`
      .replaceAll(URL_CREDENTIALS, "$1[REDACTED]@")
      .trim();
    throw new Error(
      `Could not ${args[0] === "push" ? "save" : "read"} npm publication receipt: ${detail}. Do not republish until the receipt and npm registry have been checked.`
    );
  }
  return result.stdout;
}
