import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildChangelog,
  ChangelogError,
  checkChangelog,
} from "./changelog.mjs";

const createFixture = () => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "openmeld-changelog-"));
  mkdirSync(path.join(rootDirectory, "changelog", "entries"), {
    recursive: true,
  });
  return rootDirectory;
};

const writeEntry = (rootDirectory, id, contents) => {
  writeFileSync(
    path.join(rootDirectory, "changelog", "entries", `${id}.md`),
    contents
  );
};

const entry = ({
  id,
  title = "A useful change",
  kind = "new",
  areas = '["web"]',
  audiences = '["members"]',
  publishedAt,
  release,
  evidence,
  body = "People can now complete a useful workflow.",
}) => `---
id: ${id}
title: ${title}
kind: ${kind}
areas: ${areas}
audiences: ${audiences}${publishedAt ? `\npublishedAt: ${publishedAt}` : ""}${release ? `\nrelease: ${release}` : ""}${evidence ? `\nevidence: ${evidence}` : ""}
---

${body}
`;

test("builds deterministic human, machine, and release projections", () => {
  const rootDirectory = createFixture();
  try {
    writeEntry(
      rootDirectory,
      "older-change",
      entry({
        id: "older-change",
        title: "Older backfilled change",
        kind: "fixed",
        publishedAt: "2025-11-02",
        release: "desktop/v1.0.0",
        evidence: '["tag:desktop/v1.0.0", "commit:abcdef0"]',
      })
    );
    writeEntry(
      rootDirectory,
      "newer-change",
      entry({
        id: "newer-change",
        title: "Newer continuous change",
        publishedAt: "2026-08-17",
        evidence: '["pr:72", "workflow:123"]',
      })
    );
    writeEntry(
      rootDirectory,
      "unreleased-draft",
      entry({ id: "unreleased-draft", title: "Unreleased draft" })
    );

    const firstResult = buildChangelog(rootDirectory);
    const firstChangelog = readFileSync(
      path.join(rootDirectory, "CHANGELOG.md"),
      "utf8"
    );
    const firstIndex = readFileSync(
      path.join(rootDirectory, "changelog", "index.json"),
      "utf8"
    );
    const firstRelease = readFileSync(
      path.join(rootDirectory, "changelog", "releases", "desktop%2Fv1.0.0.md"),
      "utf8"
    );

    assert.deepEqual(firstResult, { draftCount: 1, publishedCount: 2 });
    assert.ok(
      firstChangelog.indexOf("Newer continuous change") <
        firstChangelog.indexOf("Older backfilled change")
    );
    assert.ok(!firstChangelog.includes("Unreleased draft"));
    assert.equal(JSON.parse(firstIndex).schemaVersion, 1);
    assert.deepEqual(
      JSON.parse(firstIndex).entries.map((item) => item.id),
      ["newer-change", "older-change"]
    );
    assert.ok(firstRelease.includes("# desktop/v1.0.0"));
    assert.ok(firstRelease.includes("Older backfilled change"));

    buildChangelog(rootDirectory);
    assert.equal(
      readFileSync(path.join(rootDirectory, "CHANGELOG.md"), "utf8"),
      firstChangelog
    );
    assert.equal(
      readFileSync(path.join(rootDirectory, "changelog", "index.json"), "utf8"),
      firstIndex
    );
    assert.doesNotThrow(() => checkChangelog(rootDirectory));
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
});

test("detects stale and unexpected generated files", () => {
  const rootDirectory = createFixture();
  try {
    writeEntry(
      rootDirectory,
      "published-change",
      entry({
        id: "published-change",
        publishedAt: "2026-08-17",
        release: "v1.0.0",
        evidence: '["tag:v1.0.0"]',
      })
    );
    buildChangelog(rootDirectory);
    writeFileSync(path.join(rootDirectory, "CHANGELOG.md"), "stale\n");
    writeFileSync(
      path.join(rootDirectory, "changelog", "releases", "old.md"),
      "unexpected\n"
    );

    assert.throws(
      () => checkChangelog(rootDirectory),
      (error) =>
        error instanceof ChangelogError &&
        error.message.includes("CHANGELOG.md: generated file is stale") &&
        error.message.includes(
          "changelog/releases/old.md: generated file is unexpected"
        )
    );

    buildChangelog(rootDirectory);
    assert.doesNotThrow(() => checkChangelog(rootDirectory));
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
});

test("rejects unsupported publication claims", () => {
  const rootDirectory = createFixture();
  try {
    writeEntry(
      rootDirectory,
      "missing-evidence",
      entry({ id: "missing-evidence", publishedAt: "2026-08-17" })
    );
    writeEntry(
      rootDirectory,
      "premature-release",
      entry({ id: "premature-release", release: "v1.0.0" })
    );

    assert.throws(
      () => buildChangelog(rootDirectory),
      (error) =>
        error instanceof ChangelogError &&
        error.message.includes("a published entry requires evidence") &&
        error.message.includes("release requires publishedAt")
    );
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
});

test("rejects filename drift and conflicting dates within one release", () => {
  const rootDirectory = createFixture();
  try {
    writeEntry(
      rootDirectory,
      "wrong-filename",
      entry({
        id: "first-release-change",
        publishedAt: "2026-08-16",
        release: "v2.0.0",
        evidence: '["tag:v2.0.0"]',
      })
    );
    writeEntry(
      rootDirectory,
      "second-release-change",
      entry({
        id: "second-release-change",
        publishedAt: "2026-08-17",
        release: "v2.0.0",
        evidence: '["tag:v2.0.0"]',
      })
    );

    assert.throws(
      () => buildChangelog(rootDirectory),
      (error) =>
        error instanceof ChangelogError &&
        error.message.includes("must match filename wrong-filename.md") &&
        error.message.includes("release v2.0.0 already uses publishedAt")
    );
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
});

test("rejects ambiguous YAML instead of silently choosing a duplicate field", () => {
  const rootDirectory = createFixture();
  try {
    writeEntry(
      rootDirectory,
      "duplicate-id",
      `---
id: duplicate-id
id: silently-replaced
title: A useful change
kind: new
areas: ["web"]
audiences: ["members"]
---

People can now complete a useful workflow.
`
    );

    assert.throws(
      () => buildChangelog(rootDirectory),
      (error) =>
        error instanceof ChangelogError &&
        error.message.includes("Map keys must be unique")
    );
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
});
