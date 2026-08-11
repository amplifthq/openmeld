import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "scripts/ui/sync-theme-background.mjs"
);
const DRIFT_ERROR_PATTERN = /theme background copies are out of sync/i;
const SYNC_FAILURE_PATTERN = /expected exactly one manifest\.json theme_color/i;
const WEB_THEME_COLOR_PATTERN = /const DARK_THEME_COLOR = "#111110";/;
const ORIGINAL_WEB_THEME_COLOR_PATTERN = /const DARK_THEME_COLOR = "#050607";/;
const DESKTOP_BACKGROUND_PATTERN = /const WINDOW_BACKGROUND = "#111110";/;
const WEB_THEME_EXPECTATION_PATTERN = /\["dark", "#111110"\],/;
const DARK_THEME_BLOCK_PATTERN = /\.dark\s*\{(?<body>[\s\S]*?)\n\}/;
const DARK_SURFACE_ALIASES = ["card", "popover", "sidebar"];

test("keeps dark semantic surfaces on the canonical first surface", async () => {
  const globalStyles = await readFile(
    path.join(REPO_ROOT, "packages/ui/src/styles/globals.css"),
    "utf8"
  );
  const darkThemeBlock = globalStyles.match(DARK_THEME_BLOCK_PATTERN);

  assert.ok(darkThemeBlock?.groups?.body, "Expected one .dark theme block");
  for (const token of DARK_SURFACE_ALIASES) {
    assert.match(
      darkThemeBlock.groups.body,
      new RegExp(`^\\s*--${token}:\\s*var\\(--surface-1\\);\\s*$`, "m")
    );
  }
});

test("syncs platform chrome colors from the shared dark background token", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-theme-background-")
  );

  try {
    await writeFixture(fixtureRoot);

    const driftCheck = runSync(fixtureRoot, "--check");
    assert.equal(driftCheck.status, 1);
    assert.match(driftCheck.stderr, DRIFT_ERROR_PATTERN);

    const sync = runSync(fixtureRoot);
    assert.equal(sync.status, 0, sync.stderr);

    assert.match(
      await readFixture(fixtureRoot, "clients/web/src/routes/__root.tsx"),
      WEB_THEME_COLOR_PATTERN
    );
    assert.match(
      await readFixture(fixtureRoot, "clients/web/src/routes/__root.test.tsx"),
      WEB_THEME_EXPECTATION_PATTERN
    );
    assert.match(
      await readFixture(fixtureRoot, "clients/desktop/src/main/main.ts"),
      DESKTOP_BACKGROUND_PATTERN
    );

    for (const manifestPath of [
      "clients/web/public/manifest.webmanifest",
      "clients/web/public/manifest.json",
    ]) {
      const manifest = JSON.parse(await readFixture(fixtureRoot, manifestPath));
      assert.equal(manifest.theme_color, "#111110");
      assert.equal(manifest.background_color, "#111110");
    }

    const alignedCheck = runSync(fixtureRoot, "--check");
    assert.equal(alignedCheck.status, 0, alignedCheck.stderr);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("does not write any platform copy when a later target is invalid", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "openmeld-theme-background-")
  );

  try {
    await writeFixture(fixtureRoot);
    await writeFile(
      path.join(fixtureRoot, "clients/web/public/manifest.json"),
      "{}\n",
      "utf8"
    );

    const sync = runSync(fixtureRoot);

    assert.equal(sync.status, 1);
    assert.match(sync.stderr, SYNC_FAILURE_PATTERN);
    assert.match(
      await readFixture(fixtureRoot, "clients/web/src/routes/__root.tsx"),
      ORIGINAL_WEB_THEME_COLOR_PATTERN
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

function runSync(fixtureRoot, ...args) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--repo-root", fixtureRoot, ...args],
    {
      encoding: "utf8",
    }
  );
}

async function writeFixture(fixtureRoot) {
  const files = new Map([
    [
      "packages/ui/src/styles/globals.css",
      ".dark {\n  --background: #111110;\n}\n",
    ],
    [
      "clients/web/src/routes/__root.tsx",
      'const DARK_THEME_COLOR = "#050607";\n',
    ],
    [
      "clients/web/src/routes/__root.test.tsx",
      'const expectations = [["dark", "#050607"], ["light", "#ffffff"]];\n',
    ],
    [
      "clients/desktop/src/main/main.ts",
      'const WINDOW_BACKGROUND = "#0a0a0a";\n',
    ],
    [
      "clients/web/public/manifest.webmanifest",
      `${JSON.stringify(
        {
          name: "OpenMeld",
          theme_color: "#050607",
          background_color: "#050607",
        },
        null,
        2
      )}\n`,
    ],
    [
      "clients/web/public/manifest.json",
      `${JSON.stringify(
        {
          name: "OpenMeld",
          theme_color: "#050607",
          background_color: "#050607",
        },
        null,
        2
      )}\n`,
    ],
  ]);

  for (const [relativePath, contents] of files) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
}

async function readFixture(fixtureRoot, relativePath) {
  return await readFile(path.join(fixtureRoot, relativePath), "utf8");
}
