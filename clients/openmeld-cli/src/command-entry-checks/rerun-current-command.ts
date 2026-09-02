import { spawn } from "node:child_process";
import {
  LEGACY_OPENMELD_AGENT_SESSION_ENV_KEY,
  OPENMELD_CLI_CONTEXT_ENV_KEY,
  resolveCliContext,
} from "../config/session-profile";
import { isBinaryDistribution } from "../runtime/distribution";

export function rerunCurrentCommandWithEnv(input: {
  argv: string[];
  env: Record<string, string>;
}): Promise<number> {
  const scriptPath = input.argv[1];
  const binaryDistribution = isBinaryDistribution();
  if (!(binaryDistribution || scriptPath)) {
    return Promise.resolve(1);
  }

  // Node-based installs need their JavaScript entry path. A compiled Bun
  // binary is already the entry program, and argv[1] is Bun's virtual source
  // path (for example /$bunfs/root/openmeld-cli-...). Passing that path back
  // to the upgraded binary turns it into a bogus top-level command.
  const rerunArgs = input.argv.slice(2);
  if (!binaryDistribution && scriptPath) {
    rerunArgs.unshift(scriptPath);
  }

  const cliContext = resolveCliContext();
  const baseEnv = { ...process.env };
  if (cliContext) {
    delete baseEnv[LEGACY_OPENMELD_AGENT_SESSION_ENV_KEY];
    baseEnv[OPENMELD_CLI_CONTEXT_ENV_KEY] = cliContext.cliContextId;
  }
  const childEnv = {
    ...baseEnv,
    ...input.env,
  };
  if (cliContext) {
    delete childEnv[LEGACY_OPENMELD_AGENT_SESSION_ENV_KEY];
    childEnv[OPENMELD_CLI_CONTEXT_ENV_KEY] = cliContext.cliContextId;
  }

  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, rerunArgs, {
      stdio: "inherit",
      env: childEnv,
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}
