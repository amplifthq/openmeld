import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  listConnectorAppRequestsForRequester,
  upsertConnectorAppRequest,
} from "../src/connectors/connector-app-request-repository";
import { env } from "../test-support/worker-env";

describe("connector App request repository", () => {
  it("keeps one durable request per Organization, requester, and provider", async () => {
    const fixtureId = crypto.randomUUID();
    const organizationId = `org-request-${fixtureId}`;
    const userId = `user-request-${fixtureId}`;
    const memberId = `member-request-${fixtureId}`;
    const nowMs = Date.now();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: `
          INSERT INTO "openmeld"."users" (
            id, name, email, email_verified, created_at, updated_at
          ) VALUES ($1, 'Mira', $2, 1, $3, $4)
        `,
              values: [],
            },
            values: [userId, `${fixtureId}@example.test`, nowMs, nowMs],
          },
          {
            ...{
              text: `
          INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
          VALUES ($1, 'Acme', $2, $3)
        `,
              values: [],
            },
            values: [organizationId, `acme-${fixtureId}`, nowMs],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'member', $4)
      `,
        values: [],
      },
      values: [memberId, organizationId, userId, nowMs],
    });
    const initial = await upsertConnectorAppRequest({
      db: getPostgresDatabase(env),
      nowMs,
      organizationId,
      providerId: "microsoft-teams",
      providerName: "Microsoft Teams",
      requestedCapabilities: [],
      requesterMemberId: memberId,
      requesterUserId: userId,
      source: "openconnector_catalog",
      useCase: "Coordinate customer escalations.",
    });
    const updated = await upsertConnectorAppRequest({
      db: getPostgresDatabase(env),
      nowMs: nowMs + 1,
      organizationId,
      providerId: "MICROSOFT-TEAMS",
      providerName: "Microsoft Teams",
      requestedCapabilities: ["messages", "meetings"],
      requesterMemberId: memberId,
      requesterUserId: userId,
      source: "openconnector_catalog",
      useCase: "Keep engineering and support aligned.",
    });
    expect(updated.id).toBe(initial.id);
    expect(updated).toMatchObject({
      providerId: "MICROSOFT-TEAMS",
      requestedCapabilities: ["messages", "meetings"],
      requesterMemberId: memberId,
      requesterUserId: userId,
      status: "requested",
      useCase: "Keep engineering and support aligned.",
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        UPDATE "openmeld"."connector_app_requests"
        SET status = 'declined',
            available_at_ms = $1,
            notified_at_ms = $2
        WHERE id = $3
      `,
        values: [],
      },
      values: [nowMs + 2, nowMs + 3, updated.id],
    });
    const reopened = await upsertConnectorAppRequest({
      db: getPostgresDatabase(env),
      nowMs: nowMs + 4,
      organizationId,
      providerId: "microsoft-teams",
      providerName: "Microsoft Teams",
      requestedCapabilities: ["messages"],
      requesterMemberId: memberId,
      requesterUserId: userId,
      source: "openconnector_catalog",
      useCase: "Please reconsider this request.",
    });
    expect(reopened).toMatchObject({
      availableAtMs: null,
      id: initial.id,
      notifiedAtMs: null,
      status: "requested",
      useCase: "Please reconsider this request.",
    });
    await expect(
      listConnectorAppRequestsForRequester({
        db: getPostgresDatabase(env),
        organizationId,
        requesterUserId: userId,
      })
    ).resolves.toEqual([reopened]);
  });
});
