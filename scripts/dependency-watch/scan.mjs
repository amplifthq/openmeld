import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export const marker = "<!-- openmeld-core-dependency-watch:v1 -->";
export const title = "Core dependency updates to review";

const exactVersion =
  /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Deliberately compare exact registry/lockfile versions, not manifest ranges.
export function versionParts(value) {
  const match = exactVersion.exec(value);
  if (!match) {
    throw new Error(`Unsupported dependency version: ${value}`);
  }
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: Boolean(match[4]),
  };
}

export function updateKind(current, latest) {
  const a = versionParts(current);
  const b = versionParts(latest);
  if (b.prerelease) {
    throw new Error(`Registry latest is not stable: ${latest}`);
  }
  for (const [index, kind] of ["major", "minor", "patch"].entries()) {
    if (b.numbers[index] > a.numbers[index]) {
      return kind;
    }
    if (b.numbers[index] < a.numbers[index]) {
      return null;
    }
  }
  return a.prerelease ? "stable" : null;
}

export function collectCurrent(lock, watch) {
  if (
    String(lock.lockfileVersion) !== "9.0" &&
    String(lock.lockfileVersion) !== "9"
  ) {
    throw new Error("Expected pnpm lockfile format 9.");
  }
  const result = new Map(Object.keys(watch).map((name) => [name, []]));
  for (const [workspace, importer] of Object.entries(lock.importers ?? {})) {
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, entry] of Object.entries(importer[section] ?? {})) {
        if (!result.has(name)) {
          continue;
        }
        const version = entry.version?.split("(")[0];
        versionParts(version);
        result.get(name).push({ workspace, version });
      }
    }
  }
  for (const [name, uses] of result) {
    if (!uses.length) {
      throw new Error(
        `Watched dependency missing from lockfile importers: ${name}`
      );
    }
  }
  return result;
}

export async function scan(lock, watch, fetcher = fetch) {
  const current = collectCurrent(lock, watch);
  const rows = [];
  // Small explicit watchlist; bounded network requests with no package execution.
  for (const [name, uses] of current) {
    const response = await fetcher(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
      {
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!response.ok) {
      throw new Error(`${name}: npm registry returned ${response.status}`);
    }
    const metadata = await response.json();
    if (metadata.name !== name) {
      throw new Error(`${name}: registry package identity mismatch`);
    }
    const latest = metadata.version;
    const versions = [...new Set(uses.map((use) => use.version))].sort();
    const changes = versions
      .map((version) => ({ version, kind: updateKind(version, latest) }))
      .filter((item) => item.kind);
    if (!changes.length) {
      continue;
    }
    rows.push({
      name,
      latest,
      changes,
      uses,
      review: watch[name],
      patched: Object.keys(lock.patchedDependencies ?? {}).some((key) =>
        key.startsWith(`${name}@`)
      ),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function render(rows) {
  const lines = [
    marker,
    "# Core dependency updates",
    "",
    "Stable npm `latest` releases compared with direct workspace resolutions in `pnpm-lock.yaml`.",
    "This is an upgrade review list, not a security audit or a compatibility recommendation.",
    "",
  ];
  if (!rows.length) {
    lines.push(
      "All watched direct dependencies are at or above the current stable `latest` release."
    );
  }
  for (const row of rows) {
    lines.push(
      `## ${row.name}`,
      "",
      `- Available: **${row.latest}** ([npm](https://www.npmjs.com/package/${row.name}/v/${row.latest})).`,
      `- Older installed versions: ${row.changes.map(({ version, kind }) => `${version} → ${row.latest} (${kind})`).join(", ")}.`,
      `- Used in: ${[...new Set(row.uses.map((use) => `\`${use.workspace}\` (${use.version})`))].sort().join(", ")}.`,
      `- Review: ${row.review}${row.patched ? " A pnpm patch is registered; review it before upgrading." : ""}`,
      ""
    );
  }
  lines.push(
    "",
    "Automation changes only this report. Upgrade dependencies in a reviewed PR; no automatic merge, release or deployment.",
    "Unchanged reports are not reposted. Closing this issue acknowledges this snapshot; a changed update list can reopen it."
  );
  return `${lines.join("\n")}\n`;
}

export function publication(existing, body, hasUpdates) {
  if (!existing) {
    return hasUpdates ? "create" : "none";
  }
  if (!hasUpdates) {
    return existing.state === "open" ? "close" : "none";
  }
  if (existing.body === body) {
    return "none";
  }
  return "update";
}

function gh(args) {
  return JSON.parse(
    execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  );
}

async function publish(output, body, hasUpdates) {
  if (
    process.env.GITHUB_REPOSITORY !== "amplifthq/openmeld" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "Report publication is restricted to amplifthq/openmeld main."
    );
  }
  const api = "repos/amplifthq/openmeld/issues";
  const pages = gh([
    "api",
    "--paginate",
    "--slurp",
    `${api}?state=all&creator=github-actions%5Bbot%5D&per_page=100`,
  ]);
  const matches = pages
    .flat()
    .filter(
      (issue) =>
        !issue.pull_request &&
        issue.user.login === "github-actions[bot]" &&
        issue.body?.startsWith(marker)
    );
  if (matches.length > 1) {
    throw new Error(
      "Multiple dependency-watch issues found; refusing an ambiguous update."
    );
  }
  const existing = matches[0];
  const action = publication(existing, body, hasUpdates);
  if (action === "none") {
    return;
  }
  const payload =
    action === "create"
      ? { title, body }
      : { body, state: action === "close" ? "closed" : "open" };
  const input = resolve(output, "issue-payload.json");
  await writeFile(input, JSON.stringify(payload));
  gh([
    "api",
    "--method",
    action === "create" ? "POST" : "PATCH",
    action === "create" ? api : `${api}/${existing.number}`,
    "--input",
    input,
  ]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = resolve("dev-tmp/core-dependency-watch");
  const lock = parse(await readFile("pnpm-lock.yaml", "utf8"));
  const watch = JSON.parse(
    await readFile(new URL("./packages.json", import.meta.url), "utf8")
  );
  const rows = await scan(lock, watch);
  const body = render(rows);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "report.md"), body);
  await writeFile(
    resolve(output, "updates.json"),
    `${JSON.stringify(rows, null, 2)}\n`
  );
  console.log(
    `Checked ${Object.keys(watch).length} packages; ${rows.length} have newer stable releases.`
  );
  if (process.argv.includes("--publish")) {
    await publish(output, body, rows.length > 0);
  }
}
