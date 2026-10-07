import type { SignalTextEnvelope } from "@openmeld/protocol";
import {
  postNormalMessageBodySchema,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  assertSameSpaceWorkHandoff,
  validateSpaceWorkHandoff,
} from "../src/space/application/space-work-handoff";

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
    expect(() => assertSameSpaceWorkHandoff(input)).not.toThrow();
    expect(() =>
      assertSameSpaceWorkHandoff({
        ...input,
        evidenceRefs: [{ ...evidenceRefs[0], revision: 6 }],
      })
    ).toThrow("different work");
    expect(() =>
      assertSameSpaceWorkHandoff({ ...input, evidenceRefs: undefined })
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
    expect(() => assertSameSpaceWorkHandoff(input)).not.toThrow();
    for (const change of [
      { authorProfileId: "other" },
      { targetProfileIds: ["other"] },
      { text: "Different request" },
      {
        handoff: { ...handoff, files: [{ ...handoff.files[0], revision: 6 }] },
      },
    ]) {
      expect(() =>
        assertSameSpaceWorkHandoff({ ...input, ...change })
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
