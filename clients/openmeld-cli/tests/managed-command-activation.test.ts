import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateManagedCliCommand,
  getManagedCliCommandActivationNotice,
} from "../src/local-components/managed-command-activation";

describe("managed CLI command activation", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.map((root) => rm(root, { recursive: true, force: true }))
    );
    tempRoots.length = 0;
  });

  async function createHome(): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), "wl-command-activation-"));
    tempRoots.push(home);
    return home;
  }

  it("prepends the production managed CLI for future zsh sessions exactly once", async () => {
    const home = await createHome();
    const profilePath = path.join(home, ".zshrc");
    const managedBinDir = path.join(home, ".openmeld", "bin");
    const oldBinDir = path.join(home, "old-global-bin");
    await mkdir(managedBinDir, { recursive: true });
    await mkdir(oldBinDir);
    await writeFile(path.join(managedBinDir, "openmeld"), "#!/bin/sh\n");
    await writeFile(path.join(oldBinDir, "openmeld"), "#!/bin/sh\n");
    await chmod(path.join(managedBinDir, "openmeld"), 0o755);
    await chmod(path.join(oldBinDir, "openmeld"), 0o755);
    await writeFile(profilePath, 'export NVM_DIR="$HOME/.nvm"\n');
    const env = {
      HOME: home,
      SHELL: "/bin/zsh",
      OPENMELD_ENV_PRESET: "prod",
    };

    const first = await activateManagedCliCommand({ env });
    const second = await activateManagedCliCommand({ env });

    expect(first).toEqual({
      profilePath,
      status: "activated",
    });
    expect(second).toEqual({
      profilePath,
      status: "already_active",
    });
    expect(getManagedCliCommandActivationNotice(first)).toBe(
      "OpenMeld added the openmeld command for future Terminal windows. This setup will keep running here; open a new Terminal window for later openmeld commands."
    );
    expect(getManagedCliCommandActivationNotice(second)).toBeNull();
    expect(await readFile(profilePath, "utf8")).toBe(
      [
        'export NVM_DIR="$HOME/.nvm"',
        'export PATH="$HOME/.openmeld/bin:$PATH" # OpenMeld CLI',
        "",
      ].join("\n")
    );
    expect(
      execFileSync("sh", ["-c", '. "$HOME/.zshrc"; command -v openmeld'], {
        encoding: "utf8",
        env: {
          HOME: home,
          PATH: `${oldBinDir}:/usr/bin:/bin`,
        },
      }).trim()
    ).toBe(path.join(managedBinDir, "openmeld"));
  });

  it("writes the production managed CLI path once when two activations run together", async () => {
    const home = await createHome();
    const profilePath = path.join(home, ".zshrc");
    const pathLine = 'export PATH="$HOME/.openmeld/bin:$PATH" # OpenMeld CLI';
    await writeFile(profilePath, 'export NVM_DIR="$HOME/.nvm"\n');
    const env = {
      HOME: home,
      SHELL: "/bin/zsh",
      OPENMELD_ENV_PRESET: "prod",
    };

    await Promise.all([
      activateManagedCliCommand({ env }),
      activateManagedCliCommand({ env }),
    ]);

    const profileLines = (await readFile(profilePath, "utf8")).split("\n");
    expect(profileLines.filter((line) => line === pathLine)).toHaveLength(1);
  });

  it("does not add custom or non-production lanes to the user's shell", async () => {
    const home = await createHome();
    await mkdir(path.join(home, ".config"), { recursive: true });

    await expect(
      activateManagedCliCommand({
        env: {
          HOME: home,
          SHELL: "/bin/zsh",
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_HOME: path.join(home, "isolated-openmeld"),
        },
      })
    ).resolves.toEqual({ status: "not_applicable" });
    await expect(
      activateManagedCliCommand({
        env: {
          HOME: home,
          SHELL: "/bin/zsh",
          OPENMELD_ENV_PRESET: "dev-local",
        },
      })
    ).resolves.toEqual({ status: "not_applicable" });
  });
});
