import { z } from "zod/v4";
import { agentProfileIdSchema } from "./profile";
import { nonEmptyTrimmedStringFromUnknown } from "./shared";

export const AGENT_STREAM_SNAPSHOT_MAX_CHARS = 32 * 1024;

const sequenceSchema = z.number().int().positive();
const timestampSchema = z.number().int().nonnegative();
const textSnapshotSchema = z
  .string()
  .min(1)
  .max(AGENT_STREAM_SNAPSHOT_MAX_CHARS);
const toolIdentifierSchema = z.string().trim().min(1).max(160);
const HOSTNAME_PATTERN =
  /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*$/iu;
const IPV6_HOSTNAME_PATTERN = /^\[[\da-f:.]+\]$/iu;
const REPOSITORY_LABEL_PATTERN =
  /^[a-z\d](?:[a-z\d_.-]*[a-z\d])?\/[a-z\d](?:[a-z\d_.-]*[a-z\d])?$/iu;
const agentWorkSubjectLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((label) => !hasControlCharacter(label), {
    message: "subject label must not contain control characters",
  });

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159))
    ) {
      return true;
    }
  }
  return false;
}

const agentWorkActivityKeySchema = z.enum([
  "agent.activity.read",
  "agent_profile.configure",
  "agent_profile.connect",
  "agent_profile.connections.read",
  "agent_profile.create",
  "agent_profile.enable",
  "agent_profile.readiness.check",
  "agent_profile.settings.update",
  "build.run",
  "center_agent.activity.read",
  "center_agent.attention.request",
  "center_agent.task.create",
  "connected_app.action.execute",
  "connected_app.actions.read",
  "connected_apps.read",
  "dependencies.install",
  "dispatch.history.read",
  "documentation.read",
  "documentation.update",
  "environment.check",
  "execution.recovery.conversation.resume",
  "execution.recovery.inspect",
  "execution.recovery.result.replay",
  "execution.recovery.retry_as_new_execution",
  "feedback.create",
  "feedback.read",
  "feedback.update",
  "github.account.read",
  "github.branches.read",
  "github.checks.read",
  "github.code.search",
  "github.commits.compare",
  "github.commits.read",
  "github.commits.search",
  "github.directory.read",
  "github.file.delete",
  "github.file.read",
  "github.file.update",
  "github.issue.assignees.update",
  "github.issue.comment",
  "github.issue.create",
  "github.issue.labels.update",
  "github.issue.update",
  "github.issues.read",
  "github.issues.search",
  "github.pull_request.branch.update",
  "github.pull_request.comment",
  "github.pull_request.create",
  "github.pull_request.merge",
  "github.pull_request.review",
  "github.pull_request.reviewers.update",
  "github.pull_request.update",
  "github.pull_requests.read",
  "github.ref.create",
  "github.repositories.read",
  "github.repository.read",
  "github.workflow.rerun",
  "github.workflows.read",
  "image.generate",
  "image.inspect",
  "navigation.prepare",
  "organization.document.draft",
  "organization.documents.manage",
  "organization.documents.read",
  "organization.invite.create",
  "organization.invite.read",
  "organization.member_service_status.read",
  "organization.members.read",
  "organization.memory.update",
  "organization.skills.install",
  "organization.skills.read",
  "project.create",
  "project.default.set",
  "project.remove",
  "project.remove.prepare",
  "project.update",
  "projects.read",
  "quality.check",
  "repository.check",
  "repository.clone",
  "repository.inspect",
  "routine.create",
  "routine.delete",
  "routine.pause",
  "routine.resume",
  "routine.update",
  "routines.read",
  "slack.channel.history.read",
  "slack.channel.members.read",
  "slack.channels.read",
  "slack.members.read",
  "slack.message.post",
  "slack.messages.search",
  "source.read",
  "source.search",
  "source.update",
  "space.agents.add",
  "space.agents.remove",
  "space.agents.wake",
  "space.context.read",
  "space.create",
  "space.members.add",
  "space.message.post",
  "space.settings.update",
  "spaces.read",
  "task.delegate",
  "task.watch",
  "tasks.read",
  "tests.run",
  "web.data.extract",
  "web.links.read",
  "web.search",
  "webpage.read",
  "webpage.scrape",
  "webpage.screenshot",
]);

const agentWorkSubjectKindSchema = z.enum([
  "agent_profile",
  "connected_app",
  "document",
  "organization",
  "project",
  "repository",
  "routine",
  "space",
  "website",
]);

const AGENT_WORK_SUBJECT_KIND_BY_KEY: Partial<
  Record<
    z.infer<typeof agentWorkActivityKeySchema>,
    z.infer<typeof agentWorkSubjectKindSchema>
  >
> = {
  "agent_profile.configure": "agent_profile",
  "agent_profile.create": "agent_profile",
  "connected_app.action.execute": "connected_app",
  "connected_app.actions.read": "connected_app",
  "github.branches.read": "repository",
  "github.checks.read": "repository",
  "github.code.search": "repository",
  "github.commits.compare": "repository",
  "github.commits.read": "repository",
  "github.commits.search": "repository",
  "github.directory.read": "repository",
  "github.file.delete": "repository",
  "github.file.read": "repository",
  "github.file.update": "repository",
  "github.issue.assignees.update": "repository",
  "github.issue.comment": "repository",
  "github.issue.create": "repository",
  "github.issue.labels.update": "repository",
  "github.issue.update": "repository",
  "github.issues.read": "repository",
  "github.issues.search": "repository",
  "github.pull_request.branch.update": "repository",
  "github.pull_request.comment": "repository",
  "github.pull_request.create": "repository",
  "github.pull_request.merge": "repository",
  "github.pull_request.review": "repository",
  "github.pull_request.reviewers.update": "repository",
  "github.pull_request.update": "repository",
  "github.pull_requests.read": "repository",
  "github.ref.create": "repository",
  "github.repository.read": "repository",
  "github.workflow.rerun": "repository",
  "github.workflows.read": "repository",
  "organization.document.draft": "document",
  "project.create": "project",
  "project.update": "project",
  "repository.clone": "repository",
  "routine.create": "routine",
  "routine.update": "routine",
  "space.create": "space",
  "space.settings.update": "space",
  "web.data.extract": "website",
  "web.links.read": "website",
  "webpage.read": "website",
  "webpage.scrape": "website",
  "webpage.screenshot": "website",
};

const agentWorkSubjectSchema = z
  .strictObject({
    kind: agentWorkSubjectKindSchema,
    label: agentWorkSubjectLabelSchema,
  })
  .superRefine((subject, context) => {
    if (
      subject.kind === "repository" &&
      !REPOSITORY_LABEL_PATTERN.test(subject.label)
    ) {
      context.addIssue({
        code: "custom",
        message: "repository subject must use owner/name",
        path: ["label"],
      });
    }
    if (
      subject.kind === "website" &&
      !(
        HOSTNAME_PATTERN.test(subject.label) ||
        IPV6_HOSTNAME_PATTERN.test(subject.label)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "website subject must be a hostname",
        path: ["label"],
      });
    }
  });

const agentWorkActivitySchema = z
  .strictObject({
    v: z.literal(1),
    key: agentWorkActivityKeySchema,
    subject: agentWorkSubjectSchema.optional(),
  })
  .superRefine((work, context) => {
    if (
      work.subject &&
      AGENT_WORK_SUBJECT_KIND_BY_KEY[work.key] !== work.subject.kind
    ) {
      context.addIssue({
        code: "custom",
        message: "subject kind is not allowed for this work key",
        path: ["subject", "kind"],
      });
    }
  });

const agentStreamIdentityShape = {
  v: z.literal(1),
  spaceId: nonEmptyTrimmedStringFromUnknown,
  streamId: nonEmptyTrimmedStringFromUnknown,
  sequence: sequenceSchema,
  profileId: agentProfileIdSchema,
  triggerMessageId: nonEmptyTrimmedStringFromUnknown,
  dispatchId: nonEmptyTrimmedStringFromUnknown,
};

const agentStreamPresenceShape = {
  ...agentStreamIdentityShape,
  state: z.literal("streaming"),
  gapDetected: z.boolean(),
  createdAtMs: timestampSchema,
  updatedAtMs: timestampSchema,
  expiresAtMs: timestampSchema,
};

function validateAgentStreamProjectionTimestamps(
  projection: {
    createdAtMs: number;
    expiresAtMs: number;
    updatedAtMs: number;
  },
  context: z.RefinementCtx
): void {
  if (projection.updatedAtMs < projection.createdAtMs) {
    context.addIssue({
      code: "custom",
      message: "updatedAtMs must not precede createdAtMs",
      path: ["updatedAtMs"],
    });
  }
  if (projection.expiresAtMs < projection.updatedAtMs) {
    context.addIssue({
      code: "custom",
      message: "expiresAtMs must not precede updatedAtMs",
      path: ["expiresAtMs"],
    });
  }
}

export const spaceAgentStreamPresenceSchema = z
  .strictObject(agentStreamPresenceShape)
  .superRefine(validateAgentStreamProjectionTimestamps);

export const spaceAgentStreamSnapshotSchema = z
  .strictObject({
    ...agentStreamPresenceShape,
    textSnapshot: textSnapshotSchema,
  })
  .superRefine(validateAgentStreamProjectionTimestamps);

const spaceAgentStreamTextDeltaFrameSchema = z.strictObject({
  type: z.literal("space.agent_stream_delta"),
  ...agentStreamIdentityShape,
  kind: z.literal("text").optional(),
  textSnapshot: textSnapshotSchema,
  state: z.literal("streaming"),
  updatedAtMs: timestampSchema,
});

const spaceAgentStreamThinkingDeltaFrameSchema = z.strictObject({
  type: z.literal("space.agent_stream_delta"),
  ...agentStreamIdentityShape,
  kind: z.literal("thinking"),
  thinkingSnapshot: textSnapshotSchema,
  state: z.literal("streaming"),
  updatedAtMs: timestampSchema,
});

export const spaceAgentStreamDeltaFrameSchema = z.union([
  spaceAgentStreamTextDeltaFrameSchema,
  spaceAgentStreamThinkingDeltaFrameSchema,
]);

export const agentStreamToolPartSchema = z.strictObject({
  type: z.literal("tool"),
  toolCallId: toolIdentifierSchema,
  toolName: toolIdentifierSchema,
  state: z.enum(["input-available", "output-available", "output-error"]),
  work: agentWorkActivitySchema.optional(),
});

export const spaceAgentActivitySchema = z.strictObject({
  v: z.literal(1),
  steps: z
    .array(
      agentStreamToolPartSchema.pick({
        toolName: true,
        state: true,
        work: true,
      })
    )
    .min(1)
    .max(50),
  truncated: z.boolean(),
});

export const spaceAgentStreamPartFrameSchema = z.strictObject({
  type: z.literal("space.agent_stream_part"),
  ...agentStreamIdentityShape,
  part: agentStreamToolPartSchema,
  updatedAtMs: timestampSchema,
});

export const spaceAgentStreamTerminalSchema = z.union([
  z.strictObject({
    kind: z.literal("final_message"),
    publishedSignalId: nonEmptyTrimmedStringFromUnknown,
  }),
  z.strictObject({
    kind: z.literal("failed"),
    reasonCode: nonEmptyTrimmedStringFromUnknown,
    noticeText: nonEmptyTrimmedStringFromUnknown,
  }),
  z.strictObject({
    kind: z.literal("stopped"),
    reasonCode: nonEmptyTrimmedStringFromUnknown,
    noticeText: nonEmptyTrimmedStringFromUnknown,
  }),
  z.strictObject({
    kind: z.literal("completed_but_publish_failed"),
    reasonCode: z.literal("remote_agent.callback_publish_failed"),
    noticeText: nonEmptyTrimmedStringFromUnknown,
  }),
]);

export const spaceAgentStreamTerminalFrameSchema = z.strictObject({
  type: z.literal("space.agent_stream_terminal"),
  ...agentStreamIdentityShape,
  terminal: spaceAgentStreamTerminalSchema,
  updatedAtMs: timestampSchema,
});
