import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSlackBotToken } from "../src/remote-agent/application/slack-bot-token";
import {
  decryptSlackBotToken,
  encryptSlackBotToken,
} from "../src/remote-agent/application/slack-token-crypto";
import {
  hasSlackDirectMessageScopes,
  readSlackWorkspaceToken,
  upsertSlackWorkspaceToken,
} from "../src/remote-agent/infrastructure/d1/slack-workspace-token-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const NOW_MS = Date.parse("2026-07-10T00:00:00.000Z");
const SLACK_TOKEN_CIPHERTEXT_PATTERN =
  /^aesgcm:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/u;

describe("Slack workspace bot tokens", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE slack_workspace_tokens (
          slack_team_id TEXT PRIMARY KEY,
          encrypted_bot_token TEXT NOT NULL,
          bot_user_id TEXT NOT NULL,
          granted_bot_scopes TEXT,
          installed_by_user_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        )
      `,
    });
  });

  afterEach(() => harness.close());

  it("round-trips a bot token with AES-GCM without storing plaintext", async () => {
    const encrypted = await encryptSlackBotToken({
      botToken: "xoxb-team-secret",
      cryptoKey: CRYPTO_KEY,
    });

    expect(encrypted).toMatch(SLACK_TOKEN_CIPHERTEXT_PATTERN);
    expect(encrypted).not.toContain("xoxb-team-secret");
    await expect(
      decryptSlackBotToken({
        encryptedBotToken: encrypted,
        cryptoKey: CRYPTO_KEY,
      })
    ).resolves.toBe("xoxb-team-secret");
  });

  it("prefers the encrypted per-workspace token over the global fallback", async () => {
    await seedWorkspaceToken("T123", "xoxb-team-token");

    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: "xoxb-global-token",
        slackTeamId: "T123",
      })
    ).resolves.toBe("xoxb-team-token");
  });

  it("uses the global token only when the workspace has no stored token", async () => {
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: " xoxb-global-token ",
        slackTeamId: "T999",
      })
    ).resolves.toBe("xoxb-global-token");
  });

  it("rejects a stored token owned by a different Organization", async () => {
    await seedWorkspaceToken("T123", "xoxb-team-token");

    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        expectedOrganizationId: "org-other",
        fallbackBotToken: "xoxb-global-token",
        slackTeamId: "T123",
      })
    ).rejects.toThrow(
      "Slack workspace binding and bot token belong to different Organizations"
    );
  });

  it("distinguishes legacy installations from DM-ready OAuth grants", async () => {
    await seedWorkspaceToken("T_LEGACY", "xoxb-legacy-token");
    await seedWorkspaceToken("T_READY", "xoxb-ready-token", [
      "chat:write",
      "im:write",
      "im:history",
      "im:read",
    ]);

    const legacy = await readSlackWorkspaceToken({
      db: harness.db,
      slackTeamId: "T_LEGACY",
    });
    const ready = await readSlackWorkspaceToken({
      db: harness.db,
      slackTeamId: "T_READY",
    });
    expect(legacy?.grantedBotScopes).toBeNull();
    expect(hasSlackDirectMessageScopes(legacy?.grantedBotScopes ?? null)).toBe(
      false
    );
    expect(ready?.grantedBotScopes).toEqual([
      "chat:write",
      "im:history",
      "im:read",
      "im:write",
    ]);
    expect(hasSlackDirectMessageScopes(ready?.grantedBotScopes ?? null)).toBe(
      true
    );
    expect(hasSlackDirectMessageScopes(["im:history", "im:write"])).toBe(false);
  });

  it("fails visibly when neither token source is available", async () => {
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: "",
        slackTeamId: "T999",
      })
    ).rejects.toThrow("Slack bot token is not configured for this workspace");
  });

  it("does not hide a stored-token decryption failure behind the fallback", async () => {
    await upsertSlackWorkspaceToken({
      db: harness.db,
      record: {
        botUserId: "U123",
        createdAtMs: NOW_MS,
        encryptedBotToken: "invalid-ciphertext",
        installedByUserId: "user-1",
        organizationId: "org-1",
        slackTeamId: "T123",
        updatedAtMs: NOW_MS,
      },
    });

    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: "xoxb-global-token",
        slackTeamId: "T123",
      })
    ).rejects.toThrow("Slack bot token ciphertext is invalid");
  });

  async function seedWorkspaceToken(
    slackTeamId: string,
    botToken: string,
    grantedBotScopes?: readonly string[]
  ): Promise<void> {
    await upsertSlackWorkspaceToken({
      db: harness.db,
      record: {
        botUserId: "U123",
        createdAtMs: NOW_MS,
        encryptedBotToken: await encryptSlackBotToken({
          botToken,
          cryptoKey: CRYPTO_KEY,
        }),
        grantedBotScopes,
        installedByUserId: "user-1",
        organizationId: "org-1",
        slackTeamId,
        updatedAtMs: NOW_MS,
      },
    });
  }
});
