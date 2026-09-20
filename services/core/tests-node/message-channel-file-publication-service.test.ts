import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  type CenterAgentPostChannelFileInput,
  rpcCenterAgentPostChannelFile,
} from "../src/remote-agent/application/message-channel-file-publication-service";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const state = vi.hoisted(() => ({
  authorization: {} as Record<string, unknown>,
  sourceId: "delivery",
  publish: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../src/center-agent/application/represented-member-request", () => ({
  prepareCenterAgentRepresentedMemberRequest: async () => ({
    authorization: state.authorization,
    representedHuman: { userId: "user", profileId: "human" },
    sourceNativeDeliveryId: state.sourceId,
  }),
}));
vi.mock("../src/center-agent/center-agent-audit", () => ({
  writeCenterAgentAuditEntry: state.audit,
}));
vi.mock("../src/remote-agent/application/message-channel-file-service", () => ({
  resolveAdmittedMessageChannelRequest: async () => ({
    trigger: { filePublicationSupported: true },
    delivery: { deliveryId: "delivery", dispatchId: "dispatch" },
    locator: {
      provider: "feishu",
      connectionId: "connection",
      rootMessageId: "root",
    },
    connection: { connectionId: "connection" },
    adapter: { publishFile: state.publish },
  }),
}));

describe("durable current-channel file sending", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  let request: CenterAgentPostChannelFileInput;
  beforeEach(async () => {
    vi.clearAllMocks();
    harness = createSqliteD1Harness();
    for (const sql of [
      "CREATE TABLE users (id text PRIMARY KEY)",
      "CREATE TABLE organizations (id text PRIMARY KEY)",
      "CREATE TABLE openmeld_profiles (profile_id text PRIMARY KEY)",
      "INSERT INTO users VALUES ('user')",
      "INSERT INTO organizations VALUES ('org')",
      "INSERT INTO openmeld_profiles VALUES ('agent')",
    ]) {
      harness.run({ sql });
    }
    applyDrizzleMigrationForTable(
      harness,
      "center_agent_publication_operations"
    );
    state.authorization = {
      db: harness.db,
      actorProfileId: "agent",
      activeOrganization: { organizationId: "org" },
    };
    state.sourceId = "delivery";
    state.publish.mockResolvedValue({
      status: "published",
      resultId: "om_sent",
    });
    const bytes = new TextEncoder().encode("hello");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    request = {
      context: { agentControllerConversationId: "dispatch" },
      conversationId: "conversation",
      contentBase64: btoa("hello"),
      contentSha256: Array.from(digest, (value) =>
        value.toString(16).padStart(2, "0")
      ).join(""),
      fileName: "report.txt",
      speakerMember: { memberId: "member", userId: "user" },
    } as CenterAgentPostChannelFileInput;
  });
  afterEach(() => harness.close());
  const env = {} as CoreBindings;
  it("replays the durable receipt without another upload", async () => {
    const first = await rpcCenterAgentPostChannelFile(env, request);
    expect(first).toMatchObject({
      messageId: "om_sent",
      fileName: "report.txt",
      sizeBytes: 5,
    });
    expect(await rpcCenterAgentPostChannelFile(env, request)).toEqual(first);
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.audit).toHaveBeenCalledOnce();
  });
  it("does not republish after an ambiguous provider response", async () => {
    state.publish.mockResolvedValue({
      status: "outcome_unknown",
      reasonCode: "feishu.file_reply_outcome_unknown",
    });
    await expect(
      rpcCenterAgentPostChannelFile(env, request)
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      rpcCenterAgentPostChannelFile(env, request)
    ).rejects.toMatchObject({
      code: "center_agent.publication_outcome_unknown",
    });
    expect(state.publish).toHaveBeenCalledOnce();
  });
  it("permits a retry only after confirmed non-publication", async () => {
    state.publish.mockResolvedValueOnce({
      status: "failed",
      reasonCode: "feishu.file_upload_failed",
    });
    await expect(
      rpcCenterAgentPostChannelFile(env, request)
    ).rejects.toMatchObject({ status: 502 });
    expect(await rpcCenterAgentPostChannelFile(env, request)).toMatchObject({
      messageId: "om_sent",
    });
    expect(state.publish).toHaveBeenCalledTimes(2);
    expect(
      state.publish.mock.calls[0]?.[0].providerPublicationIdempotencyKey
    ).toBe(state.publish.mock.calls[1]?.[0].providerPublicationIdempotencyKey);
  });
  it("rejects a changed digest before claiming or publishing", async () => {
    await expect(
      rpcCenterAgentPostChannelFile(env, {
        ...request,
        contentSha256: "a".repeat(64),
      })
    ).rejects.toMatchObject({ code: "message_channel.file_digest_mismatch" });
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("rejects a different represented source delivery", async () => {
    state.sourceId = "other";
    await expect(
      rpcCenterAgentPostChannelFile(env, request)
    ).rejects.toMatchObject({ status: 403 });
    expect(state.publish).not.toHaveBeenCalled();
  });
});
