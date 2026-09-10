import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { planPrChecks, runPrChecks } from "./verify-pr.mjs";

test("automatic draft feedback cannot start the full affected lane", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/pr-feedback.yml", import.meta.url),
      "utf8"
    )
  );
  assert.equal(
    workflow.jobs.verify.if,
    "github.event.pull_request.draft == true"
  );
  assert.ok(workflow.on.pull_request.types.includes("converted_to_draft"));
  assert.ok(workflow.on.pull_request.types.includes("ready_for_review"));
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  const runs = workflow.jobs.verify.steps
    .filter((step) => step.run)
    .map((step) => step.run);
  assert.ok(runs.every((command) => command.includes("--feedback")));
});

test("draft feedback checks changed files and related tests without package builds", () => {
  const sources = [
    "clients/web/src/sidebar.tsx",
    "clients/web/src/sidebar.test.tsx",
  ];
  const commands = planPrChecks(sources, {
    feedback: true,
    existingFiles: sources,
    workspaces: [
      {
        directory: "clients/web",
        test: "vitest run --config vitest.config.ts",
      },
    ],
  });
  assert.deepEqual(commands, [
    ["exec", "biome", "check", "--no-errors-on-unmatched", "--", ...sources],
    [
      "--dir",
      "clients/web",
      "exec",
      "vitest",
      "related",
      "--run",
      "--config",
      "vitest.config.ts",
      "--passWithNoTests",
      "src/sidebar.tsx",
      "src/sidebar.test.tsx",
    ],
  ]);
  assert.ok(
    commands.every((args) => !args.includes("scripts/dev/turbo-affected.mjs"))
  );
});

test("deleted files never turn a focused lint command into a repository scan", () => {
  assert.deepEqual(
    planPrChecks(["clients/web/src/deleted.ts"], {
      feedback: true,
      existingFiles: [],
    }),
    []
  );
});

test("draft control feedback runs the owning Node regression tests once", () => {
  const commands = planPrChecks(
    ["scripts/dev/verify-pr.mjs", "scripts/dev/verify-pr.test.mjs"],
    {
      feedback: true,
    }
  );
  assert.deepEqual(commands.at(-1), [
    "exec",
    "node",
    "--test",
    "scripts/dev/verify-pr.test.mjs",
  ]);
  assert.ok(
    commands.every((args) => !args.includes("verify:release-workflows"))
  );
});

test("docs-only draft feedback avoids code, test discovery, and builds", () => {
  assert.deepEqual(planPrChecks(["developing/README.md"], { feedback: true }), [
    ["run", "verify:docs", "--", "--strict"],
  ]);
});

test("draft feedback does not reinterpret composite package test commands", () => {
  const commands = planPrChecks(["services/core/src/index.ts"], {
    feedback: true,
    workspaces: [
      { directory: "services/core", test: "pnpm run test:boundary" },
    ],
  });
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes("biome"));
});

test("documentation and shared skill edits avoid workspace builds and tests", () => {
  assert.deepEqual(
    planPrChecks([
      "developing/engineering/development-workflow.md",
      ".agents/skills/writing-tests/SKILL.md",
    ]),
    [["run", "verify:docs", "--", "--strict"]]
  );
});

test("CI controls select their root tests outside the workspace graph", () => {
  assert.ok(
    planPrChecks(["scripts/ci/final-candidate-policy.mjs"]).some((args) =>
      args.includes("verify:release-workflows")
    )
  );
});

test("shared contracts and SQL migrations retain downstream validation", () => {
  for (const file of [
    "packages/schemas/src/index.ts",
    "packages/db/drizzle/0010.sql",
    "services/core/src/index.ts",
  ]) {
    const commands = planPrChecks([file]);
    assert.equal(commands.length, 2);
    assert.ok(commands[0].includes("check"));
    assert.ok(commands[1].includes("test"));
    assert.ok(commands.every((args) => !args.includes("--changed-only")));
  }
});

test("failed or interrupted checks stop the lane without a green result", () => {
  for (const status of [7, null]) {
    let calls = 0;
    const result = runPrChecks([["first"], ["second"]], () => {
      calls += 1;
      return { status };
    });
    assert.equal(result, status ?? 1);
    assert.equal(calls, 1);
  }
});

test("check completes before tests start and each phase keeps bounded parallelism", () => {
  const executed = [];
  runPrChecks(planPrChecks(["services/core/src/index.ts"]), (_binary, args) => {
    executed.push(args);
    assert.ok(args.includes("--concurrency=2"));
    assert.notEqual(args.includes("check"), args.includes("test"));
    return { status: 0 };
  });
  assert.ok(executed[0].includes("check"));
  assert.ok(executed[1].includes("test"));
});

test("executable files inside documentation or skills are not documentation-only", () => {
  for (const file of [
    "docs/example.ts",
    ".agents/skills/example/scripts/check.mjs",
  ]) {
    assert.ok(planPrChecks([file]).some((args) => args.includes("test")));
  }
});
