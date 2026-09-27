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
import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  createOrganizationSkillResourceTool,
  materializeOrganizationSkillFlueSkillsFromCatalog,
} from "../flue-adapter/organization-skills";
import { isRemoteAgentNativeCapability } from "../flue-adapter/tool-presentation";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Organization Skill Flue adapter", () => {
  it("reads only an admitted resource through the authorized Core method", async () => {
    const bundle = createBundle();
    const selection = await createSelection(bundle);
    const file = bundle.files[0];
    if (!file) {
      throw new Error("The Skill fixture has no resource.");
    }
    const request = createSubmitTurnRequest({
      organizationSkillReleases: [selection],
    });
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: "skill-resource-test",
        status: "pending",
        submissionId: "skill-resource-test",
      },
      nowMs: TEST_NOW_MS,
      request,
    });
    const readOrganizationSkillRuntimeResource = vi.fn(async () => ({
      file,
    }));
    const tool = createOrganizationSkillResourceTool({
      context,
      coreWorker: { readOrganizationSkillRuntimeResource },
    });
    expect(isRemoteAgentNativeCapability(tool.name)).toBe(true);
    const tools = await getRemoteAgentFlueTools({
      coreWorker: { readOrganizationSkillRuntimeResource },
      storage: new InMemoryDurableObjectStorage(),
      submissionId: context.submissionId,
      organizationSkillContext: context,
      env: { LOADER: {} as WorkerLoader },
      codeModeRuntime: {
        createCodeTool: ({ description }) => ({ description }),
        createExecutor: () => ({}),
      },
    });
    expect(tools.tools.map((registered) => registered.name)).toContain(
      "openmeld_read_skill_resource"
    );
    if (request.turnEnvelope.sender.kind !== "member") {
      throw new Error("This test requires a member turn.");
    }
    const unverifiedTools = await getRemoteAgentFlueTools({
      coreWorker: { readOrganizationSkillRuntimeResource },
      storage: new InMemoryDurableObjectStorage(),
      submissionId: context.submissionId,
      organizationSkillContext: context,
      turnEnvelope: {
        ...request.turnEnvelope,
        sender: { ...request.turnEnvelope.sender, verified: false },
      },
      env: { LOADER: {} as WorkerLoader },
      codeModeRuntime: {
        createCodeTool: ({ description }) => ({ description }),
        createExecutor: () => ({}),
      },
    });
    expect(
      unverifiedTools.tools.map((registered) => registered.name)
    ).not.toContain("openmeld_read_skill_resource");
    await expect(
      tool.execute({ skillName: "unknown", path: "references/checklist.md" })
    ).rejects.toThrow("not available");
    expect(readOrganizationSkillRuntimeResource).not.toHaveBeenCalled();
    await expect(
      tool.execute({
        skillName: selection.name,
        path: "references/checklist.md",
      })
    ).resolves.toMatchObject({
      file,
    });
    expect(readOrganizationSkillRuntimeResource).toHaveBeenCalledWith(
      expect.objectContaining({
        release: selection,
        path: "references/checklist.md",
        context: expect.objectContaining({
          activeOrganizationId: context.organizationId,
        }),
      })
    );
  });

  it("mounts instructions and resource paths without materializing resource bytes", async () => {
    const bundle = createBundle();
    const selection = await createSelection(bundle);
    const skills = materializeOrganizationSkillFlueSkillsFromCatalog({
      expectedOrganizationId: "org_123",
      selections: [selection],
      catalog: {
        organizationId: "org_123",
        releases: [
          {
            digest: selection.digest,
            releaseId: selection.releaseId,
            skillId: selection.skillId,
            instructions: bundle.instructions,
            portable: bundle.portable,
            files: bundle.files.map(({ content: _content, ...file }) => file),
          },
        ],
      },
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.files).toBeUndefined();
    expect(skills[0]?.instructions).toContain("references/checklist.md");
    expect(skills[0]?.instructions).toContain("openmeld_read_skill_resource");
    expect(skills[0]?.instructions).not.toContain("Verify rollback.");
    expect(() =>
      materializeOrganizationSkillFlueSkillsFromCatalog({
        expectedOrganizationId: "org_123",
        selections: [{ ...selection, digest: "b".repeat(64) }],
        catalog: {
          organizationId: "org_123",
          releases: [
            {
              digest: selection.digest,
              releaseId: selection.releaseId,
              skillId: selection.skillId,
              instructions: bundle.instructions,
              portable: bundle.portable,
              files: bundle.files.map(({ content: _content, ...file }) => file),
            },
          ],
        },
      })
    ).toThrow("does not match the admitted task");
  });

  it.each<Record<string, string>>([
    {},
    { owner: "Release Engineering" },
  ])("loads the exact verified release with metadata %j", async (metadata) => {
    const bundle = createBundle();
    bundle.portable.metadata = metadata;
    const selection = await createSelection(bundle);
    const skills = materializeOrganizationSkillFlueSkillsFromCatalog({
      expectedOrganizationId: "org_123",
      selections: [selection],
      catalog: {
        organizationId: "org_123",
        releases: [
          {
            digest: selection.digest,
            releaseId: selection.releaseId,
            skillId: selection.skillId,
            instructions: bundle.instructions,
            portable: bundle.portable,
            files: bundle.files.map(({ content: _content, ...file }) => file),
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
        expect(context.tools?.map((tool) => tool.name)).not.toContain(
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
