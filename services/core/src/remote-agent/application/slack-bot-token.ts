import { readSlackWorkspaceToken } from "../infrastructure/d1/slack-workspace-token-repo";
import { decryptSlackBotToken } from "./slack-token-crypto";

export async function resolveSlackBotToken(input: {
  cryptoKey?: string | null;
  db: D1Database;
  fallbackBotToken?: string | null;
  slackTeamId: string;
}): Promise<string> {
  const record = await readSlackWorkspaceToken({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (record) {
    const cryptoKey = normalizeOptionalText(input.cryptoKey);
    if (!cryptoKey) {
      throw new Error("SLACK_OPENMELD_TOKEN_CRYPTO_KEY is not configured");
    }
    return await decryptSlackBotToken({
      cryptoKey,
      encryptedBotToken: record.encryptedBotToken,
    });
  }

  const fallbackBotToken = normalizeOptionalText(input.fallbackBotToken);
  if (fallbackBotToken) {
    return fallbackBotToken;
  }
  throw new Error("Slack bot token is not configured for this workspace");
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
