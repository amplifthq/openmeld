import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION,
  type AgentActivityRouteRegistry,
  agentActivityRouteRegistrySchema,
} from "@openmeld/schemas";
import { withAgentActivityLocalStateLock } from "./local-state-lock";
import { resolveProjectBindingForPath } from "./project-bindings";

const EMPTY_REGISTRY: AgentActivityRouteRegistry = {
  routes: [],
  version: AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION,
};

export function resolveAgentActivityGlobalRootDir(input?: {
  homeDir?: string;
}): string {
  return join(input?.homeDir ?? homedir(), ".config", "openmeld");
}

export async function registerAgentActivityRoute(input: {
  globalRootDir?: string;
  rootDir: string;
}): Promise<void> {
  const globalRootDir =
    input.globalRootDir ?? resolveAgentActivityGlobalRootDir();
  const rootDir = await requireCanonicalRootDir(input.rootDir);
  await withAgentActivityLocalStateLock(
    { rootDir: globalRootDir },
    async () => {
      const registry = await readRegistry(globalRootDir);
      if (registry.routes.some((route) => route.rootDir === rootDir)) {
        return;
      }
      await writeRegistry(globalRootDir, {
        routes: [...registry.routes, { rootDir }].sort((left, right) =>
          left.rootDir.localeCompare(right.rootDir)
        ),
        version: AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION,
      });
    }
  );
}

export async function unregisterAgentActivityRoute(input: {
  globalRootDir?: string;
  onNoRemainingRoutes?: () => Promise<void>;
  rootDir: string;
}): Promise<{ remainingRouteCount: number; removed: boolean }> {
  const globalRootDir =
    input.globalRootDir ?? resolveAgentActivityGlobalRootDir();
  const rootDir = await requireCanonicalRootDir(input.rootDir);
  return await withAgentActivityLocalStateLock(
    { rootDir: globalRootDir },
    async () => {
      const registry = await readRegistry(globalRootDir);
      const routes = registry.routes.filter(
        (route) => route.rootDir !== rootDir
      );
      const removed = routes.length !== registry.routes.length;
      if (removed) {
        await writeRegistry(globalRootDir, {
          routes,
          version: AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION,
        });
      }
      if (routes.length === 0) {
        await input.onNoRemainingRoutes?.();
      }
      return { remainingRouteCount: routes.length, removed };
    }
  );
}

export async function isAgentActivityRouteRegistered(input: {
  globalRootDir?: string;
  rootDir: string;
}): Promise<boolean> {
  const globalRootDir =
    input.globalRootDir ?? resolveAgentActivityGlobalRootDir();
  const rootDir = await requireCanonicalRootDir(input.rootDir);
  const registry = await readRegistry(globalRootDir);
  return registry.routes.some((route) => route.rootDir === rootDir);
}

export async function resolveAgentActivityRouteForPath(input: {
  globalRootDir?: string;
  path: string;
}): Promise<{ rootDir: string } | null> {
  const globalRootDir =
    input.globalRootDir ?? resolveAgentActivityGlobalRootDir();
  const registry = await readRegistry(globalRootDir);
  const matches: string[] = [];
  for (const route of registry.routes) {
    const binding = await resolveProjectBindingForPath({
      path: input.path,
      rootDir: route.rootDir,
    });
    if (binding) {
      matches.push(route.rootDir);
    }
  }
  if (matches.length > 1) {
    throw new Error(
      "Repository is bound in more than one OpenMeld lane; Agent Activity routing is disabled until the duplicate binding is removed."
    );
  }
  const rootDir = matches[0];
  return rootDir ? { rootDir } : null;
}

async function readRegistry(
  globalRootDir: string
): Promise<AgentActivityRouteRegistry> {
  const path = registryPath(globalRootDir);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return EMPTY_REGISTRY;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Agent Activity route registry is invalid: ${path}`, {
      cause: error,
    });
  }
  const result = agentActivityRouteRegistrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agent Activity route registry is invalid: ${path}`, {
      cause: result.error,
    });
  }
  return result.data;
}

async function writeRegistry(
  globalRootDir: string,
  registry: AgentActivityRouteRegistry
): Promise<void> {
  const parsed = agentActivityRouteRegistrySchema.parse(registry);
  const path = registryPath(globalRootDir);
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await chmod(dirname(path), 0o700);
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function requireCanonicalRootDir(value: string): Promise<string> {
  if (!isAbsolute(value)) {
    throw new Error("Agent Activity route root must be absolute.");
  }
  return await canonicalizePath(resolve(value));
}

async function canonicalizePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  }
  const parent = dirname(path);
  if (parent === path) {
    return path;
  }
  return join(await canonicalizePath(parent), basename(path));
}

function registryPath(globalRootDir: string): string {
  return join(globalRootDir, "agent-activity", "routes.json");
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code
  );
}
