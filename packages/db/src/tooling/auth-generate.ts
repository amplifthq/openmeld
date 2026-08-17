import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  AUTH_DB_BETTER_AUTH_CONFIG_PATH,
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
} from "../auth/fact-metadata.ts";
import {
  getPackagesDbDirectoryPath,
  getRepoRootDirectoryPath,
} from "../auth/paths.ts";
import { applyAuthSchemaCustomizations } from "./auth-schema-customizations.ts";

const loadRepoEnvFile = (): void => {
  const processWithLoadEnvFile = process as typeof process & {
    loadEnvFile?: (filePath?: string) => void;
  };
  const loadEnvFile = processWithLoadEnvFile.loadEnvFile;
  if (typeof loadEnvFile !== "function") {
    return;
  }

  try {
    loadEnvFile(path.resolve(getRepoRootDirectoryPath(), ".env"));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") {
      throw error;
    }
    // No repo-root .env (e.g. CI, where env vars are injected directly);
    // fall back to the ambient process environment.
  }
};

export const runAuthCodegen = (): void => {
  loadRepoEnvFile();

  const repoRootDirectoryPath = getRepoRootDirectoryPath();
  const packagesDbDirectoryPath = getPackagesDbDirectoryPath();
  const betterAuthConfigAbsolutePath = path.resolve(
    repoRootDirectoryPath,
    AUTH_DB_BETTER_AUTH_CONFIG_PATH
  );
  const generatedSchemaAbsolutePath = path.resolve(
    repoRootDirectoryPath,
    AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH
  );
  const generatedSchemaRelativePath = path.relative(
    packagesDbDirectoryPath,
    generatedSchemaAbsolutePath
  );

  execFileSync(
    "pnpm",
    [
      "dlx",
      "auth@1.6.23",
      "generate",
      "--config",
      betterAuthConfigAbsolutePath,
      "--output",
      generatedSchemaRelativePath,
      "-y",
    ],
    {
      cwd: packagesDbDirectoryPath,
      env: process.env,
      stdio: "inherit",
    }
  );

  const generatedSchemaSource = fs.readFileSync(
    generatedSchemaAbsolutePath,
    "utf8"
  );
  fs.writeFileSync(
    generatedSchemaAbsolutePath,
    applyAuthSchemaCustomizations(generatedSchemaSource)
  );

  execFileSync(
    "pnpm",
    ["dlx", "ultracite", "fix", generatedSchemaAbsolutePath],
    {
      cwd: packagesDbDirectoryPath,
      env: process.env,
      stdio: "inherit",
    }
  );
};

export const emitAuthCodegen = (): void => {
  runAuthCodegen();
};
