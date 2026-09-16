import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  assertPushedObjectsMatchHead,
  parsePushUpdates,
  resolvePrePushReleaseMode,
} from "../release/pre-push-release-ready.mjs";
import { runVerification } from "./verify-pr.mjs";

const ZERO_SHA = /^0+$/u;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function assertCleanPushTree() {
  if (git("status", "--porcelain", "--untracked-files=normal")) {
    throw new Error(
      "Focused pre-push checks require a clean worktree so they test the pushed commit. Commit your work or push from its clean worktree."
    );
  }
}

export function runFocusedPrePush(input, dependencies = {}) {
  const updates = parsePushUpdates(input);
  if (!updates) {
    throw new Error("Cannot validate malformed Git pre-push input.");
  }
  const live = updates.filter((update) => !ZERO_SHA.test(update.localSha));
  if (!live.length || resolvePrePushReleaseMode(input) === "strict") {
    return 0;
  }
  const exactHead = dependencies.assertHead ?? assertPushedObjectsMatchHead;
  const clean = dependencies.assertClean ?? assertCleanPushTree;
  exactHead(input);
  clean();
  const resolveBase =
    dependencies.resolveBase ??
    ((update) => {
      if (!ZERO_SHA.test(update.remoteSha)) {
        try {
          git("merge-base", "--is-ancestor", update.remoteSha, "HEAD");
          return update.remoteSha;
        } catch {
          // First push, rewritten branch, or unavailable remote history: verify
          // the entire branch diff against locally fetched main instead.
        }
      }
      return git("rev-parse", "--verify", "origin/main^{commit}");
    });
  const verify = dependencies.verify ?? runVerification;
  for (const base of new Set(live.map(resolveBase))) {
    const result = verify({ base, feedback: true, committed: true });
    if (result !== 0) {
      return result;
    }
  }
  exactHead(input);
  clean();
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runFocusedPrePush(readFileSync(0, "utf8"));
}
