import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
} from "./support/sqlite-d1-harness";

let harness: ReturnType<typeof createSqliteD1Harness>;
let delivered: { to: string; text: string }[];
let rpc: AuthRpcEntrypoint;
const CODE_PATTERN = /[a-f0-9]{8}(?:-[a-f0-9]{8}){3}/u;
const request = {
  requestId: "00000000-0000-4000-8000-000000000001",
  organizationId: "synthetic-org",
  userId: "synthetic-user",
  requestDigest: "a".repeat(64),
  expiresAtMs: 2_000_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  harness.run({
    sql: "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('synthetic-user', 'Synthetic', 'synthetic@example.test', 1, 1, 1)",
  });
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('synthetic-org', 'Synthetic', 'synthetic', 1)",
  });
  harness.run({
    sql: "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES ('member', 'synthetic-org', 'synthetic-user', 'member', 1)",
  });
  delivered = [];
  rpc = new AuthRpcEntrypoint(
    {} as ExecutionContext,
    {
      OPENMELD_DB: harness.db,
      AUTH_FROM_EMAIL: "noreply@example.test",
      BETTER_AUTH_OPENMELD_SECRET:
        "synthetic-test-secret-with-no-production-authority",
      AUTH_EMAIL: {
        send: (email: { to: string; text: string }) => {
          delivered.push(email);
          return Promise.resolve({ messageId: "synthetic" });
        },
      },
    } as unknown as CloudflareBindings
  );
});
afterEach(() => {
  harness.close();
  vi.useRealTimers();
});

function receivedCode() {
  const code = delivered[0]?.text.match(CODE_PATTERN)?.[0];
  if (!code) {
    throw new Error(
      "No verification code delivered to the synthetic email boundary"
    );
  }
  return code;
}

describe("Plugin request human verification through Auth RPC", () => {
  it("returns no approval secret to the requester and verifies only the email recipient's bound code", async () => {
    expect(await rpc.sendPluginRequestVerification(request)).toEqual({
      status: "sent",
    });
    expect(delivered[0]?.to).toBe("synthetic@example.test");
    expect(
      await rpc.checkPluginRequestVerification({
        ...request,
        code: request.requestId,
      })
    ).toEqual({ status: "denied", reason: "verification_invalid" });
    const code = receivedCode();
    expect(
      await rpc.checkPluginRequestVerification({ ...request, code })
    ).toEqual({ status: "verified" });
    // A repeated Auth check does not mint or consume a root. The operation owner
    // retains the atomic approval decision, including after a lost RPC reply.
    expect(
      await rpc.checkPluginRequestVerification({ ...request, code })
    ).toEqual({ status: "verified" });
  });
  it.each([
    "requestId",
    "requestDigest",
    "expiresAtMs",
    "userId",
    "organizationId",
  ] as const)("does not lend verification to a changed %s", async (field) => {
    await rpc.sendPluginRequestVerification(request);
    const replacements = {
      requestId: "00000000-0000-4000-8000-000000000002",
      requestDigest: "b".repeat(64),
      expiresAtMs: 2_000_001,
      userId: "other-user",
      organizationId: "other-org",
    };
    expect(
      await rpc.checkPluginRequestVerification({
        ...request,
        [field]: replacements[field],
        code: receivedCode(),
      })
    ).toMatchObject({ status: "denied" });
  });
  it.each([
    "expired",
    "removed",
    "unverified",
    "changed-email",
  ])("rechecks current recipient evidence: %s", async (change) => {
    await rpc.sendPluginRequestVerification(request);
    const code = receivedCode();
    if (change === "expired") {
      vi.setSystemTime(request.expiresAtMs);
    }
    if (change === "removed") {
      harness.run({ sql: "DELETE FROM members" });
    }
    if (change === "unverified") {
      harness.run({ sql: "UPDATE users SET email_verified = 0" });
    }
    if (change === "changed-email") {
      harness.run({ sql: "UPDATE users SET email = 'other@example.test'" });
    }
    expect(
      await rpc.checkPluginRequestVerification({ ...request, code })
    ).toMatchObject({ status: "denied" });
  });
});
