import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, prepareUpdate } from "./catalog-update.mjs";
import { publishUpdate } from "./publish-update.mjs";

test("a pushed proposal survives a failed PR request without rewriting the branch", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "openmeld-catalog-publish-"));
  const previousCwd = process.cwd();
  const previousPath = process.env.PATH;
  const previousGitHubContext = {
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    serverUrl: process.env.GITHUB_SERVER_URL,
  };
  Reflect.deleteProperty(process.env, "GITHUB_REPOSITORY");
  Reflect.deleteProperty(process.env, "GITHUB_RUN_ID");
  Reflect.deleteProperty(process.env, "GITHUB_SERVER_URL");
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
      JSON.stringify([result.evidence])
    );
    await writeFile(
      join(output, "result.json"),
      JSON.stringify({
        controller: "codex",
        fingerprint: digest([
          { controller: "codex", fingerprint: result.evidence.fingerprint },
        ]),
        changed: true,
      })
    );
    // Stub only the GitHub transport. Git commit, push, fetch, and branch recovery
    // run against a real disposable bare remote. The fake PR/comment transport
    // mirrors the fields consumed by the publisher so the open-review refresh
    // path is exercised without touching GitHub.
    await writeFile(
      "dev-tmp/bin/gh",
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const commentsPath = 'dev-tmp/comments.json';
const readComments = () => fs.existsSync(commentsPath) ? JSON.parse(fs.readFileSync(commentsPath, 'utf8')) : [];
const writeComment = (body) => fs.writeFileSync(commentsPath, JSON.stringify([{ id: 7, user: { login: 'github-actions[bot]' }, body }]));
if (args[0] === 'pr' && args[1] === 'list') {
  console.log(fs.existsSync('dev-tmp/pr.json') ? fs.readFileSync('dev-tmp/pr.json', 'utf8') : '[]');
} else if (args[0] === 'pr' && args[1] === 'create') {
  if (!fs.existsSync('dev-tmp/retry')) { fs.writeFileSync('dev-tmp/retry', '1'); process.exit(1); }
  const head = args[args.indexOf('--head') + 1];
  const url = 'https://github.com/example/openmeld/pull/1';
  fs.writeFileSync('dev-tmp/pr.json', JSON.stringify([{ state: 'OPEN', headRefName: head, url }]));
  console.log(url);
} else if (args[0] === 'pr' && args[1] === 'comment') {
  const bodyFile = args[args.indexOf('--body-file') + 1];
  writeComment(fs.readFileSync(bodyFile, 'utf8'));
  console.log('https://github.com/example/openmeld/pull/1#issuecomment-7');
} else if (args[0] === 'api' && args.includes('--paginate')) {
  console.log(JSON.stringify([readComments()]));
} else if (args[0] === 'api' && args.includes('PATCH')) {
  const field = args[args.indexOf('-F') + 1];
  const bodyFile = field.slice('body=@'.length);
  writeComment(fs.readFileSync(bodyFile, 'utf8'));
  console.log('{}');
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
    await assert.rejects(readFile("dev-tmp/comments.json", "utf8"), {
      code: "ENOENT",
    });
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "example/openmeld";
    process.env.GITHUB_RUN_ID = "123";
    await publishUpdate(output);
    const firstComment = JSON.parse(
      await readFile("dev-tmp/comments.json", "utf8")
    )[0];
    assert.ok(firstComment.body.includes("Latest model catalog scan"));
    git("checkout", pulls[0].headRefName);
    await writeFile("reviewer-notes.md", "Reviewer decision in progress.\n");
    git("add", "--", "reviewer-notes.md");
    git("commit", "-m", "docs: record reviewer decision");
    git("push", "origin", `HEAD:refs/heads/${pulls[0].headRefName}`);
    const reviewed = git("rev-parse", "HEAD");
    git("checkout", "main");
    await writeFile(
      join(output, "review.md"),
      "# Model catalog update\n\nSecond scan.\n"
    );
    await publishUpdate(output);
    assert.equal(
      git("ls-remote", "--heads", "origin", pulls[0].headRefName).split(
        "\t"
      )[0],
      reviewed
    );
    const refreshedComment = JSON.parse(
      await readFile("dev-tmp/comments.json", "utf8")
    )[0];
    assert.ok(refreshedComment.body.includes("Second scan."));
    assert.equal(
      JSON.parse(await readFile("dev-tmp/comments.json", "utf8")).length,
      1
    );
  } finally {
    process.chdir(previousCwd);
    process.env.PATH = previousPath;
    for (const [name, value] of [
      ["GITHUB_REPOSITORY", previousGitHubContext.repository],
      ["GITHUB_RUN_ID", previousGitHubContext.runId],
      ["GITHUB_SERVER_URL", previousGitHubContext.serverUrl],
    ]) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
