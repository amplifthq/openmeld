import { defineAgent, type SessionEnv } from "@flue/runtime";
import { initializeRootHarness } from "@flue/runtime/internal";
import { stringifyOrganizationSkillBundleCanonicalJson } from "@openmeld/schemas";
import type {
  OrganizationSkillBundle,
  OrganizationSkillRuntimeReleaseSelection,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildFlueSkillDefinition,
  materializeOrganizationSkillFlueSkills,
} from "../flue-adapter/organization-skills";

describe("Organization Skill Flue adapter", () => {
  it("materializes the exact verified release as a definition-provided Flue Skill", async () => {
    const bundle = createBundle();
    const selection = await createSelection(bundle);
    const skills = await materializeOrganizationSkillFlueSkills({
      expectedOrganizationId: "org_123",
      selections: [selection],
      snapshot: {
        organizationId: "org_123",
        releases: [
          {
            bundle,
            digest: selection.digest,
            releaseId: selection.releaseId,
            skillId: selection.skillId,
          },
        ],
      },
    });
    const sessionEnv = createObservedSessionEnv();
    const harness = await initializeRootHarness(
      defineAgent(() => ({
        instructions: "Use Organization Skills when relevant.",
        model: "test/model",
        sandbox: {
          createSessionEnv: async () => sessionEnv,
        },
        skills,
        skipLocalContextDiscovery: true,
      })),
      {
        agentConfig: {
          resolveModel: () => ({}) as never,
        },
        attachmentStore: {} as never,
        conversationWriter: {} as never,
        createDefaultEnv: async () => sessionEnv,
        env: {},
        id: "space_123",
      },
      () => undefined
    );
    const runtimeSkill = (
      harness as unknown as {
        config: {
          skills: Record<string, { description: string; name: string }>;
          systemPrompt: string;
        };
      }
    ).config.skills["release-review"];

    expect(runtimeSkill).toMatchObject({
      description: "Review a release using the Organization checklist.",
      name: "release-review",
    });
    expect(runtimeSkill).not.toHaveProperty("allowedTools");
    expect(
      buildFlueSkillDefinition(
        {
          bundle,
          digest: selection.digest,
          releaseId: selection.releaseId,
          skillId: selection.skillId,
        },
        selection.name
      )
    ).not.toHaveProperty("allowedTools");
    expect(
      (
        harness as unknown as {
          config: { systemPrompt: string };
        }
      ).config.systemPrompt
    ).toContain("release-review");
    expect(sessionEnv.exec).not.toHaveBeenCalled();
    expect(sessionEnv.exists).not.toHaveBeenCalled();
    expect(sessionEnv.readFile).not.toHaveBeenCalled();
  });

  it("fails closed when release content no longer matches the frozen digest", async () => {
    const bundle = createBundle();
    const selection = await createSelection(bundle);

    await expect(
      materializeOrganizationSkillFlueSkills({
        expectedOrganizationId: "org_123",
        selections: [selection],
        snapshot: {
          organizationId: "org_123",
          releases: [
            {
              bundle: {
                ...bundle,
                instructions: "Changed after admission.",
              },
              digest: selection.digest,
              releaseId: selection.releaseId,
              skillId: selection.skillId,
            },
          ],
        },
      })
    ).rejects.toThrow("failed its integrity check");
  });
});

function createBundle(): OrganizationSkillBundle {
  return {
    files: [
      {
        content: "# Checklist\n\nVerify rollback.",
        encoding: "utf8",
        mediaType: "text/markdown",
        path: "references/checklist.md",
        size: 29,
      },
      {
        content: "ZWNobyByZXZpZXc=",
        encoding: "base64",
        mediaType: "application/x-sh",
        path: "scripts/check-release.sh",
        size: 11,
      },
    ],
    instructions: "Read the checklist before reviewing the release.",
    portable: {
      allowedTools: "Read, Grep",
      compatibility: "OpenMeld Center Agent",
      description: "Review a release using the Organization checklist.",
      license: "MIT",
      metadata: { owner: "Release Engineering" },
      name: "release-review",
    },
  };
}

async function createSelection(
  bundle: OrganizationSkillBundle
): Promise<OrganizationSkillRuntimeReleaseSelection> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      stringifyOrganizationSkillBundleCanonicalJson(bundle)
    )
  );
  return {
    digest: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
    name: bundle.portable.name,
    releaseId: "release_123",
    skillId: "skill_123",
  };
}

function createObservedSessionEnv(): SessionEnv {
  return {
    cwd: "/workspace",
    exec: vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    })),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readFileBuffer: vi.fn(async () => new Uint8Array()),
    readdir: vi.fn(async () => []),
    resolvePath: (path) => (path.startsWith("/") ? path : `/workspace/${path}`),
    rm: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({
      isDirectory: false,
      isFile: true,
    })),
    writeFile: vi.fn(async () => undefined),
  };
}
