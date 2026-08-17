import { describe, expect, it } from "vitest";
import {
  createOpportunityService,
  OpportunityConflictError,
  OpportunityNotFoundError,
} from "../src/opportunities/application/opportunity-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const RECOMMENDATION = {
  evidence: ["The Organization does not have a recurring release review."],
  expectedBenefit: "Catch release blockers before customers encounter them.",
  observation: "Release reviews happen manually after deployment.",
  opportunityKey: "release-review:weekly-check",
  suggestedNextStep: "Create a weekly release-review Routine.",
  title: "Review releases before they ship",
};

describe("Opportunity service", () => {
  it("creates one quiet private Inbox update and deduplicates exact retries", async () => {
    const harness = createOpportunityHarness();
    try {
      const service = createOpportunityService(harness.db);
      const first = await service.recommend({
        createdByProfileId: "agent-center",
        nowMs: 2000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: RECOMMENDATION,
        sourceNativeDeliveryId: "delivery-1",
      });
      const replay = await service.recommend({
        createdByProfileId: "agent-center",
        nowMs: 3000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: RECOMMENDATION,
        sourceNativeDeliveryId: "delivery-1",
      });

      expect(first.created).toBe(true);
      expect(replay).toMatchObject({
        created: false,
        opportunity: { id: first.opportunity.id, status: "open" },
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM organization_opportunities",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{
          attention: string;
          importance: string;
          recipient_user_id: string;
          source_kind: string;
          source_target_json: string;
        }>({
          sql: `
            SELECT attention, importance, recipient_user_id, source_kind, source_target_json
            FROM inbox_items
          `,
        })
      ).toEqual({
        attention: "update",
        importance: "normal",
        recipient_user_id: "user-one",
        source_kind: "organization_opportunity",
        source_target_json: '{"kind":"center_agent"}',
      });
    } finally {
      harness.close();
    }
  });

  it("fails fast when a stable key is reused for different content", async () => {
    const harness = createOpportunityHarness();
    try {
      const service = createOpportunityService(harness.db);
      await service.recommend({
        createdByProfileId: "agent-center",
        nowMs: 2000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: RECOMMENDATION,
        sourceNativeDeliveryId: null,
      });

      await expect(
        service.recommend({
          createdByProfileId: "agent-center",
          nowMs: 3000,
          organizationId: "org-opportunity",
          recipientUserId: "user-one",
          request: {
            ...RECOMMENDATION,
            expectedBenefit: "A different recommendation cannot reuse the key.",
          },
          sourceNativeDeliveryId: null,
        })
      ).rejects.toBeInstanceOf(OpportunityConflictError);
    } finally {
      harness.close();
    }
  });

  it("lets only the recipient decide without turning Inbox into decision truth", async () => {
    const harness = createOpportunityHarness();
    try {
      const service = createOpportunityService(harness.db);
      const { opportunity } = await service.recommend({
        createdByProfileId: "agent-center",
        nowMs: 2000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: RECOMMENDATION,
        sourceNativeDeliveryId: null,
      });

      await expect(
        service.respond({
          nowMs: 3000,
          organizationId: "org-opportunity",
          recipientUserId: "user-two",
          request: { decision: "accepted", opportunityId: opportunity.id },
        })
      ).rejects.toBeInstanceOf(OpportunityNotFoundError);

      const accepted = await service.respond({
        nowMs: 4000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: { decision: "accepted", opportunityId: opportunity.id },
      });
      const replay = await service.respond({
        nowMs: 5000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: { decision: "accepted", opportunityId: opportunity.id },
      });

      expect(accepted).toMatchObject({
        changed: true,
        opportunity: { decidedAtMs: 4000, status: "accepted" },
      });
      expect(replay.changed).toBe(false);
      expect(
        harness.queryFirst<{ resolution_status: string }>({
          sql: "SELECT resolution_status FROM inbox_items",
        })?.resolution_status
      ).toBe("not_applicable");
      await expect(
        service.respond({
          nowMs: 6000,
          organizationId: "org-opportunity",
          recipientUserId: "user-one",
          request: { decision: "dismissed", opportunityId: opportunity.id },
        })
      ).rejects.toBeInstanceOf(OpportunityConflictError);
    } finally {
      harness.close();
    }
  });

  it("treats not now as a reversible decision without reopening Inbox", async () => {
    const harness = createOpportunityHarness();
    try {
      const service = createOpportunityService(harness.db);
      const { opportunity } = await service.recommend({
        createdByProfileId: "agent-center",
        nowMs: 2000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: RECOMMENDATION,
        sourceNativeDeliveryId: null,
      });

      const deferred = await service.respond({
        nowMs: 3000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: { decision: "deferred", opportunityId: opportunity.id },
      });
      const acceptedLater = await service.respond({
        nowMs: 4000,
        organizationId: "org-opportunity",
        recipientUserId: "user-one",
        request: { decision: "accepted", opportunityId: opportunity.id },
      });

      expect(deferred.opportunity.status).toBe("deferred");
      expect(acceptedLater.opportunity.status).toBe("accepted");
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ resolution_status: string }>({
          sql: "SELECT resolution_status FROM inbox_items",
        })?.resolution_status
      ).toBe("not_applicable");
    } finally {
      harness.close();
    }
  });
});

function createOpportunityHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "organization_opportunities",
    "inbox_items",
  ]);
  harness.run({
    params: ["org-opportunity", "Opportunity Org", "opportunity-org", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  for (const [id, name, email] of [
    ["user-one", "One", "one@example.com"],
    ["user-two", "Two", "two@example.com"],
  ] as const) {
    harness.run({
      params: [id, name, email],
      sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    });
  }
  return harness;
}
