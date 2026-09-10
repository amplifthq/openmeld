import assert from "node:assert/strict";
import { test } from "node:test";
import { planPrChecks, runPrChecks } from "./verify-pr.mjs";

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
