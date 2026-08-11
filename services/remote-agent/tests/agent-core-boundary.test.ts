import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("remote agent wall 2 boundary", () => {
  it("keeps agent-core independent from Flue packages", async () => {
    const root = join(process.cwd(), "agent-core");
    const files = await listTypeScriptFiles(root);
    const imports = await Promise.all(
      files.map(async (file) => ({
        file,
        source: await readFile(file, "utf8"),
      }))
    );

    expect(
      imports
        .filter(({ source }) => source.includes("@flue/"))
        .map(({ file }) => file)
    ).toEqual([]);
  });
});

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(path);
      }
      return entry.isFile() && path.endsWith(".ts") ? [path] : [];
    })
  );
  return nested.flat();
}
