import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import {
  feedbackWorkspaces,
  planPrChecks,
  resolveUnitTestScript,
  runPrChecks,
} from "./verify-pr.mjs";

const CIRCULAR_ALIAS = /Circular test script alias/u;

test("checks signed Skill inputs in feedback and PR validation without checking unrelated edits", () => {
  for (const feedback of [true, false]) {
    for (const [path, selected] of [
      ["release/openmeld-cli-skill/playbooks/agent-onboarding.md", true],
      ["clients/web/public/skills/openmeld-cli/channel.json", true],
      ["scripts/release/cli-skill.mjs", true],
      ["scripts/release/cli-skill-check.mjs", true],
      ["packages/schemas/src/official-cli-skill.ts", true],
      ["packages/schemas/src/index.ts", true],
      ["pnpm-lock.yaml", true],
      ["clients/web/src/sidebar.tsx", false],
      ["developing/engineering/official-cli-skill.md", false],
    ]) {
      const commands = planPrChecks([path], { feedback });
      assert.equal(
        commands.some((args) => args.join(" ") === "run verify:cli-skill"),
        selected,
        path
      );
    }
  }
});

test("automatic draft feedback cannot start the full affected lane", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/pr-feedback.yml", import.meta.url),
      "utf8"
    )
  );
  assert.equal(
    workflow.jobs.shared.if,
    "github.event.pull_request.draft == true"
  );
  assert.equal(workflow.jobs.plan.if, workflow.jobs.shared.if);
  assert.equal(workflow.jobs.workspaces.needs, "plan");
  assert.equal(workflow.jobs.shared.needs, undefined);
  assert.ok(
    workflow.jobs.plan.outputs.workspaces.includes(
      "steps.matrix.outputs.workspaces"
    )
  );
  assert.equal(workflow.jobs.workspaces.strategy["fail-fast"], false);
  assert.ok(
    workflow.jobs.workspaces.strategy.matrix.includes(
      "fromJSON(needs.plan.outputs.workspaces)"
    )
  );
  assert.ok(workflow.on.pull_request.types.includes("converted_to_draft"));
  assert.ok(workflow.on.pull_request.types.includes("ready_for_review"));
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.equal(workflow.name, "Draft PR Checks");
  const shared = workflow.jobs.shared.steps.find(
    (step) => step.name === "Run shared draft checks"
  );
  const workspace = workflow.jobs.workspaces.steps.find(
    (step) => step.name === "Run selected workspace tests"
  );
  assert.ok(shared.run.includes("--feedback --shared"));
  assert.ok(workspace.run.includes("--feedback"));
  assert.ok(
    workflow.jobs.workspaces.env.VERIFY_PR_WORKSPACE.includes(
      "matrix.directory"
    )
  );
  assert.ok(
    workflow.jobs.workspaces.env.VERIFY_PR_SHARD.includes("matrix.shard")
  );
});

test("draft feedback partitions every selected workspace without dropping shared checks", () => {
  const paths = [
    "scripts/dev/verify-pr.test.mjs",
    "clients/web/src/app.tsx",
    "clients/openmeld-cli/src/commands/service.ts",
    "clients/desktop/src/deleted.ts",
  ];
  const existingFiles = paths.slice(0, 3);
  const workspaces = [
    { directory: "clients/web", name: "openmeld-web", test: "vitest run" },
    { directory: "clients/openmeld-cli", name: "openmeld", test: "vitest run" },
    {
      directory: "clients/desktop",
      name: "@openmeld/desktop",
      test: "vitest run",
    },
  ];
  assert.deepEqual(feedbackWorkspaces(paths, workspaces), [
    { directory: "clients/web", label: "clients/web, 1/2", shard: "1/2" },
    { directory: "clients/web", label: "clients/web, 2/2", shard: "2/2" },
    {
      directory: "clients/openmeld-cli",
      label: "clients/openmeld-cli, 1/2",
      shard: "1/2",
    },
    {
      directory: "clients/openmeld-cli",
      label: "clients/openmeld-cli, 2/2",
      shard: "2/2",
    },
    { directory: "clients/desktop", label: "clients/desktop", shard: "" },
  ]);
  const shared = planPrChecks(paths, {
    feedback: true,
    shared: true,
    existingFiles,
    workspaces,
  });
  assert.ok(
    shared.some((args) => args.includes("scripts/dev/verify-pr.test.mjs"))
  );
  assert.ok(shared.some((args) => args.includes("biome")));
  assert.ok(shared.some((args) => args.includes("--filter=openmeld-web^...")));
  assert.ok(shared.some((args) => args.includes("--filter=openmeld^...")));
  assert.ok(!shared.some((args) => args.includes("related")));
  const partitionedTests = [];
  for (const workspace of [
    "clients/web",
    "clients/openmeld-cli",
    "clients/desktop",
  ]) {
    const commands = planPrChecks(paths, {
      feedback: true,
      workspace,
      existingFiles,
      workspaces,
    });
    assert.equal(commands.filter((args) => args.includes("related")).length, 1);
    assert.ok(commands.at(-1).some((arg) => arg.startsWith("src/")));
    assert.ok(!commands.some((args) => args.includes("biome")));
    assert.ok(
      !commands.some((args) => args.includes("scripts/dev/verify-pr.test.mjs"))
    );
    partitionedTests.push(commands.at(-1));
  }
  const originalTests = planPrChecks(paths, {
    feedback: true,
    existingFiles,
    workspaces,
  }).filter((args) => args.includes("related"));
  assert.deepEqual(partitionedTests, originalTests);
  for (const [workspace, shard] of [
    ["clients/web", "1/2"],
    ["clients/web", "2/2"],
    ["clients/openmeld-cli", "1/2"],
    ["clients/openmeld-cli", "2/2"],
  ]) {
    const commands = planPrChecks(paths, {
      feedback: true,
      workspace,
      shard,
      existingFiles,
      workspaces,
    });
    assert.ok(commands.at(-1).includes(`--shard=${shard}`));
  }
  assert.deepEqual(
    feedbackWorkspaces(["developing/README.md"], workspaces),
    []
  );
});

test("Worker changes select the existing Zod contract guard before expensive tests", () => {
  for (const feedback of [true, false]) {
    for (const file of [
      "services/remote-agent/agent-core/session-title.ts",
      "services/core/src/index.ts",
      "packages/schemas/src/index.ts",
      "scripts/cloudflare/worker-zod-import-contract.mjs",
    ]) {
      assert.deepEqual(planPrChecks([file], { feedback })[0], [
        "run",
        "verify:worker-zod-imports",
      ]);
    }
    for (const file of [
      "clients/web/src/index.tsx",
      "developing/README.md",
      "services/core/README.md",
    ]) {
      assert.ok(
        !planPrChecks([file], { feedback }).some((args) =>
          args.includes("verify:worker-zod-imports")
        )
      );
    }
  }
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
      "--maxWorkers=2",
      "--no-file-parallelism",
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
    "--test-concurrency=1",
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

test("unsupported package runners execute their own test command instead of silently skipping", () => {
  const commands = planPrChecks(["services/core/src/index.ts"], {
    feedback: true,
    workspaces: [
      { directory: "services/core", test: "pnpm run test:boundary" },
    ],
  });
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[2], ["--dir", "services/core", "run", "test"]);
  assert.ok(commands[1].includes("biome"));
});

test("isolated plain package tests build their own imported dist", () => {
  const commands = planPrChecks(["runtime/adapters/core/src/index.ts"], {
    feedback: true,
    workspace: "runtime/adapters/core",
    workspaces: [
      {
        directory: "runtime/adapters/core",
        name: "@openmeld/adapter-core",
        test: "node --test test/*.test.js",
      },
    ],
  });
  assert.ok(commands[0].includes("--filter=@openmeld/adapter-core..."));
  assert.deepEqual(commands[1], [
    "--dir",
    "runtime/adapters/core",
    "run",
    "test",
  ]);
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
    const affectedCommands = commands.filter((args) =>
      args.includes("scripts/dev/turbo-affected.mjs")
    );
    assert.equal(affectedCommands.length, 2);
    assert.ok(affectedCommands[0].includes("check"));
    assert.ok(affectedCommands[1].includes("test"));
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
    if (args.includes("verify:worker-zod-imports")) {
      return { status: 0 };
    }
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

test("unit aliases retain package-owned configuration and reject cycles", () => {
  assert.equal(
    resolveUnitTestScript({
      test: "pnpm run test:boundary",
      "test:boundary": "vitest run --config vitest.boundary.config.ts",
    }),
    "vitest run --config vitest.boundary.config.ts"
  );
  assert.throws(
    () => resolveUnitTestScript({ test: "pnpm run test" }),
    CIRCULAR_ALIAS
  );
});

test("focused tests build dependencies once through Turbo, not the changed app", () => {
  const commands = planPrChecks(["clients/web/src/app.tsx"], {
    feedback: true,
    workspaces: [
      { directory: "clients/web", name: "openmeld-web", test: "vitest run" },
    ],
  });
  assert.deepEqual(commands[1], [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=openmeld-web^...",
    "--concurrency=1",
  ]);
  assert.ok(commands[2].includes("related"));
});

test("focused Node tests run after changed workspace dependencies are built", () => {
  const commands = planPrChecks(
    [
      "clients/desktop/src/main/main.ts",
      "scripts/release/desktop-preview.mjs",
      "scripts/release/desktop-preview.test.mjs",
    ],
    {
      feedback: true,
      existingFiles: [
        "clients/desktop/src/main/main.ts",
        "clients/desktop/package.json",
        "scripts/release/desktop-preview.mjs",
        "scripts/release/desktop-preview.test.mjs",
      ],
      workspaces: [
        {
          directory: "clients/desktop",
          name: "@openmeld/desktop",
          test: "vitest run",
        },
      ],
    }
  );
  const buildIndex = commands.findIndex((args) => args.includes("turbo"));
  const nodeTestIndex = commands.findIndex(
    (args) => args.includes("node") && args.includes("--test")
  );
  assert.ok(buildIndex >= 0);
  assert.ok(nodeTestIndex > buildIndex);
});
