import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  listConnectorAppRequestsForRequester,
  upsertConnectorAppRequest,
} from "../src/connectors/connector-app-request-repository";

describe("connector App request repository", () => {
  it("keeps one durable request per Organization, requester, and provider", async () => {
    const fixtureId = crypto.randomUUID();
    const organizationId = `org-request-${fixtureId}`;
    const userId = `user-request-${fixtureId}`;
    const memberId = `member-request-${fixtureId}`;
    const nowMs = Date.now();
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO users (
            id, name, email, email_verified, created_at, updated_at
          ) VALUES (?, 'Mira', ?, 1, ?, ?)
        `
      ).bind(userId, `${fixtureId}@example.test`, nowMs, nowMs),
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO organizations (id, name, slug, created_at)
          VALUES (?, 'Acme', ?, ?)
        `
      ).bind(organizationId, `acme-${fixtureId}`, nowMs),
    ]);
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, 'member', ?)
      `
    )
      .bind(memberId, organizationId, userId, nowMs)
      .run();

    const initial = await upsertConnectorAppRequest({
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
    await env.OPENMELD_DB.prepare(
      `
        UPDATE connector_app_requests
        SET status = 'declined',
            available_at_ms = ?,
            notified_at_ms = ?
        WHERE id = ?
      `
    )
      .bind(nowMs + 2, nowMs + 3, updated.id)
      .run();
    const reopened = await upsertConnectorAppRequest({
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        organizationId,
        requesterUserId: userId,
      })
    ).resolves.toEqual([reopened]);
  });
});
