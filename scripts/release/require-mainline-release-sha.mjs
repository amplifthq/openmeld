import { spawnSync } from "node:child_process";

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const [releaseSha, mainRef = "refs/remotes/origin/main"] =
  process.argv.slice(2);

if (!(releaseSha && FULL_SHA_PATTERN.test(releaseSha))) {
  process.stderr.write(
    "release_sha must be an exact 40-character lowercase commit SHA.\n"
  );
  process.exit(1);
}

const gitSucceeds = (...args) =>
  spawnSync("git", args, { stdio: "ignore" }).status === 0;

const mainline = spawnSync("git", ["rev-list", "--first-parent", mainRef], {
  encoding: "utf8",
});
const releaseIsOnMainline =
  mainline.status === 0 &&
  mainline.stdout.split(/\r?\n/u).some((commitSha) => commitSha === releaseSha);

if (
  !(
    gitSucceeds("cat-file", "-e", `${releaseSha}^{commit}`) &&
    releaseIsOnMainline
  )
) {
  process.stderr.write(
    "release_sha must identify a commit on the main first-parent chain.\n"
  );
  process.exit(1);
}
