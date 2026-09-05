import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareUpdate } from "./catalog-update.mjs";
import { publishUpdate } from "./publish-update.mjs";

test("a pushed proposal survives a failed PR request without rewriting the branch", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "openmeld-catalog-publish-"));
  const previousCwd = process.cwd();
  const previousPath = process.env.PATH;
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    const remote = join(temporary, "remote.git");
    const repo = join(temporary, "checkout");
    await mkdir(repo);
    git("init", "--bare", remote);
    process.chdir(repo);
    git("init", "-b", "main");
    git("config", "user.name", "Catalog test");
    git("config", "user.email", "catalog@example.invalid");
    await mkdir("release");
    await mkdir("scripts/model-catalog", { recursive: true });
    await mkdir("dev-tmp/bin", { recursive: true });
    const catalog = {
      schemaVersion: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
      agentControllers: {
        codex: {
          defaultModelId: "existing",
          models: [
            {
              id: "existing",
              displayName: "Existing",
              supportedReasoningLevels: [],
              minCliVersion: null,
              unavailable: false,
            },
          ],
        },
      },
    };
    await writeFile("release/vendor-models.json", JSON.stringify(catalog));
    await writeFile(
      "scripts/model-catalog/sources.json",
      JSON.stringify({ codex: { verification: "Verify account access." } })
    );
    await writeFile(".gitignore", "dev-tmp/\n");
    git("add", ".");
    git("commit", "-m", "test: establish catalog baseline");
    git("remote", "add", "origin", remote);
    git("push", "-u", "origin", "main");
    const result = prepareUpdate({
      catalog,
      controller: "codex",
      sources: [
        {
          url: "https://example.invalid/catalog",
          kind: "official-document",
          data: "Captured evidence",
        },
      ],
      observedAt: "2026-09-05T00:00:00.000Z",
    });
    const output = join(repo, "dev-tmp");
    await writeFile(
      join(output, "catalog.json"),
      JSON.stringify(result.catalog)
    );
    await writeFile(
      join(output, "evidence.json"),
      JSON.stringify(result.evidence)
    );
    await writeFile(
      join(output, "result.json"),
      JSON.stringify({
        controller: "codex",
        fingerprint: result.evidence.fingerprint,
        changed: true,
      })
    );
    // Stub only the GitHub transport. Git commit, push, fetch, and branch recovery
    // run against a real disposable bare remote. gh's selected JSON fields are
    // state/headRefName/url; no provider API response is mocked here.
    await writeFile(
      "dev-tmp/bin/gh",
      `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[1] === 'list') {
  console.log(fs.existsSync('dev-tmp/pr.json') ? fs.readFileSync('dev-tmp/pr.json', 'utf8') : '[]');
} else if (args[1] === 'create') {
  if (!fs.existsSync('dev-tmp/retry')) { fs.writeFileSync('dev-tmp/retry', '1'); process.exit(1); }
  const head = args[args.indexOf('--head') + 1];
  fs.writeFileSync('dev-tmp/pr.json', JSON.stringify([{ state: 'OPEN', headRefName: head, url: 'https://example.invalid/pull/1' }]));
  console.log('https://example.invalid/pull/1');
} else process.exit(2);
`,
      { mode: 0o755 }
    );
    process.env.PATH = `${join(repo, "dev-tmp/bin")}:${previousPath}`;
    await assert.rejects(() => publishUpdate(output));
    const pushed = git("rev-parse", "HEAD");
    git("checkout", "main");
    await publishUpdate(output);
    const pulls = JSON.parse(await readFile("dev-tmp/pr.json", "utf8"));
    assert.equal(
      git("ls-remote", "--heads", "origin", pulls[0].headRefName).split(
        "\t"
      )[0],
      pushed
    );
    await publishUpdate(output);
    assert.equal(git("branch", "--show-current"), "main");
    assert.equal(git("status", "--porcelain"), "");
  } finally {
    process.chdir(previousCwd);
    process.env.PATH = previousPath;
    await rm(temporary, { recursive: true, force: true });
  }
});
