import { spawnSync } from "node:child_process";

const TOOLING_COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export type ToolingCommandRunnerResult = {
  error?: Error;
  stderr: string;
  status: number | null;
  stdout: string;
};

export type ToolingCommandRunner = (input: {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) => ToolingCommandRunnerResult;

export const resolvePnpmCommand = (): string => {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
};

export const defaultToolingCommandRunner: ToolingCommandRunner = (input) => {
  const result = spawnSync(resolvePnpmCommand(), [...input.args], {
    cwd: input.cwd,
    encoding: "utf8",
    env: input.env,
    maxBuffer: TOOLING_COMMAND_MAX_BUFFER_BYTES,
  });
  return {
    error: result.error,
    stderr: result.stderr ?? "",
    status: result.status,
    stdout: result.stdout ?? "",
  };
};

export const normalizeBlockedReason = (
  input: ToolingCommandRunnerResult
): string => {
  const parts = [
    input.error?.message ?? "",
    input.stderr,
    input.stdout,
    input.status === null ? "command exited without a status code" : "",
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return parts.join("\n");
};
