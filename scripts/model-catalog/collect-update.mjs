import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest, runUpdate } from "./catalog-update.mjs";
import { renderBatchReview } from "./review.mjs";

export function combineUpdates(current, results) {
  const catalog = structuredClone(current);
  for (const result of results) {
    if (result.evidence.changes.length) {
      catalog.agentControllers[result.evidence.controller].models.unshift(
        ...result.evidence.changes.map((change) => change.after)
      );
      catalog.updatedAt = result.evidence.observedAt;
    }
  }
  const evidence = results.map((result) => result.evidence);
  return {
    catalog,
    evidence,
    fingerprint: digest(
      evidence.map(({ controller, fingerprint }) => ({
        controller,
        fingerprint,
      }))
    ),
    changed: results.some((result) => result.changed),
  };
}

export async function collectUpdate(output, root = process.cwd()) {
  const config = JSON.parse(
    await readFile(resolve(root, "scripts/model-catalog/sources.json"), "utf8")
  );
  const current = JSON.parse(
    await readFile(resolve(root, "release/vendor-models.json"), "utf8")
  );
  await mkdir(output, { recursive: true });
  // Preserve every successful controller's artifacts even if another source fails.
  // Publish only a complete run, so a partial scan cannot masquerade as coverage.
  const settled = await Promise.allSettled(
    Object.keys(config).map((controller) =>
      runUpdate({ root, controller, output: resolve(output, controller) })
    )
  );
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${Object.keys(config)[index]}: ${result.reason.message}`]
      : []
  );
  if (failures.length) {
    await writeFile(
      resolve(output, "failures.json"),
      JSON.stringify(failures, null, 2)
    );
    throw new Error(
      `Incomplete collection; no PR published: ${failures.join("; ")}`
    );
  }
  const result = combineUpdates(
    current,
    settled.map((item) => item.value)
  );
  const formatted = execFileSync(
    resolve(root, "node_modules/.bin/biome"),
    ["format", "--stdin-file-path", "release/vendor-models.json"],
    { cwd: root, input: JSON.stringify(result.catalog), encoding: "utf8" }
  );
  await writeFile(resolve(output, "catalog.json"), formatted);
  await writeFile(
    resolve(output, "evidence.json"),
    `${JSON.stringify(result.evidence, null, 2)}\n`
  );
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify({ fingerprint: result.fingerprint, changed: result.changed })
  );
  await writeFile(
    resolve(output, "review.md"),
    renderBatchReview(result.evidence, config, current)
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await collectUpdate(resolve(process.argv[2] ?? "dev-tmp/catalog-update"));
}
