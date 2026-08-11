import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const coreRoot = process.cwd();
const unitRoot = path.join(coreRoot, "src", "__tests__");
const integrationRoot = path.join(coreRoot, "tests");
const CLOUDFLARE_TEST_IMPORT_PATTERN = /from\s+["']cloudflare:test["']/;

const hasCloudflareTestImport = (sourceText) => {
  return CLOUDFLARE_TEST_IMPORT_PATTERN.test(sourceText);
};

const toPosixPath = (inputPath) => {
  return inputPath.split(path.sep).join("/");
};

const collectTestFiles = async (rootDirectory) => {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(absolutePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(absolutePath);
    }
  }

  return files;
};

const isInDirectory = (filePath, directoryPath) => {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath.length > 0 && !relativePath.startsWith("..");
};

const main = async () => {
  const allCoreTests = await collectTestFiles(path.join(coreRoot, "src"));
  allCoreTests.push(...(await collectTestFiles(integrationRoot)));

  const violations = [];
  for (const testFilePath of allCoreTests) {
    const inUnitRoot = isInDirectory(testFilePath, unitRoot);
    const inIntegrationRoot = isInDirectory(testFilePath, integrationRoot);

    if (!(inUnitRoot || inIntegrationRoot)) {
      violations.push(
        `${toPosixPath(path.relative(coreRoot, testFilePath))}: tests must be in src/__tests__ or tests/`
      );
      continue;
    }

    if (inUnitRoot) {
      const sourceText = await readFile(testFilePath, "utf8");
      if (hasCloudflareTestImport(sourceText)) {
        violations.push(
          `${toPosixPath(path.relative(coreRoot, testFilePath))}: src/__tests__ is unit-only; cloudflare:test import is not allowed`
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("[core:test-layout] invalid test placement detected:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log("[core:test-layout] ok");
};

await main();
