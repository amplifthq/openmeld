import { accountDeletionPreviewSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import { recordUserTimeZoneObservation } from "../../core/src/user-time-context/user-time-context-repository";
import {
  requestAccountConnectionCleanup,
  runAccountDeletionCleanup,
} from "../src/lib/account/deletion-service";
import type { AuthBindings } from "../src/lib/bindings";
import { createAuthWorkerTestApp } from "./support/auth-worker-entrypoint.test-support";

const password = "disposable-account-test-password";
const origin = "http://localhost:3000";
const contexts: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await Promise.allSettled(context.background);
    await context.harness.close();
  }
});

describe("account deletion", () => {
  it("preserves an Owner when account departure races an Owner role change", async () => {
    const context = await fixture();
    const initial = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    const organizationId = initial.deleteOrganizations[0]?.id;
    if (!organizationId) {
      throw new Error("Missing workspace fixture.");
    }
    await context.harness.query({
      text: "UPDATE openmeld.organizations SET metadata=NULL WHERE id=$1",
      values: [organizationId],
    });
    await context.harness.query({
      text: "INSERT INTO openmeld.users(id,name,email) VALUES('remaining-owner','Remaining Owner','remaining-owner@example.test')",
    });
    await context.harness.query({
      text: "INSERT INTO openmeld.members(id,organization_id,user_id,role,created_at) VALUES('remaining-owner-member',$1,'remaining-owner','owner',$2)",
      values: [organizationId, Date.now()],
    });
    const preview = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    const responses = await Promise.all([
      context.request("/v1/account/deletion", {
        confirmation: "DELETE",
        confirmationToken: preview.confirmationToken,
        password,
      }),
      context.request("/api/auth/organization/update-member-role", {
        organizationId,
        memberId: "remaining-owner-member",
        role: "member",
      }),
    ]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    const owners = await context.harness.queryAll({
      text: "SELECT id FROM openmeld.members WHERE organization_id=$1 AND 'owner'=ANY(string_to_array(role,','))",
      values: [organizationId],
    });
    expect(owners).toHaveLength(1);
  });

  it("retries a late credential disconnect after the workspace has already been removed", async () => {
    const context = await fixture();
    const preview = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    const organizationId = preview.deleteOrganizations[0]?.id;
    if (!organizationId) {
      throw new Error("Missing workspace");
    }
    await context.harness.query({
      text: `INSERT INTO "openmeld"."connector_connections" (connection_name,organization_id,user_id,scope,service,status,created_at_ms,updated_at_ms) VALUES ('late-connection',$1,$2,'member','posthog','pending',1,1)`,
      values: [organizationId, context.userId],
    });
    expect(
      (
        await context.request("/v1/account/deletion", {
          confirmation: "DELETE",
          confirmationToken: preview.confirmationToken,
          password,
        })
      ).status
    ).toBe(202);
    await Promise.allSettled(context.background);
    const target = {
      userId: context.userId,
      connectionName: "late-connection",
      service: "posthog",
    };
    await context.harness.query({
      text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
      values: [organizationId],
    });
    await context.harness.query({
      text: `UPDATE "openmeld"."account_deletion_requests" SET completed_at_ms = 1,pending_connections_json = '[]'`,
    });
    expect(await requestAccountConnectionCleanup(context.env, target)).toBe(
      true
    );
    expect(
      await requestAccountConnectionCleanup(context.env, {
        ...target,
        connectionName: "unrelated-team",
      })
    ).toBe(false);
    await runAccountDeletionCleanup(context.env);
    expect(
      await context.harness.queryFirst({
        text: 'SELECT pending_connections_json FROM "openmeld"."account_deletion_requests"',
      })
    ).toMatchObject({
      pending_connections_json: expect.stringContaining("late-connection"),
    });
    const disconnected: unknown[] = [];
    if (!context.env.OPENMELD_CORE_WORKER) {
      throw new Error("Missing Core");
    }
    context.env.OPENMELD_CORE_WORKER.cleanupDeletedAccountConnection = (
      input
    ) => {
      disconnected.push(input);
      return Promise.resolve();
    };
    await context.harness.query({
      text: 'UPDATE "openmeld"."account_deletion_requests" SET next_attempt_at_ms = 0',
    });
    await runAccountDeletionCleanup(context.env);
    expect(disconnected).toEqual([target]);
    expect(
      await context.harness.queryFirst({
        text: 'SELECT pending_connections_json,completed_at_ms FROM "openmeld"."account_deletion_requests"',
      })
    ).toEqual({ pending_connections_json: "[]", completed_at_ms: 1 });
  });
  it("requires the current password, closes cached sessions, and preserves a retry when cleanup fails", async () => {
    const context = await fixture();
    const preview = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    expect(preview.deleteOrganizations).toHaveLength(1);
    expect(preview.requiresPassword).toBe(true);
    await context.harness.query({
      text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
        VALUES ('deleted-owner-agent', $1, $2, 'claude-code', 'detected')`,
      values: [preview.deleteOrganizations[0]?.id, context.userId],
    });
    const observeTime = () =>
      recordUserTimeZoneObservation({
        db: context.harness.db,
        userId: context.userId,
        observation: { timeZone: "Asia/Taipei", source: "desktop" },
        nowMs: Date.now(),
      });
    await observeTime();
    const body = {
      confirmation: "DELETE",
      confirmationToken: preview.confirmationToken,
      password: "wrong-password",
    };
    expect((await context.request("/v1/account/deletion", body)).status).toBe(
      400
    );
    expect(
      (await context.request("/v1/account/deletion", { ...body, password }))
        .status
    ).toBe(202);
    await Promise.allSettled(context.background);
    expect((await context.request("/v1/account/deletion")).status).toBe(401);
    const session = await context.request("/api/auth/get-session");
    expect(session.status === 401 || (await session.text()) === "null").toBe(
      true
    );
    const user = await context.harness.queryFirst({
      text: 'SELECT id, name, email, deleted_at FROM "openmeld"."users"',
    });
    expect(user).toMatchObject({ id: context.userId, name: "Deleted account" });
    expect(user?.deleted_at).toBeTruthy();
    expect(user?.email).not.toBe("account-delete@example.test");
    expect(
      await context.harness.queryFirst({
        text: 'SELECT completed_at_ms, attempt_count FROM "openmeld"."account_deletion_requests"',
      })
    ).toMatchObject({ completed_at_ms: null, attempt_count: 1 });
    for (const table of [
      "sessions",
      "accounts",
      "passkeys",
      "device_codes",
      "openmeld_profiles",
      "member_agents",
      "user_time_contexts",
    ]) {
      expect(
        (
          await context.harness.queryAll({
            text: `SELECT * FROM "openmeld"."${table}"`,
          })
        ).length
      ).toBe(0);
    }
    await expect(observeTime()).rejects.toThrow("account_unavailable");
    expect(
      await context.harness.queryFirst({
        text: 'SELECT 1 FROM "openmeld"."user_time_contexts" WHERE user_id = $1',
        values: [context.userId],
      })
    ).toBeNull();
    await expect(
      context.harness.query({
        text: `INSERT INTO "openmeld"."sessions" (id, token, user_id, expires_at, updated_at) VALUES ('late-session', 'late-token', $1, $2, $2)`,
        values: [context.userId, Date.now() + 60_000],
      })
    ).rejects.toThrow("account_unavailable");
    await expect(
      context.harness.query({
        text: 'UPDATE "openmeld"."users" SET name = \'Restored name\' WHERE id = $1',
        values: [context.userId],
      })
    ).rejects.toThrow("account_unavailable");
  });

  it("requires a new preview after a workspace gains a member and blocks sole owner departure", async () => {
    const context = await fixture();
    const preview = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    const organization = preview.deleteOrganizations[0];
    if (!organization) {
      throw new Error("Missing personal workspace fixture");
    }
    await context.harness.query({
      text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('teammate','Teammate','teammate@example.test')`,
    });
    // The public product does not admit members to a personal workspace. This
    // fixture represents the normal workspace that account deletion also supports.
    await context.harness.query({
      text: 'UPDATE "openmeld"."organizations" SET metadata = NULL WHERE id = $1',
      values: [organization.id],
    });
    await context.harness.query({
      text: `INSERT INTO "openmeld"."members" (id,organization_id,user_id,role,created_at) VALUES ('teammate-member',$1,'teammate','member',$2)`,
      values: [organization.id, Date.now()],
    });
    const blocked = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    expect(blocked.blockingOrganizations.map((item) => item.id)).toEqual([
      organization.id,
    ]);
    expect(
      (
        await context.request("/v1/account/deletion", {
          confirmation: "DELETE",
          confirmationToken: preview.confirmationToken,
          password,
        })
      ).status
    ).toBe(409);
    expect(
      await context.harness.queryFirst({
        text: 'SELECT deleted_at FROM "openmeld"."users" WHERE id = $1',
        values: [context.userId],
      })
    ).toEqual({ deleted_at: null });
    await context.harness.query({
      text: `UPDATE "openmeld"."members" SET role = 'owner' WHERE id = 'teammate-member'`,
    });
    const ready = accountDeletionPreviewSchema.parse(
      await (await context.request("/v1/account/deletion")).json()
    );
    expect(ready.deleteOrganizations).toEqual([]);
    expect(ready.retainOrganizations.map((item) => item.id)).toEqual([
      organization.id,
    ]);
    expect(
      (
        await context.request("/v1/account/deletion", {
          confirmation: "DELETE",
          confirmationToken: ready.confirmationToken,
          password,
        })
      ).status
    ).toBe(202);
    expect(
      await context.harness.queryFirst({
        text: 'SELECT deletion_requested_at FROM "openmeld"."organizations" WHERE id = $1',
        values: [organization.id],
      })
    ).toEqual({ deletion_requested_at: null });
    expect(
      await context.harness.queryFirst({
        text: 'SELECT id FROM "openmeld"."members" WHERE user_id = $1',
        values: [context.userId],
      })
    ).toBeNull();
  });
});

async function fixture() {
  const harness = await createPostgresHarness();
  const app = createAuthWorkerTestApp();
  const background: Promise<unknown>[] = [];
  const env = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_EMAIL: { send: async () => undefined },
    AUTH_WORKER_NODE_ENV: "development",
    BETTER_AUTH_OPENMELD_SECRET:
      "disposable-test-secret-which-is-longer-than-thirty-two-characters",
    BETTER_AUTH_URL: "http://localhost:8788",
    WEB_APP_URL: origin,
    OPENMELD_AUTH_KV: {},
    OPENMELD_POSTGRESQL: harness.binding,
    OPENMELD_CORE_WORKER: {
      checkSpaceOwnerDeparture: async () => ({ spaces: [] }),
      cleanupDeletedAccount: () =>
        Promise.reject(new Error("Injected storage outage")),
      cleanupDeletedAccountConnection: () =>
        Promise.reject(new Error("Injected connection outage")),
    },
  } as unknown as AuthBindings;
  let cookie = "";
  const request = (path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://localhost:8788${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      {
        waitUntil: (promise: Promise<unknown>) => {
          background.push(promise);
        },
        passThroughOnException: () => undefined,
      } as ExecutionContext
    );
  const signup = await request("/api/auth/sign-up/email", {
    name: "Deletion Test",
    email: "account-delete@example.test",
    password,
  });
  if (signup.status !== 200) {
    throw new Error("Account fixture signup failed.");
  }
  await harness.query({
    text: 'UPDATE "openmeld"."users" SET email_verified = 1',
  });
  const signin = await request("/api/auth/sign-in/email", {
    email: "account-delete@example.test",
    password,
  });
  if (signin.status !== 200) {
    throw new Error("Account fixture sign-in failed.");
  }
  cookie = signin.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const user = await harness.queryFirst<{ id: string }>({
    text: 'SELECT id FROM "openmeld"."users"',
  });
  if (!user) {
    throw new Error("Missing signup fixture");
  }
  const context = { harness, request, background, env, userId: user.id };
  contexts.push(context);
  return context;
}
