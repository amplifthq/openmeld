import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type LocalProjectConnectionIdentity = {
  bindingGeneration: string;
  organizationId: string;
  projectId: string;
  repositoryPath: string;
};

export async function canonicalizeLocalProjectPath(
  path: string
): Promise<string | null> {
  return await realpath(resolve(path)).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
}

export function resolveCanonicalLocalProjectConnection<
  Connection extends LocalProjectConnectionIdentity,
>(
  canonicalPath: string,
  connections: readonly Connection[]
): Connection | null {
  let longestMatch: Connection | null = null;
  for (const connection of connections) {
    if (
      isPathWithin(canonicalPath, connection.repositoryPath) &&
      (longestMatch === null ||
        connection.repositoryPath.length > longestMatch.repositoryPath.length)
    ) {
      longestMatch = connection;
    }
  }
  return longestMatch;
}

export async function resolveLocalProjectConnectionForPath<
  Connection extends LocalProjectConnectionIdentity,
>(input: {
  connections: readonly Connection[];
  organizationId?: string;
  path: string;
}): Promise<Connection | null> {
  const sameLaneConnections =
    input.organizationId === undefined
      ? input.connections
      : input.connections.filter(
          (connection) => connection.organizationId === input.organizationId
        );
  const resolvedPath = resolve(input.path);
  const pathAliases = localPathAliases(resolvedPath);
  const possibleConnections = sameLaneConnections.filter((connection) =>
    pathAliases.some((candidate) =>
      isPathWithin(candidate, connection.repositoryPath)
    )
  );
  if (possibleConnections.length === 0) {
    return null;
  }
  const canonicalPath = await canonicalizeLocalProjectPath(resolvedPath);
  if (canonicalPath === null) {
    return null;
  }
  return resolveCanonicalLocalProjectConnection(
    canonicalPath,
    possibleConnections
  );
}

export function findExactLocalProjectConnection<
  Connection extends LocalProjectConnectionIdentity,
>(input: {
  bindingGeneration?: string;
  canonicalPath?: string;
  connections: readonly Connection[];
  organizationId: string;
  projectId: string;
}): Connection | null {
  return (
    input.connections.find(
      (connection) =>
        connection.organizationId === input.organizationId &&
        connection.projectId === input.projectId &&
        (input.bindingGeneration === undefined ||
          connection.bindingGeneration === input.bindingGeneration) &&
        (input.canonicalPath === undefined ||
          connection.repositoryPath === input.canonicalPath)
    ) ?? null
  );
}

function isPathWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function localPathAliases(path: string): string[] {
  const privatePrefix = `${sep}private`;
  if (path.startsWith(`${privatePrefix}${sep}`)) {
    return [path, path.slice(privatePrefix.length)];
  }
  if (
    [`${sep}etc`, `${sep}tmp`, `${sep}var`].some(
      (root) => path === root || path.startsWith(`${root}${sep}`)
    )
  ) {
    return [path, `${privatePrefix}${path}`];
  }
  return [path];
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code
  );
}
