import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ userHome: "" }));

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => fixture.userHome,
  };
});

const TEST_ARGV = ["/usr/local/bin/node", "/repo/node_modules/.bin/vitest"];

describe("managed install test safety", () => {
  beforeEach(async () => {
    fixture.userHome = await mkdtemp(
      join(tmpdir(), "openmeld-managed-install-default-home-")
    );
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(fixture.userHome, { force: true, recursive: true });
    fixture.userHome = "";
    vi.resetModules();
  });

  it("refuses to prune the default production home during tests", async () => {
    const publishedRoot = join(fixture.userHome, ".openmeld");
    const versionsDir = join(publishedRoot, "versions");
    for (const version of ["0.3.129", "0.3.130", "0.3.131"]) {
      const versionDir = join(versionsDir, version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(join(versionDir, "openmeld"), version);
      await chmod(join(versionDir, "openmeld"), 0o755);
    }
    await mkdir(join(publishedRoot, "bin"), { recursive: true });
    await symlink(
      join("..", "versions", "0.3.131", "openmeld"),
      join(publishedRoot, "bin", "openmeld")
    );
    const cleanupSentinel = join(versionsDir, "0.3.129", "openmeld");
    const { pruneManagedInstallVersions } = await import(
      "../src/local-components/managed-install"
    );

    const rejection = await pruneManagedInstallVersions({
      pathInput: {
        argv: TEST_ARGV,
        env: { VITEST: "true" },
        homeDir: fixture.userHome,
      },
      preferredRollbackVersion: "0.3.130",
    }).then(
      () => null,
      (error: unknown) => error
    );

    await expect(readFile(cleanupSentinel, "utf8")).resolves.toBe("0.3.129");
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      "Refusing to mutate managed CLI versions in the published production lane during tests."
    );
  });
});
