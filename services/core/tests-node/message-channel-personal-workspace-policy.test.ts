import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcBeginLarkPlatformRegistration,
  rpcConnectCenterAgentSlackWorkspace,
  rpcCreateSlackOAuthState,
  rpcPollLarkPlatformRegistration,
} from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

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
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let env: CoreBindings;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ('user-owner', 'Owner', 'owner@example.test')`,
    });

    await harness.query({
      values: [
        PERSONAL_ORGANIZATION_ID,
        "personal-felix",
        JSON.stringify({ personal: true }),
      ],
      text: 'INSERT INTO "openmeld"."organizations" (id, slug, metadata, "name", "created_at") VALUES ($1, $2, $3, \'Test Organization\', 1700000000000)',
    });
    await harness.query({
      values: [
        "member-owner",
        PERSONAL_ORGANIZATION_ID,
        OWNER_USER_ID,
        "owner",
      ],
      text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at") VALUES ($1, $2, $3, $4, 1700000000000)',
    });
    env = {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    } as CoreBindings;
  });

  afterEach(async () => await harness.close());

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
