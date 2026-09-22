import { pathToFileURL } from "node:url";
import { runOwnedCommand } from "../dev/owned-command.mjs";

const CLI_SKILL_TEST_STEPS = [
  ["pnpm", ["exec", "turbo", "run", "build", "--filter=openmeld^..."]],
  [
    "pnpm",
    [
      "--dir",
      "clients/openmeld-cli",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "tests/official-cli-skill.integration.test.ts",
    ],
  ],
];

export async function testCliSkill(input = {}) {
  const run = input.run ?? runOwnedCommand;
  for (const [command, args] of CLI_SKILL_TEST_STEPS) {
    const status = await run(command, args, {
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? process.env,
    });
    if (status !== 0) {
      throw new Error(
        "Official CLI Skill tests failed. Inspect the dependency build or focused test output above."
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  testCliSkill().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
