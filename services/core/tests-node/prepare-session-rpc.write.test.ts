import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCreatePrepareSession } from "../src/prepare-session/transport/rpc/prepare-session-rpc";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const OWNER_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-prepare-reconnect",
  },
};

describe("prepare session RPC write", () => {
  it("returns a conflict when a Navigation Action already created setup", async () => {
    const harness = createSqliteD1Harness();
    const input = {
      context: OWNER_CONTEXT,
      humanProfileId: OWNER_CONTEXT.actorContext.openMeldProfileId,
      selectedLocalAgentIds: [],
      sourceNavigationAction: {
        signalId: "setup-action-1",
        spaceId: "center-agent-dm-1",
      },
      targetSpaceId: "center-agent-dm-1",
    };
    try {
      await rpcCreatePrepareSession(
        { OPENMELD_LOCAL_STATE_DB: harness.db } as CoreBindings,
        input
      );

      await expect(
        rpcCreatePrepareSession(
          { OPENMELD_LOCAL_STATE_DB: harness.db } as CoreBindings,
          input
        )
      ).rejects.toMatchObject({
        code: "prepare.session.navigation_action_already_started",
        status: 409,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a reconnect target that the authenticated owner does not own", async () => {
    const harness = createSqliteD1Harness();
    try {
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_connected_computers
            (owner_user_id, connected_computer_id, created_at_ms, updated_at_ms)
          VALUES ('owner-2', 'computer-other-owner', 1, 1)
        `,
      });

      await expect(
        rpcCreatePrepareSession(
          { OPENMELD_LOCAL_STATE_DB: harness.db } as CoreBindings,
          {
            connectedComputerId: "computer-other-owner",
            context: OWNER_CONTEXT,
            humanProfileId: OWNER_CONTEXT.actorContext.openMeldProfileId,
            selectedLocalAgentIds: [],
            targetSpaceId: null,
          }
        )
      ).rejects.toMatchObject({
        code: "connected_computer.reconnect_target_invalid",
        status: 409,
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldDaemon_prepare_sessions",
        })
      ).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });
});
