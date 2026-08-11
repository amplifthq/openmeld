import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/schemas/types";

export async function createTestNodeScriptLaunchContract(input: {
  home: string;
  scriptName: string;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const scriptsDir = join(input.home, ".openmeld-test-launch");
  await mkdir(scriptsDir, { recursive: true });
  const scriptPath = join(scriptsDir, `${input.scriptName}.mjs`);
  await writeFile(scriptPath, 'console.log("openmeld test launch");\n', "utf8");
  return {
    kind: "node_script",
    nodePath: process.execPath,
    scriptPath,
  };
}
