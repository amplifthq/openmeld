import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { init, useModel, useSkill } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { stringifyOrganizationSkillBundleCanonicalJson } from "@openmeld/schemas";
import type {
  OrganizationSkillBundle,
  OrganizationSkillRuntimeReleaseSelection,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildFlueSkillDefinition,
  materializeOrganizationSkillFlueSkills,
} from "../flue-adapter/organization-skills";

describe("Organization Skill Flue adapter", () => {
  it.each<Record<string, string>>([
    {},
    { owner: "Release Engineering" },
  ])("loads the exact verified release with metadata %j", async (metadata) => {
    const bundle = createBundle();
    bundle.portable.metadata = metadata;
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
    const provider = fauxProvider({
      provider: "organization-skill",
      tokensPerSecond: Number.POSITIVE_INFINITY,
    });
    const model = provider.getModel();
    function SkillAgent() {
      useModel(`${model.provider}/${model.id}`);
      for (const skill of skills) {
        useSkill(skill);
      }
      return "Use Organization Skills when relevant.";
    }
    provider.setResponses([
      (context) => {
        expect(context.systemPrompt).toContain("release-review");
        expect(context.tools?.map((tool) => tool.name)).toContain(
          "read_skill_resource"
        );
        expect(context.tools?.map((tool) => tool.name)).not.toContain("bash");
        return fauxAssistantMessage(
          fauxToolCall("activate_skill", { name: "release-review" }),
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const result = context.messages.findLast(
          (message) => message.role === "toolResult"
        );
        expect(result).toMatchObject({ isError: false });
        expect(JSON.stringify(result)).toContain(bundle.instructions);
        return fauxAssistantMessage(
          "The verified release checklist is loaded."
        );
      },
    ]);
    const runtime = await start({
      agents: [SkillAgent],
      providers: [provider.provider],
    });
    try {
      const agent = init(SkillAgent, { id: "space_123" });
      await agent.read(await agent.dispatch("Review this release."));
    } finally {
      await runtime.stop();
    }
    const runtimeSkill = skills[0];

    expect(runtimeSkill).toMatchObject({
      description: "Review a release using the Organization checklist.",
      name: "release-review",
    });
    expect(runtimeSkill?.allowedTools).toBeUndefined();
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
