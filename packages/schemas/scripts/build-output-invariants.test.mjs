import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { findBareSideEffectImports } from "./build-output-invariants.mjs";

test("finds bare side-effect imports anywhere in schema JavaScript output", () => {
  const outputRoot = mkdtempSync(join(tmpdir(), "openmeld-schema-output-"));

  try {
    mkdirSync(join(outputRoot, "schemas", "profile"), { recursive: true });
    writeFileSync(
      join(outputRoot, "index.js"),
      [
        'import "node:module";',
        'import { schema } from "./schemas/index.js";',
        "export { schema };",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(outputRoot, "schemas", "profile", "identity.js"),
      'import "../../protocol/constants.js";\nexport const identity = {};\n'
    );

    expect(findBareSideEffectImports(outputRoot)).toEqual([
      {
        file: "schemas/profile/identity.js",
        importPath: "../../protocol/constants.js",
        line: 1,
      },
    ]);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
