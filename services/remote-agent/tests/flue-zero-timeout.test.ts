import { readdir, readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIVE_TIMEOUT_GUARD =
  /this\.activeTimeoutAt !== void 0 && this\.activeTimeoutAt > 0 && Date\.now\(\) >= this\.activeTimeoutAt/u;
const RECOVERY_TIMEOUT_GUARD =
  /submission\.timeoutAt > 0 && Date\.now\(\) >= submission\.timeoutAt/u;

describe("Flue zero-timeout durability patch", () => {
  it("keeps both active streaming and recovery deadlines disabled at zero", async () => {
    const runtimePackageJson = findPackageJSON(
      "@flue/runtime",
      import.meta.url
    );

    if (!runtimePackageJson) {
      throw new Error("Could not find Flue's runtime package.");
    }

    const runtimeDirectory = join(dirname(runtimePackageJson), "dist");
    const runtimeChunk = (await readdir(runtimeDirectory)).find((fileName) =>
      fileName.startsWith("conversation-stream-store-")
    );

    if (!runtimeChunk) {
      throw new Error("Could not find Flue's conversation stream runtime.");
    }

    const source = await readFile(join(runtimeDirectory, runtimeChunk), "utf8");

    expect(source).toMatch(ACTIVE_TIMEOUT_GUARD);
    expect(source).toMatch(RECOVERY_TIMEOUT_GUARD);
  });
});
