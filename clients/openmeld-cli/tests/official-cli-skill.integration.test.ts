import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_CLI_SKILL_CONTRACT,
  officialCliSkillPayloadSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setConfiguredSkillsConfig } from "../src/config/runtime-config";
import { OPENMELD_SKILLS_CONTRACT_VERSION } from "../src/local-components/manifest";
import {
  applyDispatchSkillInstructions,
  ensureDispatchControllerOpenMeldSkill,
} from "../src/local-service/dispatch/ensure-dispatch-controller-openmeld-skill";
import { installSkillsToTargets } from "../src/skills/installer";
import { maintainOfficialCliSkill } from "../src/skills/maintenance";
import {
  downloadOfficialSkillUpdate,
  readSelectedSkillDocument,
  resolveOfficialSkillChannelUrl,
  selectOfficialSkillRelease,
  verifyOfficialSkillRelease,
} from "../src/skills/official-release";
import {
  recoverSkillReplacement,
  replaceSkillDirectory,
} from "../src/skills/replace-directory";
import { ensureLocalSkills } from "../src/skills/store";
import { withTempHome } from "./helpers/fs";

const publicRoot = fileURLToPath(
  new URL("../../web/public/skills/openmeld-cli/", import.meta.url)
);
const channel = JSON.parse(
  await readFile(join(publicRoot, "channel.json"), "utf8")
);

afterEach(() => vi.unstubAllEnvs());

async function withChannel(body: string, run: () => Promise<void>) {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing server address");
  }
  vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
  vi.stubEnv(
    "OPENMELD_CLI_SKILL_CHANNEL_URL",
    `http://127.0.0.1:${address.port}/skills/openmeld-cli/channel.json`
  );
  try {
    await run();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("independent official CLI Skill", () => {
  it("accepts the published signature, rejects tampering, and selects only compatible content", () => {
    const release = channel.releases[0];
    expect(verifyOfficialSkillRelease(release).payload.revision).toBe(1);
    expect(OFFICIAL_CLI_SKILL_CONTRACT).toBe(OPENMELD_SKILLS_CONTRACT_VERSION);
    const compatible =
      verifyOfficialSkillRelease(release).payload.contractVersion ===
      OPENMELD_SKILLS_CONTRACT_VERSION;
    expect(selectOfficialSkillRelease(channel, "0.3.158")).toBeNull();
    expect(
      selectOfficialSkillRelease(channel, "0.3.159")?.payload.revision
    ).toBe(compatible ? 1 : undefined);
    expect(() =>
      verifyOfficialSkillRelease({ ...release, payload: `${release.payload} ` })
    ).toThrow("signature");
    expect(() =>
      selectOfficialSkillRelease({ schemaVersion: 2, releases: [] })
    ).toThrow("channel");
  });

  it("allows Markdown only, without traversal or duplicate paths", () => {
    const payload = verifyOfficialSkillRelease(channel.releases[0]).payload;
    for (const path of [
      "../SKILL.md",
      "/SKILL.md",
      "references/../../bad.md",
      "scripts/run.sh",
      "references\\bad.md",
    ]) {
      expect(
        officialCliSkillPayloadSchema.safeParse({
          ...payload,
          files: [{ path, content: "bad" }],
        }).success
      ).toBe(false);
    }
    expect(
      officialCliSkillPayloadSchema.safeParse({
        ...payload,
        files: [payload.files[0], payload.files[0]],
      }).success
    ).toBe(false);
  });

  it("installs only compatible content and keeps it through repeated local setup and prompt reads", async () => {
    await withTempHome(async (home) =>
      withChannel(JSON.stringify(channel), async () => {
        const targetDir = join(home, "agent skills");
        const before = (await ensureLocalSkills())[0];
        if (!before) {
          throw new Error("Missing baseline Skill");
        }
        expect(before.version).not.toBe("skill-r1");
        const compatible = selectOfficialSkillRelease(channel) !== null;
        expect(await downloadOfficialSkillUpdate()).toBe(
          compatible ? "updated" : "incompatible"
        );
        const first = (await ensureLocalSkills())[0];
        if (!first) {
          throw new Error("Missing updated Skill");
        }
        expect(first.version).toBe(compatible ? "skill-r1" : before.version);
        await installSkillsToTargets({
          skills: [first],
          targets: [{ id: "codex", dir: targetDir, type: "agent" }],
        });
        expect(await downloadOfficialSkillUpdate()).toBe(
          compatible ? "current" : "incompatible"
        );
        expect((await ensureLocalSkills())[0]?.contentHash).toBe(
          first.contentHash
        );
        const expected = await readFile(
          compatible
            ? join(publicRoot, "SKILL.md")
            : fileURLToPath(
                new URL("../skills/openmeld-cli/SKILL.md", import.meta.url)
              ),
          "utf8"
        );
        expect(
          await readFile(join(targetDir, "openmeld-cli/SKILL.md"), "utf8")
        ).toBe(expected);
        expect(await readSelectedSkillDocument("SKILL.md")).toBe(expected);
      })
    );
  });

  it("keeps the last good local content when a downloaded signature is bad", async () => {
    await withTempHome(async () => {
      await withChannel(JSON.stringify(channel), async () => {
        await downloadOfficialSkillUpdate();
        await ensureLocalSkills();
      });
      const before = await readSelectedSkillDocument("SKILL.md");
      const beforeVersion = (await ensureLocalSkills())[0]?.version;
      await withChannel(
        JSON.stringify({
          ...channel,
          releases: [{ ...channel.releases[0], payload: "{}" }],
        }),
        async () => {
          await expect(downloadOfficialSkillUpdate()).rejects.toThrow(
            "signature"
          );
        }
      );
      expect(await readSelectedSkillDocument("SKILL.md")).toBe(before);
      expect((await ensureLocalSkills())[0]?.version).toBe(beforeVersion);
    });
  });

  it("repairs only the selected controller locally, with an explicit entry in its instructions", async () => {
    await withTempHome(async (home) => {
      const target = join(home, "Codex skills");
      await setConfiguredSkillsConfig({
        agents: { codex: { globalSkillsDir: target } },
      });
      const result = await ensureDispatchControllerOpenMeldSkill({
        agentControllerRef: "builtin:codex",
      });
      expect(result.status).toBe("repaired");
      expect(result.skillPath).toBe(join(target, "openmeld-cli/SKILL.md"));
      const plan = applyDispatchSkillInstructions(
        {
          developerInstructions: "Existing rules",
          fallbackPrompt: "Task",
          userPrompt: "Task",
          instructionEpoch: "v1",
        },
        result
      );
      expect(plan.developerInstructions).toContain(
        JSON.stringify(result.skillPath)
      );
      expect(plan.fallbackPrompt).toContain(
        "https://openmeld.ai/skills/openmeld-cli/SKILL.md"
      );
      expect(plan.userPrompt).toBe("Task");
    });
  });

  it("repairs a tracked deleted install in maintenance without changing user conflicts", async () => {
    await withTempHome(async (home) =>
      withChannel(JSON.stringify(channel), async () => {
        const target = join(home, "custom skills");
        await mkdir(target, { recursive: true });
        await setConfiguredSkillsConfig({
          customTargets: [{ dir: target, name: "Test agent" }],
        });
        await maintainOfficialCliSkill();
        expect(
          await readFile(join(target, "openmeld-cli/SKILL.md"), "utf8")
        ).toBe(await readSelectedSkillDocument("SKILL.md"));
      })
    );
  });

  it("does not use a production endpoint override or let an isolated lane fetch arbitrary hosts", () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "prod");
    vi.stubEnv(
      "OPENMELD_CLI_SKILL_CHANNEL_URL",
      "https://attacker.invalid/channel.json"
    );
    expect(resolveOfficialSkillChannelUrl()).toBe(
      "https://openmeld.ai/skills/openmeld-cli/channel.json"
    );
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    vi.stubEnv("OPENMELD_HOME", "/tmp/isolated-skill-test");
    expect(() => resolveOfficialSkillChannelUrl()).toThrow("localhost");
  });
});

describe("Skill replacement recovery", () => {
  it("leaves the working directory intact if preparing the replacement fails", async () => {
    await withTempHome(async (home) => {
      const target = join(home, "skill");
      await mkdir(target);
      await writeFile(join(target, "SKILL.md"), "working");
      await expect(
        replaceSkillDirectory(target, async (staged) => {
          await mkdir(staged);
          await writeFile(join(staged, "SKILL.md"), "incomplete");
          throw new Error("disk full");
        })
      ).rejects.toThrow("disk full");
      expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("working");
    });
  });

  it("recovers an interrupted cutover before another install", async () => {
    await withTempHome(async (home) => {
      const target = join(home, "skill");
      await mkdir(target);
      await writeFile(join(target, "SKILL.md"), "working");
      await writeFile(
        join(target, ".openmeld-skill.json"),
        JSON.stringify({ managedBy: "openmeld", skillId: "skill" })
      );
      await rename(target, join(home, ".skill.openmeld-previous"));
      await recoverSkillReplacement(target);
      expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("working");
    });
  });
});
