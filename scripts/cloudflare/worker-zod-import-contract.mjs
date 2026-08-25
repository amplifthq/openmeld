#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const WORKER_RUNTIME_ROOTS = [
  "packages/schemas/src",
  "services/auth/src",
  "services/core/src",
  "services/gateway/src",
  "services/remote-agent/.flue",
  "services/remote-agent/agent-core",
  "services/remote-agent/flue-adapter",
];
const TYPESCRIPT_SOURCE_FILE_PATTERN = /\.tsx?$/u;

export function findUnsafeZodImports(sourceText, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const violations = [];

  for (const statement of sourceFile.statements) {
    if (
      !(
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) ||
      statement.moduleSpecifier.text !== "zod/v4"
    ) {
      continue;
    }

    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (
      importClause?.isTypeOnly ||
      !namedBindings ||
      !ts.isNamedImports(namedBindings)
    ) {
      continue;
    }

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!element.isTypeOnly && importedName === "z") {
        const position = sourceFile.getLineAndCharacterOfPosition(
          element.getStart(sourceFile)
        );
        violations.push({
          column: position.character + 1,
          line: position.line + 1,
        });
      }
    }
  }

  return violations;
}

async function collectTypeScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && TYPESCRIPT_SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function verifyWorkerZodImports(repositoryRoot = process.cwd()) {
  const violations = [];

  for (const relativeRoot of WORKER_RUNTIME_ROOTS) {
    const root = path.join(repositoryRoot, relativeRoot);
    for (const filePath of await collectTypeScriptFiles(root)) {
      const sourceText = await readFile(filePath, "utf8");
      for (const location of findUnsafeZodImports(sourceText, filePath)) {
        violations.push({
          ...location,
          file: path.relative(repositoryRoot, filePath),
        });
      }
    }
  }

  return violations;
}

if (process.argv[1]?.endsWith("worker-zod-import-contract.mjs")) {
  const violations = await verifyWorkerZodImports();
  if (violations.length > 0) {
    console.error(
      "Cloudflare Worker runtime code must import Zod as a namespace to keep unused locales out of the production bundle:"
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${String(violation.line)}:${String(violation.column)}`
      );
    }
    process.exit(1);
  }
  console.log("Cloudflare Worker Zod imports are bundle-safe.");
}
