import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCliSkill } from "./cli-skill.mjs";

const IMMUTABLE_REVISION_FAILURE = /Published Skill revision 1 is immutable/u;
const TRUSTED_HISTORY_FAILURE =
  /Published Skill revision 1 cannot be changed or removed/u;
const INVALID_TRUSTED_ARCHIVE_FAILURE = /is not valid JSON/u;
const REMOVED_DELIVERY_FAILURE = /delivery cannot be removed/u;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("rejects mutation or deletion of every archived signed revision", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-cli-skill-"));
  try {
    await cp(
      join(REPO_ROOT, "release/openmeld-cli-skill"),
      join(fixtureRoot, "release/openmeld-cli-skill"),
      { recursive: true }
    );
    await cp(
      join(REPO_ROOT, "clients/web/public/skills/openmeld-cli"),
      join(fixtureRoot, "clients/web/public/skills/openmeld-cli"),
      { recursive: true }
    );
    const archivePath = join(
      fixtureRoot,
      "clients/web/public/skills/openmeld-cli/archive.json"
    );
    const trustedChannel = JSON.parse(
      await readFile(
        join(REPO_ROOT, "clients/web/public/skills/openmeld-cli/channel.json"),
        "utf8"
      )
    );
    await writeFile(
      archivePath,
      `${JSON.stringify(trustedChannel, null, 2)}\n`
    );
    const run = () =>
      runCliSkill({
        mode: "check",
        root: fixtureRoot,
        trustedReleases: trustedChannel.releases,
      });
    const historicalEntry = join(
      fixtureRoot,
      "clients/web/public/skills/openmeld-cli/releases/1/SKILL.md"
    );
    const original = await readFile(historicalEntry, "utf8");

    await run();
    await writeFile(historicalEntry, `${original}\nchanged\n`);
    await assert.rejects(run(), IMMUTABLE_REVISION_FAILURE);
    await writeFile(historicalEntry, original);
    await unlink(historicalEntry);
    await assert.rejects(run(), IMMUTABLE_REVISION_FAILURE);
    await writeFile(historicalEntry, original);
    await writeFile(
      archivePath,
      `${JSON.stringify(
        {
          ...trustedChannel,
          releases: trustedChannel.releases.filter(
            (release) => JSON.parse(release.payload).revision !== 1
          ),
        },
        null,
        2
      )}\n`
    );
    await rm(dirname(historicalEntry), { force: true, recursive: true });
    await assert.rejects(run(), TRUSTED_HISTORY_FAILURE);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("does not fall back to the channel when the trusted archive is corrupt", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openmeld-cli-skill-base-"));
  try {
    await cp(
      join(REPO_ROOT, "release/openmeld-cli-skill"),
      join(fixtureRoot, "release/openmeld-cli-skill"),
      { recursive: true }
    );
    await cp(
      join(REPO_ROOT, "clients/web/public/skills/openmeld-cli"),
      join(fixtureRoot, "clients/web/public/skills/openmeld-cli"),
      { recursive: true }
    );
    const archivePath = join(
      fixtureRoot,
      "clients/web/public/skills/openmeld-cli/archive.json"
    );
    const validArchive = await readFile(archivePath, "utf8");
    await writeFile(archivePath, "{not-json\n");
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_EMAIL: "test@openmeld.local",
      GIT_AUTHOR_NAME: "OpenMeld Test",
      GIT_COMMITTER_EMAIL: "test@openmeld.local",
      GIT_COMMITTER_NAME: "OpenMeld Test",
    };
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: gitEnv,
      }).trim();
    git("init", "--quiet");
    git("add", ".");
    git("commit", "--quiet", "-m", "seed corrupt trusted archive");
    const base = git("rev-parse", "HEAD");
    await writeFile(archivePath, validArchive);

    await assert.rejects(
      runCliSkill({
        env: { ...process.env, OPENMELD_AFFECTED_BASE: base },
        mode: "check",
        root: fixtureRoot,
      }),
      INVALID_TRUSTED_ARCHIVE_FAILURE
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "restore trusted archive");
    const validBase = git("rev-parse", "HEAD");
    await rm(join(fixtureRoot, "release/openmeld-cli-skill"), {
      recursive: true,
    });
    await rm(join(fixtureRoot, "clients/web/public/skills/openmeld-cli"), {
      recursive: true,
    });
    await assert.rejects(
      runCliSkill({
        env: { ...process.env, OPENMELD_AFFECTED_BASE: validBase },
        mode: "check",
        root: fixtureRoot,
      }),
      REMOVED_DELIVERY_FAILURE
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});
