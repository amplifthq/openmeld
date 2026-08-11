import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const THEME_SOURCE_PATH = "packages/ui/src/styles/globals.css";
const DARK_THEME_COLOR_PATTERN = /const DARK_THEME_COLOR = "[^"]+";/;
const WINDOW_BACKGROUND_PATTERN = /const WINDOW_BACKGROUND = "[^"]+";/;
const WEB_DARK_THEME_EXPECTATION_PATTERN = /\["dark", "#[0-9a-fA-F]{6}"\],/;
const MANIFEST_THEME_COLOR_PATTERN = /"theme_color": "[^"]+"/;
const MANIFEST_BACKGROUND_COLOR_PATTERN = /"background_color": "[^"]+"/;
const DARK_THEME_BLOCK_PATTERN = /\.dark\s*\{(?<body>[\s\S]*?)\n\}/;
const DARK_BACKGROUND_DECLARATION_PATTERN =
  /^\s*--background:\s*(#[0-9a-fA-F]{6});\s*$/gm;
const TARGETS = [
  {
    path: "clients/web/src/routes/__root.tsx",
    update: (contents, color) =>
      replaceExactlyOnce(
        contents,
        DARK_THEME_COLOR_PATTERN,
        `const DARK_THEME_COLOR = "${color}";`,
        "DARK_THEME_COLOR"
      ),
  },
  {
    path: "clients/web/src/routes/__root.test.tsx",
    update: (contents, color) =>
      replaceExactlyOnce(
        contents,
        WEB_DARK_THEME_EXPECTATION_PATTERN,
        `["dark", "${color}"],`,
        "ThemeColorMeta dark expectation"
      ),
  },
  {
    path: "clients/desktop/src/main/main.ts",
    update: (contents, color) =>
      replaceExactlyOnce(
        contents,
        WINDOW_BACKGROUND_PATTERN,
        `const WINDOW_BACKGROUND = "${color}";`,
        "WINDOW_BACKGROUND"
      ),
  },
  ...["manifest.webmanifest", "manifest.json"].map((fileName) => ({
    path: `clients/web/public/${fileName}`,
    update: (contents, color) => {
      const withThemeColor = replaceExactlyOnce(
        contents,
        MANIFEST_THEME_COLOR_PATTERN,
        `"theme_color": "${color}"`,
        `${fileName} theme_color`
      );
      return replaceExactlyOnce(
        withThemeColor,
        MANIFEST_BACKGROUND_COLOR_PATTERN,
        `"background_color": "${color}"`,
        `${fileName} background_color`
      );
    },
  })),
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourcePath = path.join(options.repoRoot, THEME_SOURCE_PATH);
  const source = await readFile(sourcePath, "utf8");
  const darkBackground = readDarkBackground(source);
  const pendingWrites = [];

  for (const target of TARGETS) {
    const targetPath = path.join(options.repoRoot, target.path);
    const current = await readFile(targetPath, "utf8");
    const expected = target.update(current, darkBackground);
    if (current === expected) {
      continue;
    }
    pendingWrites.push({
      contents: expected,
      path: target.path,
      targetPath,
    });
  }

  if (options.check && pendingWrites.length > 0) {
    process.stderr.write(
      [
        `Theme background copies are out of sync with ${THEME_SOURCE_PATH}:`,
        ...pendingWrites.map((pendingWrite) => `- ${pendingWrite.path}`),
        "Run `pnpm sync:theme-background` after changing the shared dark background token.",
        "",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  for (const pendingWrite of pendingWrites) {
    await writeFile(pendingWrite.targetPath, pendingWrite.contents, "utf8");
  }

  const outcome =
    pendingWrites.length === 0
      ? `Theme background copies already match ${darkBackground}.`
      : `Synced ${pendingWrites.length} theme background copies to ${darkBackground}.`;
  process.stdout.write(`${outcome}\n`);
}

function parseArgs(args) {
  let check = false;
  let repoRoot = DEFAULT_REPO_ROOT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--repo-root") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("--repo-root requires a path");
      }
      repoRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { check, repoRoot };
}

function readDarkBackground(contents) {
  const darkBlock = contents.match(DARK_THEME_BLOCK_PATTERN);
  if (!darkBlock?.groups?.body) {
    throw new Error(
      `Cannot find the .dark theme block in ${THEME_SOURCE_PATH}`
    );
  }

  const matches = [
    ...darkBlock.groups.body.matchAll(DARK_BACKGROUND_DECLARATION_PATTERN),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one six-digit hex --background in the .dark theme block, found ${matches.length}`
    );
  }

  return matches[0][1].toLowerCase();
}

function replaceExactlyOnce(contents, pattern, replacement, label) {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
  const matches = [...contents.matchAll(globalPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${label} value, found ${matches.length}`
    );
  }
  return contents.replace(pattern, replacement);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Theme background sync failed: ${message}\n`);
  process.exitCode = 1;
});
