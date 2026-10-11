import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasUnchangedCloudComputerRequests } from "./cloud-computer-request-compatibility.mjs";

const root = new URL("../../", import.meta.url);
const schema = "packages/schemas/src/schemas/runtime/cloud-computer.ts";
const source = (file) => readFileSync(new URL(file, root), "utf8");
const context = (alter = (_file, value) => value) => ({
  base: "before",
  sourceSha: "after",
  readGitFile: (ref, file) =>
    ref === "after" ? alter(file, source(file)) : source(file),
});

test("Computer result additions do not introduce opt-in requests", () => {
  assert.equal(
    hasUnchangedCloudComputerRequests(
      context((file, value) =>
        file === schema
          ? `${value}\nexport const additionalResult = true;\n`
          : value
      )
    ),
    true
  );
});

test("Computer request proof rejects changed or unavailable owners", () => {
  for (const file of [
    schema,
    "packages/schemas/src/lazy-zod.ts",
    "packages/schemas/src/schemas/daemon/profile-identity.ts",
    "packages/schemas/src/schemas/protocol/profile.ts",
    "packages/schemas/src/index.ts",
    "services/core/src/computer/computer-rpc.ts",
    "services/gateway/src/routes/rpc-http.cloud-computer.ts",
    "packages/api-client/src/cloud-computer.ts",
    "clients/openmeld-cli/src/commands/cloud-computer.ts",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
  ]) {
    const changed = context((path, value) => {
      if (path !== file) {
        return value;
      }
      if (path === schema) {
        return value.replace(
          "const key = z.string().min(1).max(256)",
          "const key = z.string().min(1).max(257)"
        );
      }
      if (path === "packages/schemas/src/index.ts") {
        return value.replace(
          'from "./schemas/runtime/cloud-computer"',
          'from "./unknown-computer"'
        );
      }
      if (path.endsWith(".yaml")) {
        return value.replaceAll("4.6.5", "4.6.6");
      }
      return `${value}\n// Changed contract owner.\n`;
    });
    assert.equal(hasUnchangedCloudComputerRequests(changed), false, file);
    assert.equal(
      hasUnchangedCloudComputerRequests(
        context((path, value) => {
          if (path === file) {
            throw new Error("Missing historical source");
          }
          return value;
        })
      ),
      false
    );
  }
  assert.equal(
    hasUnchangedCloudComputerRequests(
      context((file, value) =>
        file === schema ? `import "unknown-parser";\n${value}` : value
      )
    ),
    false
  );
  for (const suffix of [
    'import "unknown-parser";',
    'Object.defineProperty(cloudComputerOperationSchema, "safeParse", {value: () => false});',
    "export const changed = Object.assign(cloudComputerOperationSchema, {});",
    "export const changed = z.custom(() => { cloudComputerOperationSchema.safeParse = () => false; });",
  ]) {
    assert.equal(
      hasUnchangedCloudComputerRequests(
        context((file, value) =>
          file === schema ? `${value}\n${suffix}\n` : value
        )
      ),
      false,
      suffix
    );
  }
});
