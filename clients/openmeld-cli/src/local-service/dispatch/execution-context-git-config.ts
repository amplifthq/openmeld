import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod/v4";

const entries = z.record(z.string(), z.array(z.string()));
export const executionContextGitConfigBaselineSchema = z.strictObject({
  common: entries,
  worktree: entries,
});
export type ExecutionContextGitConfigBaseline = z.infer<
  typeof executionContextGitConfigBaselineSchema
>;
export type ExecutionContextGitConfigAudit = {
  restoredSettings: number;
  declaredHookInstallers: number;
  unverifiedHookSettings: number;
};
type RunGit = (cwd: string, args: string[]) => Promise<string>;

const EXECUTABLE_KEY =
  /^(?:core\.(?:fsmonitor|hooksPath|sshCommand|worktree|pager|editor)|filter\..+|.+\.textconv|diff\..+\.command|credential\.helper|include\.path|includeIf\..+\.path|sequence\.editor|gpg\..*program|uploadpack\.packObjectsHook)$/iu;
const HOOK_INSTALLER = /\b(?:husky|lefthook)\b/u;

function executableSetting(key: string, values: string[]): boolean {
  return (
    EXECUTABLE_KEY.test(key) ||
    (key.toLowerCase().startsWith("alias.") &&
      values.some((value) => value.trimStart().startsWith("!")))
  );
}

async function readConfig(
  path: string,
  run: RunGit
): Promise<Record<string, string[]>> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!info) {
    return {};
  }
  if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024) {
    throw new Error("execution_context.workspace_git_config_invalid");
  }
  const output = await run(dirname(path), [
    "config",
    "--file",
    path,
    "--no-includes",
    "--null",
    "--list",
  ]);
  const result: Record<string, string[]> = {};
  for (const field of output.split("\0")) {
    if (!field) {
      continue;
    }
    const separator = field.indexOf("\n");
    const key = (
      separator < 0 ? field : field.slice(0, separator)
    ).toLowerCase();
    const value = separator < 0 ? "" : field.slice(separator + 1);
    result[key] ??= [];
    result[key].push(value);
  }
  return result;
}

function configPaths(root: string): { common: string; worktree: string } {
  return {
    common: join(root, "repository.git/config"),
    worktree: join(root, "repository.git/worktrees/worktree/config.worktree"),
  };
}

export async function captureExecutionContextGitConfig(
  root: string,
  run: RunGit
): Promise<ExecutionContextGitConfigBaseline> {
  const paths = configPaths(root);
  const result = {
    common: await readConfig(paths.common, run),
    worktree: await readConfig(paths.worktree, run),
  };
  for (const group of Object.values(result)) {
    for (const [key, values] of Object.entries(group)) {
      if (!executableSetting(key, values)) {
        delete group[key];
      }
    }
  }
  return result;
}

function baselinePath(ledgerRoot: string, contextId: string): string {
  if (!z.uuid().safeParse(contextId).success) {
    throw new Error("execution_context.workspace_identity_mismatch");
  }
  return join(
    ledgerRoot,
    "execution-context-git-config-baselines",
    `${contextId}.json`
  );
}

export async function saveExecutionContextGitConfigBaseline(
  ledgerRoot: string,
  contextId: string,
  baseline: ExecutionContextGitConfigBaseline
): Promise<void> {
  const path = baselinePath(ledgerRoot, contextId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(baseline), "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function readExecutionContextGitConfigBaseline(
  ledgerRoot: string,
  contextId: string
): Promise<ExecutionContextGitConfigBaseline> {
  const path = baselinePath(ledgerRoot, contextId);
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size > 256 * 1024) {
    throw new Error("execution_context.workspace_git_config_baseline_invalid");
  }
  return executionContextGitConfigBaselineSchema.parse(
    JSON.parse(await readFile(path, "utf8"))
  );
}

async function isDeclaredHookInstaller(
  worktree: string,
  value: string,
  run: RunGit
): Promise<boolean> {
  const path = resolve(worktree, value);
  const child = relative(worktree, path);
  if (
    !child ||
    isAbsolute(child) ||
    child === ".." ||
    child.startsWith(`..${sep}`)
  ) {
    return false;
  }
  const canonical = await realpath(path).catch(() => null);
  if (!canonical || canonical !== path) {
    return false;
  }
  // Only committed declarations count as a known installer. An uncommitted
  // package script or directory does not make a task-authored command trusted.
  const packageText = await run(worktree, ["show", "HEAD:package.json"]).catch(
    () => null
  );
  if (!packageText) {
    return false;
  }
  let packageValue: unknown;
  try {
    packageValue = JSON.parse(packageText);
  } catch {
    return false;
  }
  const parsed = z
    .object({ scripts: z.record(z.string(), z.string()).optional() })
    .safeParse(packageValue);
  if (
    !(
      parsed.success &&
      Object.values(parsed.data.scripts ?? {}).some((script) =>
        HOOK_INSTALLER.test(script)
      )
    )
  ) {
    return false;
  }
  const tracked = await run(worktree, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    child.split(sep)[0] ?? child,
  ]);
  return tracked.length > 0;
}

async function restoreSetting(input: {
  run: RunGit;
  worktree: string;
  path: string;
  key: string;
  values: string[];
}): Promise<void> {
  try {
    await input.run(input.worktree, [
      "config",
      "--file",
      input.path,
      "--unset-all",
      input.key,
    ]);
    for (const value of input.values) {
      await input.run(input.worktree, [
        "config",
        "--file",
        input.path,
        "--add",
        input.key,
        value,
      ]);
    }
  } catch {
    throw new Error("execution_context.workspace_git_config_audit_failed");
  }
}

export async function auditExecutionContextGitConfig(input: {
  root: string;
  baseline: ExecutionContextGitConfigBaseline;
  run: RunGit;
}): Promise<ExecutionContextGitConfigAudit> {
  const audit = {
    restoredSettings: 0,
    declaredHookInstallers: 0,
    unverifiedHookSettings: 0,
  };
  const worktree = join(input.root, "worktree");
  const paths = configPaths(input.root);
  for (const group of ["common", "worktree"] as const) {
    const path = paths[group];
    const current = await readConfig(path, input.run);
    for (const [key, values] of Object.entries(current)) {
      if (
        !executableSetting(key, values) ||
        JSON.stringify(values) === JSON.stringify(input.baseline[group][key])
      ) {
        continue;
      }
      if (key === "core.hookspath") {
        if (
          await isDeclaredHookInstaller(
            worktree,
            values.at(-1) ?? "",
            input.run
          )
        ) {
          audit.declaredHookInstallers += 1;
        } else {
          audit.unverifiedHookSettings += 1;
        }
        continue;
      }
      await restoreSetting({
        run: input.run,
        worktree,
        path,
        key,
        values: input.baseline[group][key] ?? [],
      });
      audit.restoredSettings += 1;
    }
  }
  return audit;
}
