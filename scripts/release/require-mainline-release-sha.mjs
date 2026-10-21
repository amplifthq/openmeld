import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;

export function requireMainlineReleaseSha(input) {
  const releaseSha = input.releaseSha;
  const mainRef = input.mainRef ?? "refs/remotes/origin/main";
  const cwd = input.cwd ?? process.cwd();
  if (!(releaseSha && FULL_SHA_PATTERN.test(releaseSha))) {
    throw new Error(
      "release_sha must be an exact 40-character lowercase commit SHA."
    );
  }

  const commit = spawnSync(
    "git",
    ["cat-file", "-e", `${releaseSha}^{commit}`],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const mainline = spawnSync("git", ["rev-list", "--first-parent", mainRef], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const verifiedReleaseSha =
    mainline.status === 0
      ? mainline.stdout
          .split(LINE_SPLIT_PATTERN)
          .find((commitSha) => commitSha === releaseSha)
      : undefined;

  if (!(commit.status === 0 && verifiedReleaseSha)) {
    const diagnostics = [commit.stderr.trim(), mainline.stderr.trim()].filter(
      Boolean
    );
    throw new Error(
      [
        "release_sha must identify a commit on the main first-parent chain.",
        ...diagnostics,
      ].join("\n")
    );
  }
  return { mainRef, releaseSha: verifiedReleaseSha };
}

function main(argv) {
  const [releaseSha, mainRef = "refs/remotes/origin/main", outputMode] = argv;
  if (outputMode && outputMode !== "--github-output") {
    throw new Error("Expected --github-output as the optional output mode.");
  }
  const verified = requireMainlineReleaseSha({ mainRef, releaseSha });
  if (outputMode === "--github-output") {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) {
      throw new Error("GITHUB_OUTPUT is required for --github-output.");
    }
    appendFileSync(output, `release_sha=${verified.releaseSha}\n`);
    return;
  }
  process.stdout.write(`${verified.releaseSha}\n`);
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
