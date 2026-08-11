import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenMeldBin } from "../src/main/cli/resolve-openmeld";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openmeld-desktop-resolve-"));
  tempRoots.push(root);
  return root;
}

async function writeExecutable(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "#!/usr/bin/env node\n");
  await chmod(path, 0o755);
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("resolveOpenMeldBin", () => {
  it("honors OPENMELD_BIN", () => {
    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "/opt/openmeld/bin/openmeld", PATH: "" },
      })
    ).toBe("/opt/openmeld/bin/openmeld");
  });

  it("falls back to PATH openmeld when available", async () => {
    const root = await tempRoot();
    const binDir = join(root, "bin");
    const pathOpenMeld = join(binDir, "openmeld");
    await writeExecutable(pathOpenMeld);

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", HOME: root, PATH: binDir },
      })
    ).toBe(pathOpenMeld);
  });

  it("resolves the active daemon bundle when openmeld is not on PATH", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    const entryPath = join(
      openMeldHome,
      "runtime",
      "daemon",
      "bundles",
      "bundle-1",
      "dist",
      "openmeld.js"
    );
    await writeExecutable(entryPath);
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "bundle-1",
        daemonVersion: "0.7.70",
        entryScriptRelativePath: "dist/openmeld.js",
        bundleFormat: "self_contained_v1",
        sourceEntryScriptPath: "/source/dist/openmeld.js",
        sourcePackageRootPath: "/source",
        sourceDistRootPath: "/source/dist",
        sourceKind: "package_install",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      })
    ).toBe(entryPath);
  });

  it("falls back predictably when the active bundle is missing", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "missing-bundle",
        daemonVersion: "0.7.70",
        entryScriptRelativePath: "dist/openmeld.js",
        bundleFormat: "self_contained_v1",
        sourceKind: "package_install",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      })
    ).toBe("openmeld");
  });

  it("rejects unsafe active bundle paths", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    const outsideEntry = join(openMeldHome, "runtime", "daemon", "outside.js");
    await writeExecutable(outsideEntry);
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "bundle-1",
        daemonVersion: "0.7.70",
        entryScriptRelativePath: "../outside.js",
        bundleFormat: "self_contained_v1",
        sourceKind: "package_install",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      })
    ).toBe("openmeld");
  });

  it("rejects legacy active bundle state", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    const entryPath = join(
      openMeldHome,
      "runtime",
      "daemon",
      "bundles",
      "bundle-1",
      "dist",
      "openmeld.js"
    );
    await writeExecutable(entryPath);
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 1,
        schema: "openmeld-daemon-active-bundle-v1",
        bundleId: "bundle-1",
        daemonVersion: "0.7.70",
        entryScriptRelativePath: "dist/openmeld.js",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      })
    ).toBe("openmeld");
  });

  it("rejects v2 active bundle state that is not clearly self-contained", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    const entryPath = join(
      openMeldHome,
      "runtime",
      "daemon",
      "bundles",
      "bundle-1",
      "dist",
      "openmeld.js"
    );
    await writeExecutable(entryPath);
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "bundle-1",
        daemonVersion: "",
        entryScriptRelativePath: "dist/openmeld.js",
        bundleFormat: "legacy_linked_v1",
        sourceKind: "package_install",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: { OPENMELD_BIN: "", OPENMELD_HOME: openMeldHome, PATH: "" },
      })
    ).toBe("openmeld");
  });

  it("rejects workspace active bundles outside the dev-local lane", async () => {
    const openMeldHome = join(await tempRoot(), ".openmeld-fixture");
    const entryPath = join(
      openMeldHome,
      "runtime",
      "daemon",
      "bundles",
      "bundle-1",
      "dist",
      "openmeld.js"
    );
    await writeExecutable(entryPath);
    await mkdir(join(openMeldHome, "runtime", "daemon", "state"), {
      recursive: true,
    });
    await writeFile(
      join(openMeldHome, "runtime", "daemon", "state", "active-bundle.json"),
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "bundle-1",
        daemonVersion: "0.7.70",
        entryScriptRelativePath: "dist/openmeld.js",
        bundleFormat: "self_contained_v1",
        sourceKind: "workspace",
      })
    );

    expect(
      resolveOpenMeldBin({
        env: {
          OPENMELD_BIN: "",
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_HOME: openMeldHome,
          PATH: "",
        },
      })
    ).toBe("openmeld");

    expect(
      resolveOpenMeldBin({
        env: {
          OPENMELD_BIN: "",
          OPENMELD_ENV_PRESET: "dev-local",
          OPENMELD_HOME: openMeldHome,
          PATH: "",
        },
      })
    ).toBe(entryPath);
  });
});
