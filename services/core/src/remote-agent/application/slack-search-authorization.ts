import { decryptSlackSecret, encryptSlackSecret } from "./slack-token-crypto";

const SLACK_SEARCH_AUTHORIZATION_STRING_FIELDS = [
  "actionToken",
  "memberId",
  "organizationId",
  "slackTeamId",
  "slackUserId",
  "sourceChannelId",
  "sourceThreadTs",
  "openMeldUserId",
] as const;

type SlackSearchAuthorization = Record<
  (typeof SLACK_SEARCH_AUTHORIZATION_STRING_FIELDS)[number],
  string
>;
type SlackSearchAuthorizationPayload = SlackSearchAuthorization & { v: 1 };

export async function encryptSlackSearchAuthorization(
  input: SlackSearchAuthorization & {
    cryptoKey: string;
  }
): Promise<string> {
  const { cryptoKey, ...authorization } = input;
  const payload = parseSlackSearchAuthorizationPayload({
    ...authorization,
    v: 1,
  });
  return await encryptSlackSecret({
    cryptoKey,
    secret: JSON.stringify(payload),
    secretName: "Slack search authorization",
  });
}

export async function decryptSlackSearchAuthorization(input: {
  cryptoKey: string;
  encryptedAuthorization: string;
}): Promise<SlackSearchAuthorization> {
  const plaintext = await decryptSlackSecret({
    cryptoKey: input.cryptoKey,
    encryptedSecret: input.encryptedAuthorization,
    secretName: "Slack search authorization",
  });
  let decoded: unknown;
  try {
    decoded = JSON.parse(plaintext);
  } catch {
    throw new Error("Slack search authorization payload is invalid");
  }
  const { v: _version, ...authorization } =
    parseSlackSearchAuthorizationPayload(decoded);
  return authorization;
}

function parseSlackSearchAuthorizationPayload(
  value: unknown
): SlackSearchAuthorizationPayload {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error("Slack search authorization payload is invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.v !== 1 ||
    Object.keys(candidate).length !==
      SLACK_SEARCH_AUTHORIZATION_STRING_FIELDS.length + 1
  ) {
    throw new Error("Slack search authorization payload is invalid");
  }
  const authorization = {} as SlackSearchAuthorization;
  for (const field of SLACK_SEARCH_AUTHORIZATION_STRING_FIELDS) {
    const rawValue = candidate[field];
    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!normalized) {
      throw new Error("Slack search authorization payload is invalid");
    }
    authorization[field] = normalized;
  }
  return { ...authorization, v: 1 };
}
