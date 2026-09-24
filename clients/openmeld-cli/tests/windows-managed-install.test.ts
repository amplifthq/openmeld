import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WINDOWS_PROCESS_HELPER_FILENAME } from "@openmeld/schemas";
import { expect, it } from "vitest";
import {
  activateWindowsManagedCli,
  placeWindowsManagedVersion,
  readWindowsManagedCliVersion,
  reconcileWindowsManagedLauncher,
} from "../src/local-components/windows-managed-install";

// Real filesystem transactions run on Mac as well. Executable locking, argv,
// and actual install-self belong to the Windows artifact gate, not this test.
it("keeps the active installation and complete old bundle through failed acquisition, then repairs an interrupted launcher swap", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmeld managed 中文 "));
  try {
    const download = join(root, "download");
    await mkdir(download);
    const sourceBinary = join(download, "download.exe");
    await writeFile(sourceBinary, "cli version one");
    await writeFile(
      join(download, WINDOWS_PROCESS_HELPER_FILENAME),
      "native helper one"
    );
    await placeWindowsManagedVersion({ root, sourceBinary, version: "1.0.0" });
    await activateWindowsManagedCli(root, "1.0.0");
    await expect(readWindowsManagedCliVersion(root)).resolves.toBe("1.0.0");

    await writeFile(sourceBinary, "cli version two");
    await rm(join(download, WINDOWS_PROCESS_HELPER_FILENAME));
    await expect(
      placeWindowsManagedVersion({ root, sourceBinary, version: "1.0.1" })
    ).rejects.toThrow();
    await expect(readdir(join(root, "versions"))).resolves.toEqual(["1.0.0"]);
    await expect(readWindowsManagedCliVersion(root)).resolves.toBe("1.0.0");

    const launcher = join(root, "bin/openmeld.exe");
    await rename(
      launcher,
      join(
        root,
        "bin/.retired-launcher-11111111-1111-4111-8111-111111111111.exe"
      )
    );
    await reconcileWindowsManagedLauncher(root, "1.0.0");
    await expect(readFile(launcher, "utf8")).resolves.toBe("native helper one");
    await expect(
      readFile(join(root, "versions/1.0.0/openmeld.exe"), "utf8")
    ).resolves.toBe("cli version one");
    await expect(readWindowsManagedCliVersion(root)).resolves.toBe("1.0.0");

    await writeFile(
      join(download, WINDOWS_PROCESS_HELPER_FILENAME),
      "native helper two"
    );
    await placeWindowsManagedVersion({ root, sourceBinary, version: "1.0.1" });
    await activateWindowsManagedCli(root, "1.0.1");
    await expect(readWindowsManagedCliVersion(root)).resolves.toBe("1.0.1");
    await expect(readFile(launcher, "utf8")).resolves.toBe("native helper two");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects changed bytes for an installed version and an invalid active record without selecting a fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmeld immutable "));
  try {
    const sourceBinary = join(root, "source.exe");
    await writeFile(sourceBinary, "original");
    await writeFile(join(root, WINDOWS_PROCESS_HELPER_FILENAME), "helper");
    await placeWindowsManagedVersion({ root, version: "1.0.0", sourceBinary });
    await activateWindowsManagedCli(root, "1.0.0");
    await writeFile(sourceBinary, "changed");
    await expect(
      placeWindowsManagedVersion({ root, version: "1.0.0", sourceBinary })
    ).rejects.toThrow("immutable");
    await expect(
      readFile(join(root, "versions/1.0.0/openmeld.exe"), "utf8")
    ).resolves.toBe("original");
    await writeFile(
      join(root, "bin/cli-installation.json"),
      JSON.stringify({ schemaVersion: 1, version: "../other" })
    );
    await expect(readWindowsManagedCliVersion(root)).rejects.toThrow("invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
