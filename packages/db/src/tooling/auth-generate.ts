import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUTH_DB_BETTER_AUTH_CONFIG_PATH,
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
} from "../auth/fact-metadata.ts";
import { getRepoRootDirectoryPath } from "../auth/paths.ts";
import { applyAuthSchemaCustomizations } from "./auth-schema-customizations.ts";

const SUPPORTED_BETTER_AUTH_VERSION = /^1\.6\.\d+$/u;

export function runAuthCodegen(options: { check?: boolean } = {}): void {
  const root = getRepoRootDirectoryPath();
  const { version } = JSON.parse(
    fs.readFileSync(
      path.join(root, "services/auth/node_modules/better-auth/package.json"),
      "utf8"
    )
  ) as { version: string };
  if (!SUPPORTED_BETTER_AUTH_VERSION.test(version)) {
    throw new Error(
      "Review native Auth schema generation before changing the Better Auth release family."
    );
  }
  const canonical = path.join(root, AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH);
  const before = fs.readFileSync(canonical, "utf8");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "openmeld-auth-codegen-")
  );
  const output = path.join(temporary, "auth.schema.ts");
  const replacement = `${canonical}.codegen-${crypto.randomUUID()}`;
  try {
    execFileSync(
      "pnpm",
      ["exec", "turbo", "run", "build", "--filter=@openmeld/auth..."],
      {
        cwd: root,
        stdio: "inherit",
      }
    );
    execFileSync(
      "pnpm",
      [
        "dlx",
        `auth@${version}`,
        "generate",
        "--config",
        path.join(root, AUTH_DB_BETTER_AUTH_CONFIG_PATH),
        "--output",
        output,
        "-y",
      ],
      { cwd: path.join(root, "packages/db"), stdio: "inherit" }
    );
    const customized = applyAuthSchemaCustomizations(
      fs.readFileSync(output, "utf8")
    );
    const source = execFileSync(
      "pnpm",
      ["exec", "biome", "format", "--stdin-file-path", canonical],
      {
        cwd: root,
        input: customized,
        encoding: "utf8",
      }
    );
    if (fs.readFileSync(canonical, "utf8") !== before) {
      throw new Error(
        "The canonical Auth schema changed during generation; no file was replaced."
      );
    }
    if (options.check) {
      if (source !== before) {
        throw new Error(
          "The Auth schema differs from official generation. Run auth:generate and review the diff before db:generate."
        );
      }
    } else if (source !== before) {
      fs.writeFileSync(replacement, source);
      fs.renameSync(replacement, canonical);
    }
    console.log(
      "[auth:generate] Native Auth schema is aligned. Review the diff, then use db:generate; no database was queried or migrated."
    );
  } finally {
    fs.rmSync(replacement, { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function emitAuthCodegen(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--check")) {
    throw new Error("Usage: auth:generate [--check]");
  }
  runAuthCodegen({ check: args.includes("--check") });
}
