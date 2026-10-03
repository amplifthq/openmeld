import { readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VITEST_CONFIG = /^vitest(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/u;
const DEFAULT_VITEST_CONFIG = /^vitest\.config\./u;

function modulePath(file) {
  const normalized = path.resolve(file).split(path.sep).join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function runSelectedTests(workspace, runners, selected) {
  const consumed = new Set();
  for (const { config, runner, specifications } of runners) {
    if (!specifications.length) {
      await runner.close();
      continue;
    }
    console.log(
      `[focused-tests] ${workspace}: ${config ?? "default config"} (${specifications.length} selected files)`
    );
    // Workers pools retain module-level project state. Release each owner before
    // another configuration runs, so their runtime lifetimes never overlap.
    try {
      await runner.init();
      const result = await runner.runTestSpecifications(specifications);
      if (
        result.unhandledErrors.length ||
        result.testModules.some((module) => !module.ok())
      ) {
        throw new Error(
          `Selected tests failed in ${workspace}: ${config ?? "default config"}.`
        );
      }
      for (const module of result.testModules) {
        // A deliberately skipped module was consumed by its owner, not excluded.
        if (!["passed", "skipped"].includes(module.state())) {
          throw new Error(`Selected test ${module.moduleId} did not finish.`);
        }
        consumed.add(modulePath(module.moduleId));
      }
    } finally {
      await runner.close();
    }
  }
  const missing = [...selected].filter((file) => !consumed.has(file));
  if (missing.length) {
    throw new Error(`Selected tests were not consumed: ${missing.join(", ")}`);
  }
}

export async function runFocusedWorkspaceTests(
  workspace,
  files,
  unitCommand = "vitest run"
) {
  const root = realpathSync.native(path.resolve(workspace));
  const selectedPaths = files.map((file) => path.resolve(root, file));
  const selected = new Set(selectedPaths.map(modulePath));
  const require = createRequire(path.join(root, "package.json"));
  const { createVitest, parseCLI } = await import(
    pathToFileURL(require.resolve("vitest/node")).href
  );
  const { options: unitOptions } = parseCLI(unitCommand);
  const configs = [
    ...new Set([
      ...readdirSync(root).filter((file) => VITEST_CONFIG.test(file)),
      ...(unitOptions.config ? [unitOptions.config] : []),
    ]),
  ].sort();
  const runners = [];
  try {
    for (const config of configs.length ? configs : [undefined]) {
      const runner = await createVitest("test", {
        ...(config === unitOptions.config ||
        (!unitOptions.config && DEFAULT_VITEST_CONFIG.test(config ?? ""))
          ? unitOptions
          : {}),
        root,
        config: config ? path.resolve(root, config) : undefined,
        watch: false,
        fileParallelism: false,
        maxWorkers: 2,
      });
      runners.push({ config, runner });
      // File discovery uses the owning include/exclude contract without loading tests.
      const specifications = await runner.globTestSpecifications(
        selectedPaths.map((file) => file.split(path.sep).join("/"))
      );
      runners.at(-1).specifications = specifications.filter((spec) =>
        selected.has(modulePath(spec.moduleId))
      );
    }
    for (const file of selected) {
      const owners = runners.filter(({ specifications }) =>
        specifications.some((spec) => modulePath(spec.moduleId) === file)
      );
      if (!owners.length) {
        throw new Error(
          `Selected test ${file} is excluded by every owning Vitest configuration. Update the package-owned include/exclude contracts.`
        );
      }
    }
    await runSelectedTests(workspace, runners, selected);
  } finally {
    for (const { runner } of runners) {
      await runner.close();
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const [workspace, unitCommand, ...files] = process.argv.slice(2);
  if (workspace && files.length) {
    runFocusedWorkspaceTests(workspace, files, unitCommand).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } else {
    console.error(
      "Usage: run-focused-workspace-tests.mjs <workspace> <unit-command> <selected-test>..."
    );
    process.exitCode = 1;
  }
}
