import { spaceWorkHandoffV2Schema } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import type { SpaceApi } from "../src/space/types";
import { postSpaceWorkHandoff } from "../src/space/work-handoff";

it.each(
  [undefined, "thread-1"].flatMap((threadId) =>
    ["brief", "files", "repository"].map((materials) => ({
      threadId,
      materials,
    }))
  )
)("publishes one $materials handoff in its original placement ($threadId)", async ({
  threadId,
  materials,
}) => {
  const postNormalMessage = vi
    .fn<SpaceApi["postNormalMessage"]>()
    .mockRejectedValue(new Error("Unknown send outcome"));
  const postThreadSignal = vi
    .fn<SpaceApi["postThreadSignal"]>()
    .mockRejectedValue(new Error("Unknown send outcome"));
  const api = { postNormalMessage, postThreadSignal } as unknown as SpaceApi;
  const handoff = spaceWorkHandoffV2Schema.parse({
    schemaVersion: 2,
    sourceSignalId: "plan",
    sourceRevision: 3,
    ...(materials === "repository"
      ? {
          code: {
            projectId: "project",
            repositoryFingerprint: `sha256:${"a".repeat(64)}`,
            commit: "b".repeat(40),
          },
          execution: { workspace: "isolated" },
        }
      : {
          execution: { workspace: "isolated", access: "space_context" },
        }),
    files:
      materials === "files"
        ? [{ fileId: "report", revision: 7, relativePath: "report.md" }]
        : [],
    skills: [],
    requirements: [],
    work: {
      goal: "Implement the plan",
      completed: "Observed failure",
      nextSteps: "Fix and test",
      evidence: ["Exact reproduction"],
      attemptedApproaches: ["Previous attempt"],
      decisions: ["Keep the existing owner"],
      constraints: ["No external writes"],
      openQuestions: ["One remaining question"],
      completionCriteria: ["Report passing checks"],
    },
  });
  await expect(
    postSpaceWorkHandoff(api, {
      spaceId: "space",
      clientMessageId: "stable-id",
      targetProfileId: "receiver",
      threadId,
      handoff,
    })
  ).rejects.toThrow("Unknown send outcome");
  expect(
    postNormalMessage.mock.calls.length + postThreadSignal.mock.calls.length
  ).toBe(1);
  const body = threadId
    ? postThreadSignal.mock.calls[0]?.[0].body
    : postNormalMessage.mock.calls[0]?.[0];
  expect(body?.contextSelection).toEqual({
    mode: "new",
    workspace: "isolated",
    ...(handoff.code
      ? { projectWork: handoff.code }
      : { access: "space_context" }),
  });
  if (!handoff.code) {
    expect(body?.text).not.toContain("Published commit:");
    expect(body?.contextSelection).not.toHaveProperty("projectWork");
  }
  expect(body?.files).toEqual(
    handoff.files.map((file) =>
      expect.objectContaining({
        fileId: file.fileId,
        revision: file.revision,
      })
    )
  );
  expect(body?.messageEnvelope).toMatchObject({
    activationTargets: ["receiver"],
    replyToSignalId: "plan",
  });
  for (const value of [
    "Exact reproduction",
    "Previous attempt",
    "Keep the existing owner",
    "No external writes",
    "One remaining question",
    "Report passing checks",
  ]) {
    expect(body?.text).toContain(value);
  }
  if (threadId) {
    expect(postThreadSignal.mock.calls[0]?.[0]).toMatchObject({
      threadId,
      body: { clientMessageId: "stable-id", workHandoff: handoff },
    });
  } else {
    expect(postNormalMessage.mock.calls[0]?.[0].meta).toMatchObject({
      clientMessageId: "stable-id",
      workHandoff: handoff,
    });
  }
});
