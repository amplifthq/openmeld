// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone content acceptance command; assertions must exit nonzero.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { llms, loader } from "fumadocs-core/source";

const root = resolve(import.meta.dirname, "../content/docs");
const repo = resolve(import.meta.dirname, "../../..");
const files = [];
const bodies = new Map();
for (const path of await readdir(root, { recursive: true })) {
  if (
    !(
      path.endsWith(".mdx") ||
      path.endsWith("/meta.json") ||
      path === "meta.json"
    )
  ) {
    continue;
  }
  const text = await readFile(resolve(root, path), "utf8");
  if (path.endsWith(".json")) {
    files.push({ type: "meta", path, data: JSON.parse(text) });
  } else {
    // The public content uses flat, single-line title/description frontmatter.
    const title = text.match(/^title: (.+)$/m)?.[1];
    assert.ok(title, `Missing title: ${path}`);
    const description = text.match(/^description: (.+)$/m)?.[1];
    files.push({ type: "page", path, data: { title, description } });
    bodies.set(path, text);
  }
}
const source = loader({ source: { files }, baseUrl: "/docs" });
const tree = source.getPageTree();
assert.deepEqual(
  tree.children
    .filter((node) => node.type === "folder")
    .map((node) => node.name),
  ["Start", "Work", "Understand", "Reference", "Help"]
);
const navigation = [];
function visit(node) {
  if (node.type === "page") {
    navigation.push(node.url);
  }
  if (node.index) {
    visit(node.index);
  }
  for (const child of node.children ?? []) {
    visit(child);
  }
}
visit(tree);
const pages = source.getPages();
assert.equal(
  new Set(navigation).size,
  navigation.length,
  "Duplicate navigation URL"
);
assert.deepEqual(
  [...navigation].sort(),
  pages.map((page) => page.url).sort(),
  "Every page must be reachable in navigation"
);

const urls = new Set(pages.map((page) => page.url));
const links = [];
for (const [path, text] of bodies) {
  for (const match of text.matchAll(/(?:\]\(|href=")((?:\/docs|#)[^\s)"]*)/g)) {
    const url = new URL(
      match[1],
      `https://docs.openmeld.ai${pages.find((page) => page.path === path).url}`
    );
    const target = url.pathname
      .replace(/\.md$/, "")
      .replace(/\/index$/, "")
      .replace(/\/$/, "");
    assert.ok(urls.has(target), `${path}: missing page ${match[1]}`);
    links.push({ path, target, hash: url.hash.slice(1) });
  }
}

const schema = await readFile(
  resolve(repo, "packages/schemas/src/schemas/http/center-agent-routines.ts"),
  "utf8"
);
const statusBlock = schema.match(
  /CENTER_AGENT_ROUTINE_RUN_STATUSES = \[([\s\S]*?)\] as const/
);
assert.ok(statusBlock, "Run status source changed; review the fact-sync check");
const statuses = [...statusBlock[1].matchAll(/"([a-z_]+)"/g)].map(
  (match) => match[1]
);
const table = bodies.get("reference/run-status.mdx");
const rows = [...table.matchAll(/^\| ([^|]+) \| `([a-z_]+)` \|/gm)];
assert.deepEqual(
  rows.map((row) => row[2]).sort(),
  statuses.sort(),
  "Run status reference must cover the schema exactly"
);
const presentation = await readFile(
  resolve(
    repo,
    "clients/web/src/components/routines/routine-run-presentation.tsx"
  ),
  "utf8"
);
for (const row of rows) {
  const label = presentation.match(
    new RegExp(`${row[2]}: \\{[^}]*label: "([^"]+)"`)
  )?.[1];
  assert.equal(row[1].trim(), label, `Run label drift: ${row[2]}`);
}

const origin = process.argv[process.argv.indexOf("--url") + 1];
if (process.argv.includes("--url")) {
  assert.ok(origin?.startsWith("http"), "Supply a local Docs URL");
  const htmlByUrl = new Map();
  for (const page of pages) {
    const html = await fetch(new URL(page.url, origin));
    assert.equal(html.status, 200, page.url);
    htmlByUrl.set(page.url, await html.text());
    const markdownUrl =
      page.url === "/docs" ? "/docs/index.md" : `${page.url}.md`;
    for (const [url, headers] of [
      [markdownUrl, {}],
      [page.url, { Accept: "text/markdown" }],
    ]) {
      const response = await fetch(new URL(url, origin), { headers });
      assert.equal(response.status, 200, url);
      assert.match(
        response.headers.get("content-type") ?? "",
        /text\/markdown/
      );
      assert.ok(
        (await response.text()).includes(page.data.title),
        `Missing Markdown title: ${url}`
      );
    }
  }
  for (const link of links.filter((link) => link.hash)) {
    assert.ok(
      htmlByUrl
        .get(link.target)
        .includes(`id="${decodeURIComponent(link.hash)}"`),
      `${link.path}: missing anchor ${link.target}#${link.hash}`
    );
  }
  const index = await fetch(new URL("/llms.txt", origin));
  assert.equal(index.status, 200);
  assert.equal(
    await index.text(),
    await llms(source).index(),
    "Served LLM index differs from navigation"
  );
  const full = await fetch(new URL("/llms-full.txt", origin));
  assert.equal(full.status, 200);
  const fullText = await full.text();
  for (const page of pages) {
    assert.ok(
      fullText.includes(`# ${page.data.title} (${page.url})`),
      `Missing full-text page: ${page.url}`
    );
  }
  console.log(
    `HTTP: ${pages.length} HTML pages, both Markdown routes, linked anchors, and LLM endpoints passed.`
  );
}
console.log(
  `Content: ${pages.length} pages, ${links.length} local links, five navigation groups, and ${rows.length} Run statuses passed.`
);
