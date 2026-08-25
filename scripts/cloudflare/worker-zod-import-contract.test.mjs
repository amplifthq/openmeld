import assert from "node:assert/strict";
import test from "node:test";
import { findUnsafeZodImports } from "./worker-zod-import-contract.mjs";

test("rejects runtime named Zod namespace imports", () => {
  assert.deepEqual(
    findUnsafeZodImports('import { z } from "zod/v4";\nz.string();'),
    [{ column: 10, line: 1 }]
  );
});

test("allows type-only and tree-shakeable namespace imports", () => {
  assert.deepEqual(
    findUnsafeZodImports(
      'import type { z } from "zod/v4";\nimport * as runtimeZod from "zod/v4";'
    ),
    []
  );
});

test("rejects aliased runtime imports of the Zod namespace", () => {
  assert.equal(
    findUnsafeZodImports('import { z as schema } from "zod/v4";').length,
    1
  );
});
