import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT_MARKERS = [
  "pnpm-workspace.yaml",
  "packages/db/package.json",
  "services/auth/wrangler.jsonc",
] as const;

const isRepoRootDirectoryPath = (candidateDirectoryPath: string): boolean => {
  return REPO_ROOT_MARKERS.every((markerPath) => {
    return fs.existsSync(path.resolve(candidateDirectoryPath, markerPath));
  });
};

const findRepoRootDirectoryPath = (
  startingDirectoryPath: string
): string | null => {
  let candidateDirectoryPath = path.resolve(startingDirectoryPath);
  while (true) {
    if (isRepoRootDirectoryPath(candidateDirectoryPath)) {
      return candidateDirectoryPath;
    }

    const parentDirectoryPath = path.dirname(candidateDirectoryPath);
    if (parentDirectoryPath === candidateDirectoryPath) {
      return null;
    }

    candidateDirectoryPath = parentDirectoryPath;
  }
};

const resolveRepoRootDirectoryPath = (): string => {
  const startingDirectoryPaths = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
  ];
  for (const startingDirectoryPath of startingDirectoryPaths) {
    const repoRootDirectoryPath = findRepoRootDirectoryPath(
      startingDirectoryPath
    );
    if (repoRootDirectoryPath) {
      return repoRootDirectoryPath;
    }
  }

  throw new Error(
    `Unable to resolve the OpenMeld repo root from ${startingDirectoryPaths.join(
      ", "
    )}`
  );
};

const repoRootDirectoryPath = resolveRepoRootDirectoryPath();
const packagesDbDirectoryPath = path.resolve(
  repoRootDirectoryPath,
  "packages/db"
);

export const getPackagesDbDirectoryPath = (): string => {
  return packagesDbDirectoryPath;
};

export const getRepoRootDirectoryPath = (): string => {
  return repoRootDirectoryPath;
};

export const getAuthServiceDirectoryPath = (): string => {
  return path.resolve(repoRootDirectoryPath, "services/auth");
};

export const getAuthSchemaDirectoryPath = (): string => {
  return path.resolve(packagesDbDirectoryPath, "src/auth");
};
