import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcBeginLarkPlatformRegistration,
  rpcConnectCenterAgentSlackWorkspace,
  rpcCreateSlackOAuthState,
  rpcPollLarkPlatformRegistration,
} from "../src/rpc/methods";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const PERSONAL_ORGANIZATION_ID = "org-personal";
const OWNER_USER_ID = "user-owner";
const CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: PERSONAL_ORGANIZATION_ID,
  actorContext: {
    callerPrincipalId: OWNER_USER_ID,
    openMeldProfileId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: OWNER_USER_ID,
    profileKind: "human",
    profileName: "Felix",
    requestId: "req-personal-message-channel-policy",
  },
};

describe("Personal Workspace Message Channel policy", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  let env: CoreBindings;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL,
          metadata TEXT
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE members (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL
        )
      `,
    });
    harness.run({
      params: [
        PERSONAL_ORGANIZATION_ID,
        "personal-felix",
        JSON.stringify({ personal: true }),
      ],
      sql: "INSERT INTO organizations (id, slug, metadata) VALUES (?, ?, ?)",
    });
    harness.run({
      params: [
        "member-owner",
        PERSONAL_ORGANIZATION_ID,
        OWNER_USER_ID,
        "owner",
      ],
      sql: "INSERT INTO members (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)",
    });
    env = { OPENMELD_DB: harness.db } as CoreBindings;
  });

  afterEach(() => harness.close());

  it.each([
    [
      "manual Slack connection",
      () =>
        rpcConnectCenterAgentSlackWorkspace(env, {
          context: CONTEXT,
          slackTeamId: "T_PERSONAL",
        }),
    ],
    [
      "Slack OAuth state creation",
      () => rpcCreateSlackOAuthState(env, { context: CONTEXT }),
    ],
    [
      "Lark registration",
      () =>
        rpcBeginLarkPlatformRegistration(env, {
          context: CONTEXT,
          provider: "lark",
        }),
    ],
    [
      "Lark registration polling",
      () =>
        rpcPollLarkPlatformRegistration(env, {
          attemptId: "attempt-personal-lark",
          context: CONTEXT,
          provider: "lark",
        }),
    ],
  ])("rejects %s before provider state can be written", async (_label, action) => {
    await expect(action()).rejects.toMatchObject({
      code: "message_channel.organization_required",
      status: 409,
    });
  });
});
