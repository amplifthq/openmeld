import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const BARE_SIDE_EFFECT_IMPORT_REGEX =
  /^[\t ]*import[\t ]+["'](\.\.?\/[^"'\r\n]+)["'][\t ]*;?[\t ]*$/u;
const NEWLINE_REGEX = /\r?\n/u;

export function findBareSideEffectImports(outputRoot) {
  const absoluteOutputRoot = resolve(outputRoot);
  const findings = [];

  for (const outputFile of walkJavaScriptFiles(absoluteOutputRoot)) {
    const output = readFileSync(outputFile, "utf8");
    const lines = output.split(NEWLINE_REGEX);

    for (const [index, line] of lines.entries()) {
      const match = BARE_SIDE_EFFECT_IMPORT_REGEX.exec(line);
      if (!match) {
        continue;
      }
      findings.push({
        file: relative(absoluteOutputRoot, outputFile).replaceAll("\\", "/"),
        importPath: match[1],
        line: index + 1,
      });
    }
  }

  return findings;
}

function* walkJavaScriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkJavaScriptFiles(entryPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      yield entryPath;
    }
  }
}
