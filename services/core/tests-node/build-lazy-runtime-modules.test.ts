import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { writeOutputIfChanged } from "../scripts/build-lazy-runtime-modules.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("writeOutputIfChanged", () => {
  test("does not replace an existing generated module when its contents are unchanged", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openmeld-core-build-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "runtime.mjs");
    const output = Buffer.from("export const value = 1;\n");
    writeFileSync(outputPath, output);
    const inodeBefore = statSync(outputPath).ino;

    expect(writeOutputIfChanged(outputPath, output)).toBe(false);
    expect(statSync(outputPath).ino).toBe(inodeBefore);
    expect(readFileSync(outputPath)).toEqual(output);
  });

  test("atomically replaces a generated module when its contents changed", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openmeld-core-build-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "runtime.mjs");
    writeFileSync(outputPath, "export const value = 1;\n");
    const output = Buffer.from("export const value = 2;\n");

    expect(writeOutputIfChanged(outputPath, output)).toBe(true);
    expect(readFileSync(outputPath)).toEqual(output);
  });
});
