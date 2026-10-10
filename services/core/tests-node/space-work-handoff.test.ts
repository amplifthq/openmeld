import type { SignalTextEnvelope } from "@openmeld/protocol";
import {
  postNormalMessageBodySchema,
  spaceContextWorkHandoffSchema,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { assertSameSpaceSignalReplay } from "../src/space/application/space-signal-idempotency";
import { validateSpaceWorkHandoff } from "../src/space/application/space-work-handoff";

const handoff = {
  schemaVersion: 1 as const,
  files: [{ fileId: "report", revision: 5, relativePath: "report.md" }],
  skills: [],
  work: {
    goal: "Review the report",
    completed: "Drafted",
    nextSteps: "Check totals",
  },
  requirements: [],
};
const signal: SignalTextEnvelope = {
  v: 1,
  id: "source",
  spaceId: "a".repeat(64),
  type: "signal.text",
  ts: Date.parse("2026-09-19T00:00:00.000Z"),
  profile: { kind: "human", profileId: "human", profileName: "Human" },
  data: {
    text: "Review the report",
    contextSelection: {
      mode: "new",
      access: "space_context",
      workspace: "isolated",
    },
    meta: { clientMessageId: "handoff-1", workHandoff: handoff },
    files: [
      {
        fileId: "report",
        revision: 5,
        name: "report.md",
        mimeType: "text/markdown",
        sizeBytes: 20,
      },
    ],
    messageEnvelope: {
      text: "Review the report",
      activationTargets: ["e344e2c3-59f1-44c9-a4f1-63922aeb0f99"],
      referenceTargets: [],
      mentionTargets: [],
    },
  },
};
describe("Space-owned work handoff admission", () => {
  it.each([
    false,
    true,
  ])("accepts a source-bound handoff without a repository (files=%s) and rejects ambient access", async (withFiles) => {
    const brief = spaceContextWorkHandoffSchema.parse({
      ...handoff,
      schemaVersion: 2,
      sourceSignalId: signal.id,
      sourceRevision: 1,
      execution: { access: "space_context", workspace: "isolated" },
      files: withFiles ? handoff.files : [],
      work: {
        ...handoff.work,
        evidence: [],
        attemptedApproaches: [],
        decisions: [],
        constraints: [],
        openQuestions: [],
        completionCriteria: ["Report the checked totals"],
      },
    });
    const candidate: SignalTextEnvelope = {
      ...signal,
      id: "handoff-result",
      data: {
        ...signal.data,
        files: withFiles ? signal.data.files : [],
        meta: { clientMessageId: "brief-handoff", workHandoff: brief },
        messageEnvelope: {
          text: signal.data.text,
          activationTargets: ["e344e2c3-59f1-44c9-a4f1-63922aeb0f99"],
          referenceTargets: [],
          mentionTargets: [],
          replyToSignalId: signal.id,
        },
      },
    };
    const input = {
      env: {} as CoreBindings,
      organizationId: "org",
      signal: candidate,
      resolveFiles: () => signal.data.files ?? [],
      readSource: () => ({ signal, threadId: null }),
    };
    await expect(validateSpaceWorkHandoff(input)).resolves.toBeUndefined();
    for (const selection of [
      { mode: "new", workspace: "isolated" },
      { mode: "new", access: "workspace", workspace: "isolated" },
      { mode: "new", access: "space_context", workspace: "current" },
      {
        mode: "new",
        access: "space_context",
        workspace: "isolated",
        projectWork: {
          projectId: "ambient-project",
          repositoryFingerprint: `sha256:${"a".repeat(64)}`,
        },
      },
    ] as const) {
      await expect(
        validateSpaceWorkHandoff({
          ...input,
          signal: {
            ...candidate,
            data: { ...candidate.data, contextSelection: selection },
          },
        })
      ).rejects.toThrow("Keep the exact source");
    }
    for (const execution of [
      { workspace: "current", access: "space_context" },
      { workspace: "isolated" },
      { workspace: "isolated", access: "workspace" },
    ]) {
      expect(
        spaceWorkHandoffSchema.safeParse({ ...brief, execution }).success
      ).toBe(false);
    }
    expect(
      spaceWorkHandoffSchema.safeParse({
        ...brief,
        code: {
          projectId: "p",
          repositoryFingerprint: `sha256:${"a".repeat(64)}`,
        },
      }).success
    ).toBe(false);
  });

  it("binds code handoffs to the reviewed source, commit, and execution choices", async () => {
    const envelope = {
      text: signal.data.text,
      activationTargets: ["e344e2c3-59f1-44c9-a4f1-63922aeb0f99"],
      referenceTargets: [],
      mentionTargets: [],
    };
    const code = {
      schemaVersion: 2 as const,
      files: [],
      skills: [],
      requirements: [],
      sourceSignalId: signal.id,
      sourceRevision: 1,
      code: {
        projectId: "project",
        repositoryFingerprint: `sha256:${"a".repeat(64)}`,
        commit: "b".repeat(40),
      },
      execution: { workspace: "isolated" as const },
      work: {
        ...handoff.work,
        evidence: [],
        attemptedApproaches: [],
        decisions: [],
        constraints: [],
        openQuestions: [],
        completionCriteria: ["Targeted checks pass"],
      },
    };
    const candidate: SignalTextEnvelope = {
      ...signal,
      id: "handoff-message",
      data: {
        ...signal.data,
        files: [],
        meta: { clientMessageId: "code-handoff", workHandoff: code },
        contextSelection: {
          mode: "new",
          ...code.execution,
          projectWork: code.code,
        },
        messageEnvelope: {
          ...envelope,
          replyToSignalId: signal.id,
        },
      },
    };
    const input = {
      env: {} as CoreBindings,
      organizationId: "org",
      signal: candidate,
      resolveFiles: () => [],
      readSource: () => ({ signal, threadId: null }),
    };
    await expect(validateSpaceWorkHandoff(input)).resolves.toBeUndefined();
    await expect(
      validateSpaceWorkHandoff({
        ...input,
        threadId: "source-thread",
        threadRootSignalId: signal.id,
      })
    ).resolves.toBeUndefined();
    for (const data of [
      {
        ...candidate.data,
        contextSelection: {
          mode: "new" as const,
          ...code.execution,
          projectWork: { ...code.code, commit: "c".repeat(40) },
        },
      },
      {
        ...candidate.data,
        contextSelection: {
          mode: "new" as const,
          access: "workspace" as const,
          ...code.execution,
          projectWork: code.code,
        },
      },
      {
        ...candidate.data,
        messageEnvelope: {
          ...envelope,
          replyToSignalId: "another-message",
        },
      },
    ]) {
      await expect(
        validateSpaceWorkHandoff({ ...input, signal: { ...candidate, data } })
      ).rejects.toThrow("Keep the exact source");
    }
    await expect(
      validateSpaceWorkHandoff({ ...input, readSource: () => null })
    ).rejects.toThrow("original result");
    await expect(
      validateSpaceWorkHandoff({
        ...input,
        readSource: () => ({
          signal: {
            ...signal,
            data: {
              ...signal.data,
              text: "Changed after review",
              meta: { ...signal.data.meta, messageRevision: 2 },
            },
          },
          threadId: null,
        }),
      })
    ).rejects.toThrow("original result changed");
    await expect(
      validateSpaceWorkHandoff({ ...input, threadId: "another-thread" })
    ).rejects.toThrow("original result's conversation");
    const replay = {
      existing: candidate,
      authorProfileId: signal.profile.profileId,
      text: candidate.data.text,
      targetProfileIds: envelope.activationTargets,
      contextSelection: candidate.data.contextSelection,
      handoff: code,
      evidenceRefs: candidate.data.meta?.evidenceRefs,
    };
    expect(() => assertSameSpaceSignalReplay(replay)).not.toThrow();
    expect(() =>
      assertSameSpaceSignalReplay({
        ...replay,
        contextSelection: {
          mode: "new",
          ...code.execution,
          access: "workspace",
          projectWork: code.code,
        },
      })
    ).toThrow("different work");
    expect(() =>
      assertSameSpaceSignalReplay({
        ...replay,
        handoff: { ...code, code: { ...code.code, commit: "c".repeat(40) } },
      })
    ).toThrow("different work");
  });

  it("fences reference changes under an existing handoff identity", () => {
    const evidenceRefs = [
      {
        kind: "file" as const,
        spaceId: signal.spaceId,
        fileId: "report",
        revision: 5,
      },
    ];
    const existing = {
      ...signal,
      data: {
        ...signal.data,
        meta: { clientMessageId: "exact-evidence", evidenceRefs },
      },
    };
    const input = {
      existing,
      authorProfileId: signal.profile.profileId,
      text: signal.data.text,
      targetProfileIds: signal.data.messageEnvelope?.activationTargets ?? [],
      handoff: undefined,
      evidenceRefs,
    };
    expect(() => assertSameSpaceSignalReplay(input)).not.toThrow();
    expect(() =>
      assertSameSpaceSignalReplay({
        ...input,
        evidenceRefs: [{ ...evidenceRefs[0], revision: 6 }],
      })
    ).toThrow("different work");
    expect(() =>
      assertSameSpaceSignalReplay({ ...input, evidenceRefs: undefined })
    ).toThrow("different work");
    expect(
      postNormalMessageBodySchema.safeParse({
        ...existing.data,
        evidenceRefsVersion: 1,
      }).success
    ).toBe(true);
    expect(
      postNormalMessageBodySchema.safeParse({
        ...existing.data,
        evidenceRefsVersion: 2,
      }).success
    ).toBe(false);
  });

  it("accepts the explicit handoff version at the HTTP boundary", () => {
    expect(
      postNormalMessageBodySchema.safeParse({
        ...signal.data,
        workHandoffVersion: 1,
      }).success
    ).toBe(true);
    expect(
      postNormalMessageBodySchema.safeParse({
        ...signal.data,
        workHandoffVersion: 2,
      }).success
    ).toBe(false);
  });
  it("resolves exact revisions before accepting the complete selected set", async () => {
    const resolveFiles = vi.fn<
      Parameters<typeof validateSpaceWorkHandoff>[0]["resolveFiles"]
    >(() => signal.data.files ?? []);
    await validateSpaceWorkHandoff({
      env: {} as CoreBindings,
      organizationId: "org",
      signal,
      resolveFiles,
    });
    expect(resolveFiles.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: "report", revision: 5 }),
      ])
    );
    await expect(
      validateSpaceWorkHandoff({
        env: {} as CoreBindings,
        organizationId: "org",
        signal,
        resolveFiles: () => {
          throw new Error("file_missing");
        },
      })
    ).rejects.toThrow("file_missing");
    await expect(
      validateSpaceWorkHandoff({
        env: {} as CoreBindings,
        organizationId: "org",
        signal: { ...signal, data: { ...signal.data, files: [] } },
        resolveFiles,
      })
    ).rejects.toThrow();
  });
  it("does not let retries change the target, author, instructions, or pinned input", () => {
    const input = {
      existing: signal,
      authorProfileId: "human",
      handoff,
      text: signal.data.text,
      targetProfileIds: ["e344e2c3-59f1-44c9-a4f1-63922aeb0f99"],
    };
    expect(() => assertSameSpaceSignalReplay(input)).not.toThrow();
    for (const change of [
      { authorProfileId: "other" },
      { targetProfileIds: ["other"] },
      { text: "Different request" },
      {
        handoff: { ...handoff, files: [{ ...handoff.files[0], revision: 6 }] },
      },
    ]) {
      expect(() =>
        assertSameSpaceSignalReplay({ ...input, ...change })
      ).toThrow();
    }
  });
  it("rejects spoofed origin, unsupported versions, and ambiguous local paths", () => {
    for (const value of [
      { ...handoff, origin: { spaceId: "private" } },
      { ...handoff, schemaVersion: 2 },
      {
        ...handoff,
        files: [
          ...handoff.files,
          { fileId: "other", revision: 1, relativePath: "REPORT.md" },
        ],
      },
      {
        ...handoff,
        files: [{ ...handoff.files[0], relativePath: ".Git/config" }],
      },
    ]) {
      expect(spaceWorkHandoffSchema.safeParse(value).success).toBe(false);
    }
  });
});
