import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import type { AuthBindings } from "../src/lib/bindings";
import { createAuthWorkerTestApp } from "./support/auth-worker-entrypoint.test-support";

const AUTH_URL = "http://localhost:8788";
const APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const executionContext = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("organization member role changes", () => {
  const app = createAuthWorkerTestApp();
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let env: AuthBindings;
  let organizationId: string;
  let first: { userId: string; memberId: string; cookie: string };
  let second: { userId: string; memberId: string; cookie: string };

  function post(path: string, body: unknown, cookie?: string) {
    return app.fetch(
      new Request(`${AUTH_URL}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_URL,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
      env,
      executionContext
    );
  }

  async function signIn(email: string) {
    const signup = await post("/sign-up/email", {
      email,
      name: email.split("@")[0],
      password: PASSWORD,
    });
    if (!signup.ok) {
      throw new Error(`Fixture sign-up failed: ${await signup.text()}`);
    }
    await harness.query({
      text: "UPDATE openmeld.users SET email_verified=1 WHERE email=$1",
      values: [email],
    });
    const response = await post("/sign-in/email", {
      email,
      password: PASSWORD,
    });
    if (!response.ok) {
      throw new Error(`Fixture sign-in failed: ${await response.text()}`);
    }
    const result = (await response.json()) as { user: { id: string } };
    return {
      userId: result.user.id,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  beforeAll(async () => {
    harness = await createPostgresHarness();
    env = {
      AUTH_BRAND_NAME: "OpenMeld",
      AUTH_COOKIE_DOMAIN: "localhost",
      AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
      AUTH_EMAIL: { send: async () => undefined },
      AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
      AUTH_WORKER_NODE_ENV: "development",
      BETTER_AUTH_OPENMELD_SECRET:
        "1234567890123456789012345678901234567890123456789012345678901234",
      BETTER_AUTH_URL: AUTH_URL,
      OPENMELD_AUTH_KV: {},
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      PASSKEY_RP_ID: "localhost",
      WEB_APP_URL: APP_URL,
    } as unknown as AuthBindings;
    const owner = await signIn("first-owner@example.com");
    const teammate = await signIn("second-owner@example.com");
    const response = await post(
      "/organization/create",
      { name: "Owner role test" },
      owner.cookie
    );
    if (!response.ok) {
      throw new Error(
        `Fixture organization creation failed: ${await response.text()}`
      );
    }
    organizationId = ((await response.json()) as { id: string }).id;
    const ownerMembership = await harness.queryFirst<{ id: string }>({
      text: "SELECT id FROM openmeld.members WHERE organization_id=$1 AND user_id=$2",
      values: [organizationId, owner.userId],
    });
    if (!ownerMembership) {
      throw new Error("Owner membership is missing.");
    }
    const teammateMemberId = crypto.randomUUID();
    await harness.query({
      text: "INSERT INTO openmeld.members(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',$4)",
      values: [teammateMemberId, organizationId, teammate.userId, Date.now()],
    });
    first = { ...owner, memberId: ownerMembership.id };
    second = { ...teammate, memberId: teammateMemberId };
  });

  beforeEach(async () => {
    await harness.query({
      text: "UPDATE openmeld.members SET role='owner' WHERE organization_id=$1",
      values: [organizationId],
    });
  });

  afterAll(async () => {
    await harness?.close();
  });

  function changeRole(
    cookie: string,
    memberId: string,
    role: "owner" | "admin" | "member"
  ) {
    return post(
      "/organization/update-member-role",
      { organizationId, memberId, role },
      cookie
    );
  }

  function readRoles() {
    return harness.queryAll<{ id: string; role: string }>({
      text: "SELECT id,role FROM openmeld.members WHERE organization_id=$1 ORDER BY id",
      values: [organizationId],
    });
  }

  it.each([
    "admin",
    "member",
  ] as const)("lets an Owner change another Owner to %s and preserves the acting Owner", async (role) => {
    const response = await changeRole(first.cookie, second.memberId, role);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await readRoles()).toEqual(
      expect.arrayContaining([
        { id: first.memberId, role: "owner" },
        { id: second.memberId, role },
      ])
    );
  });

  it.each([
    "admin",
    "member",
  ] as const)("rejects an %s changing an Owner through the API", async (role) => {
    await harness.query({
      text: "UPDATE openmeld.members SET role=$1 WHERE id=$2",
      values: [role, first.memberId],
    });
    const response = await changeRole(first.cookie, second.memberId, "member");
    expect(response.status).toBe(403);
    expect(await readRoles()).toContainEqual({
      id: second.memberId,
      role: "owner",
    });
  });

  it("rejects demoting the last Owner at Auth and storage boundaries", async () => {
    await harness.query({
      text: "UPDATE openmeld.members SET role='member' WHERE id=$1",
      values: [second.memberId],
    });
    const response = await changeRole(first.cookie, first.memberId, "member");
    expect(response.status).toBe(400);
    expect(await readRoles()).toContainEqual({
      id: first.memberId,
      role: "owner",
    });
    await expect(
      harness.query({
        text: "UPDATE openmeld.members SET role='member' WHERE id=$1",
        values: [first.memberId],
      })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "organization_requires_owner",
    });
  });

  it.each([
    "explicit",
    "active",
  ])("preserves an Owner during reciprocal demotion using %s organization context", async (context) => {
    if (context === "active") {
      for (const user of [first, second]) {
        const response = await post(
          "/organization/set-active",
          { organizationId },
          user.cookie
        );
        expect(response.status).toBe(200);
        const cookies = new Map(
          user.cookie
            .split("; ")
            .map((cookie) => [cookie.split("=")[0], cookie])
        );
        for (const header of response.headers.getSetCookie()) {
          const cookie = header.split(";")[0];
          cookies.set(cookie.split("=")[0], cookie);
        }
        user.cookie = [...cookies.values()].join("; ");
      }
    }
    const responses = await Promise.all([
      post(
        "/organization/update-member-role",
        {
          ...(context === "explicit" ? { organizationId } : {}),
          memberId: second.memberId,
          role: "member",
        },
        first.cookie
      ),
      post(
        "/organization/update-member-role",
        {
          organizationId: context === "explicit" ? organizationId : "",
          memberId: first.memberId,
          role: "member",
        },
        second.cookie
      ),
    ]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(
      responses.every((response) => [200, 403, 409].includes(response.status))
    ).toBe(true);
    for (const response of responses.filter(
      (candidate) => candidate.status === 409
    )) {
      await expect(response.json()).resolves.toMatchObject({
        code: "organization.last_owner",
      });
    }
    expect(
      (await readRoles()).filter((member) => member.role === "owner")
    ).toHaveLength(1);
  });
});
