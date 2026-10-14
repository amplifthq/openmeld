import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  grokBotConversationIdSchema,
  grokBotEntriesSchema,
  grokBotMessageReceiptSchema,
  grokBotStoredCredentialSchema,
} from "@openmeld/schemas";

export class GrokBotError extends Error {
  readonly errorType = "runtime" as const;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GrokBotError";
  }
}

export async function readGrokBotCredential(
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const explicit = env.CURSOR_API_KEY;
  if (explicit?.trim()) {
    return explicit.trim();
  }
  if (env.CURSOR_API_KEY_FILE) {
    return (await readFile(env.CURSOR_API_KEY_FILE, "utf8")).trim();
  }
  if (env.CURSOR_SERVICE_ACCOUNT_KEY?.trim()) {
    return env.CURSOR_SERVICE_ACCOUNT_KEY.trim();
  }
  const config =
    env.AGENT_SERVE_CONFIG_DIR ??
    join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "agent-serve");
  try {
    const result = grokBotStoredCredentialSchema.safeParse(
      JSON.parse(await readFile(join(config, "credentials.json"), "utf8"))
    );
    if (result.success) {
      return result.data.apiKey;
    }
  } catch {
    // Never expose credential file content or automatically start authentication.
  }
  throw new GrokBotError(
    "controller.auth.unauthenticated",
    "Sign in with bdk login on this computer, then check the connection again."
  );
}

/** Official BDK API. Deliberately has no get-or-create-by-name operation. */
export class GrokBotClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async entries(sessionId: string, cursor: string) {
    const result = grokBotEntriesSchema.safeParse(
      await this.request(
        sessionId,
        `/entries?afterUpdatedSeq=${encodeURIComponent(cursor)}`
      )
    );
    if (!result.success) {
      throw new GrokBotError(
        "grok-bot.invalid_response",
        "Grok Bot returned an invalid conversation response."
      );
    }
    return result.data;
  }

  async send(sessionId: string, messageId: string, text: string) {
    const receipt = grokBotMessageReceiptSchema.safeParse(
      await this.request(sessionId, "/messages", { messageId, text })
    );
    if (!(receipt.success && receipt.data.messageId === messageId)) {
      throw new GrokBotError(
        "grok-bot.delivery_unconfirmed",
        "Grok Bot did not confirm this message. Do not resend it automatically."
      );
    }
  }

  async interrupt(sessionId: string) {
    await this.request(sessionId, "/interrupt", {
      reason: "Stopped from OpenMeld's shared conversation.",
    });
  }

  private async request(
    sessionId: string,
    suffix: string,
    body?: object
  ): Promise<unknown> {
    if (!grokBotConversationIdSchema.safeParse(sessionId).success) {
      throw new GrokBotError(
        "grok-bot.connection_required",
        "Connect an existing Grok Bot conversation before sending work."
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.cursor.com/v0/grokbot/sessions/${sessionId}${suffix}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
            "x-cursor-client-type": "agent-serve",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }
      );
    } catch {
      throw new GrokBotError(
        "grok-bot.connection_lost",
        "The Grok Bot connection was lost. Its work may still be running; check Grok Bot before retrying."
      );
    }
    if (!response.ok) {
      throw new GrokBotError(
        response.status === 401
          ? "controller.auth.unauthenticated"
          : "grok-bot.request_failed",
        `Grok Bot rejected the request (HTTP ${response.status}). Check the connection and account access.`
      );
    }
    if (suffix === "/interrupt") {
      return null;
    }
    try {
      return await response.json();
    } catch {
      throw new GrokBotError(
        "grok-bot.invalid_response",
        "Grok Bot returned an invalid response."
      );
    }
  }
}
