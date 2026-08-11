import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  resolveAccountSpaceActiveWakeGatewayHost,
  rpcListAccountSpaceActiveWakeSummary,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("account Space active Wake summary RPC", () => {
  it("keeps an older Gateway request scoped by Core configuration", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationsForTables(harness, [
      "space_index_spaces",
      "space_index_memberships",
    ]);
    try {
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_GATEWAY_URL: "https://GATEWAY.OPENMELD.TEST/path",
        OPENMELD_LOCAL_STATE_DB: harness.db,
        OPENMELD_WAKE_EVIDENCE_DB: harness.db,
      } as CoreBindings;
      await expect(
        rpcListAccountSpaceActiveWakeSummary(env, {
          ownerUserId: "owner-one",
          selectedProfileId: "profile-one",
        })
      ).resolves.toMatchObject({ items: [] });
      expect(
        resolveAccountSpaceActiveWakeGatewayHost({
          configuredGatewayUrl: env.OPENMELD_GATEWAY_URL,
        })
      ).toBe("gateway.openmeld.test");
    } finally {
      harness.close();
    }
  });
});
