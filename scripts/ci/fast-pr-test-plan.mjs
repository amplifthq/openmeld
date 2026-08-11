import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HEAVY_UNIT_SUITES = [
  {
    config: "vitest.config.ts",
    label: "Web",
    package: "openmeld-web",
    requiresDependencyBuild: false,
    slug: "web",
    shardCount: 3,
  },
  {
    config: "vitest.config.ts",
    label: "CLI",
    package: "openmeld",
    requiresDependencyBuild: true,
    slug: "cli",
    shardCount: 2,
  },
  {
    config: "vitest.boundary.config.ts",
    label: "Core",
    package: "@openmeld/core",
    requiresDependencyBuild: true,
    slug: "core",
    shardCount: 2,
  },
];

const HEAVY_UNIT_PACKAGE_NAMES = new Set(
  HEAVY_UNIT_SUITES.map((suite) => suite.package)
);

export function createFastPrTestPlan(turboDryRun) {
  if (!Array.isArray(turboDryRun?.tasks)) {
    throw new Error("Fast PR test planning requires Turbo dry-run task data.");
  }

  const affectedTestPackages = new Set(
    turboDryRun.tasks
      .filter(
        (task) => task?.task === "test" && typeof task.package === "string"
      )
      .map((task) => task.package)
  );
  const shards = HEAVY_UNIT_SUITES.filter((suite) =>
    affectedTestPackages.has(suite.package)
  ).flatMap((suite) =>
    Array.from({ length: suite.shardCount }, (_, index) => {
      const shardIndex = index + 1;
      return {
        cacheKey: `${suite.slug}-${shardIndex}-of-${suite.shardCount}`,
        config: suite.config,
        name: `${suite.label} ${shardIndex}/${suite.shardCount}`,
        package: suite.package,
        requiresDependencyBuild: suite.requiresDependencyBuild,
        shard: `${shardIndex}/${suite.shardCount}`,
      };
    })
  );

  return {
    hasRemainingTests: [...affectedTestPackages].some(
      (packageName) => !HEAVY_UNIT_PACKAGE_NAMES.has(packageName)
    ),
    shards,
  };
}

function run() {
  const dryRunPath = process.argv[2];
  if (!dryRunPath) {
    throw new Error(
      "Usage: node scripts/ci/fast-pr-test-plan.mjs <turbo-dry-run.json>"
    );
  }

  const plan = createFastPrTestPlan(
    JSON.parse(readFileSync(dryRunPath, "utf8"))
  );
  const output = [
    `has_remaining_tests=${String(plan.hasRemainingTests)}`,
    `has_shards=${String(plan.shards.length > 0)}`,
    `shards=${JSON.stringify(plan.shards)}`,
  ].join("\n");
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    appendFileSync(githubOutputPath, `${output}\n`);
    return;
  }
  process.stdout.write(`${output}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  run();
}
