import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export async function computeDirectoryContentHash(input: {
  rootDir: string;
  ignoredNames?: string[];
}): Promise<string> {
  const ignoredNames = new Set(input.ignoredNames ?? []);
  const files = await collectFiles({
    dir: input.rootDir,
    rootDir: input.rootDir,
    ignoredNames,
  });
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`file:${file.relativePath}\n`);
    hash.update(file.content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function collectFiles(input: {
  dir: string;
  rootDir: string;
  ignoredNames: Set<string>;
}): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const entries = await readdir(input.dir, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (getErrorCode(error) === "ENOENT") {
        return [];
      }
      warnDirectoryReadError(input.dir, error);
      throw error;
    }
  );
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files: Array<{ relativePath: string; content: Buffer }> = [];
  for (const entry of entries) {
    if (input.ignoredNames.has(entry.name)) {
      continue;
    }
    const absolutePath = join(input.dir, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await collectFiles({
          dir: absolutePath,
          rootDir: input.rootDir,
          ignoredNames: input.ignoredNames,
        }))
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const content = await readFile(absolutePath);
    files.push({
      relativePath: normalizeRelativePath(
        relative(input.rootDir, absolutePath)
      ),
      content,
    });
  }
  return files;
}

function normalizeRelativePath(value: string): string {
  return value.split("\\").join("/");
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function warnDirectoryReadError(dir: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `[openmeld] failed to read directory while hashing skills content (${dir}): ${reason}\n`
  );
}
