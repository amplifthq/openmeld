import {
  larkPlatformWebhookVerificationInputSchema,
  larkPlatformWebhookVerificationResponseSchema,
} from "@openmeld/schemas";
import type {
  LarkPlatformWebhookVerificationInput,
  LarkPlatformWebhookVerificationResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  bindRemoteAgentLarkPlatformConnectionTenant,
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { recordRemoteAgentLarkPlatformWebhookReachability } from "../infrastructure/d1/lark-platform-registration-attempt-repo";
import {
  decryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "./lark-platform-credential-crypto";
import { normalizeLarkPlatformEvent } from "./lark-platform-event-normalizer";
import {
  isLarkPlatformProviderEnabledForOrganization,
  isLarkPlatformProviderGloballyEnabled,
} from "./lark-platform-provider-policy";

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/iu;

type JsonObject = Record<string, unknown>;

export async function verifyLarkPlatformWebhook(input: {
  db: D1Database;
  env: Pick<
    CoreBindings,
    | "OPENMELD_FEISHU_CHANNEL_ENABLED"
    | "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS"
    | "OPENMELD_LARK_CHANNEL_ENABLED"
    | "OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS"
    | "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY"
  >;
  input: LarkPlatformWebhookVerificationInput;
}): Promise<LarkPlatformWebhookVerificationResponse> {
  const request = larkPlatformWebhookVerificationInputSchema.safeParse(
    input.input
  );
  if (!request.success) {
    return response({
      reasonCode: "message_channel.webhook_request_invalid",
      status: "rejected",
    });
  }
  if (
    !isLarkPlatformProviderGloballyEnabled(input.env, request.data.provider)
  ) {
    return response({
      reasonCode: "message_channel.provider_disabled",
      status: "rejected",
    });
  }
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: request.data.connectionId,
    db: input.db,
  });
  if (
    !connection ||
    connection.provider !== request.data.provider ||
    (connection.status !== "configuring" &&
      connection.status !== "connected") ||
    connection.transport !== "webhook"
  ) {
    return response({
      reasonCode: "message_channel.connection_unavailable",
      status: "rejected",
    });
  }
  if (
    !isLarkPlatformProviderEnabledForOrganization({
      env: input.env,
      organizationId: connection.organizationId,
      provider: request.data.provider,
    })
  ) {
    return response({
      reasonCode: "message_channel.provider_disabled",
      status: "rejected",
    });
  }
  const secrets = await readConnectionWebhookSecrets({
    connectionId: connection.connectionId,
    cryptoKey: input.env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY,
    db: input.db,
  });
  if (secrets.status === "rejected") {
    return response(secrets);
  }
  const rawPayload = parseJsonObject(request.data.rawBody);
  if (!rawPayload) {
    return response({
      reasonCode: "message_channel.webhook_payload_invalid",
      status: "rejected",
    });
  }
  const verifiedPayload = await verifyAndDecryptPayload({
    eventEncryptKey: secrets.eventEncryptKey,
    headers: request.data.headers,
    rawBody: request.data.rawBody,
    rawPayload,
  });
  if (verifiedPayload.status === "rejected") {
    return response(verifiedPayload);
  }
  const payload = verifiedPayload.payload;
  const challenge = readString(payload, "challenge");
  if (readString(payload, "type") === "url_verification") {
    if (
      !(
        challenge &&
        constantTimeEqual(
          readString(payload, "token"),
          secrets.verificationToken
        )
      )
    ) {
      return response({
        reasonCode: "message_channel.webhook_verification_token_invalid",
        status: "rejected",
      });
    }
    const verifiedConnection =
      await recordRemoteAgentLarkPlatformWebhookReachability({
        connectionId: connection.connectionId,
        encryptedVerificationToken: secrets.encryptedVerificationToken,
        db: input.db,
        organizationId: connection.organizationId,
        provider: connection.provider,
        surface: request.data.surface,
        verifiedAtMs: request.data.receivedAtMs,
      });
    return verifiedConnection
      ? response({ challenge, status: "challenge" })
      : response({
          reasonCode: "message_channel.connection_unavailable",
          status: "rejected",
        });
  }
  if (connection.status !== "connected") {
    return response({
      reasonCode: "message_channel.connection_unavailable",
      status: "rejected",
    });
  }
  const identityValidation = validateEventIdentity({
    appId: connection.appId,
    payload,
    tenantKey: connection.tenantKey,
    verificationToken: secrets.verificationToken,
  });
  if (identityValidation.status === "rejected") {
    return response(identityValidation);
  }
  const tenantBoundConnection =
    await bindRemoteAgentLarkPlatformConnectionTenant({
      appId: connection.appId,
      connectionId: connection.connectionId,
      db: input.db,
      nowMs: request.data.receivedAtMs,
      organizationId: connection.organizationId,
      provider: connection.provider,
      tenantKey: identityValidation.tenantKey,
    });
  if (!tenantBoundConnection) {
    return response({
      reasonCode: "message_channel.webhook_tenant_mismatch",
      status: "rejected",
    });
  }
  return response(
    normalizeLarkPlatformEvent({
      connection: tenantBoundConnection,
      gatewayRequestId: request.data.gatewayRequestId,
      payload,
      receivedAtMs: request.data.receivedAtMs,
      surface: request.data.surface,
    })
  );
}

async function readConnectionWebhookSecrets(input: {
  connectionId: string;
  cryptoKey: string | undefined;
  db: D1Database;
}): Promise<
  | {
      eventEncryptKey: string | null;
      encryptedVerificationToken: string;
      status: "ready";
      verificationToken: string;
    }
  | { reasonCode: string; status: "rejected" }
> {
  const cryptoKey = input.cryptoKey?.trim();
  const credentials = await readRemoteAgentLarkPlatformChannelCredentials({
    connectionId: input.connectionId,
    db: input.db,
  });
  if (
    !(cryptoKey && credentials) ||
    credentials.credentialFormatVersion !==
      LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION ||
    !credentials.encryptedVerificationToken
  ) {
    return {
      reasonCode: "message_channel.webhook_credentials_unavailable",
      status: "rejected",
    };
  }
  try {
    const [verificationToken, eventEncryptKey] = await Promise.all([
      decryptLarkPlatformCredential({
        credentialName: "verification token",
        cryptoKey,
        encryptedCredential: credentials.encryptedVerificationToken,
      }),
      credentials.encryptedEventEncryptKey
        ? decryptLarkPlatformCredential({
            credentialName: "event encrypt key",
            cryptoKey,
            encryptedCredential: credentials.encryptedEventEncryptKey,
          })
        : Promise.resolve(null),
    ]);
    return {
      eventEncryptKey,
      encryptedVerificationToken: credentials.encryptedVerificationToken,
      status: "ready",
      verificationToken,
    };
  } catch (error) {
    console.error(
      "[core.message_channel.webhook_credential_decryption_failed]",
      {
        connectionId: input.connectionId,
        error: toErrorMessage(error),
      }
    );
    return {
      reasonCode: "message_channel.webhook_credential_decryption_failed",
      status: "rejected",
    };
  }
}

async function verifyAndDecryptPayload(input: {
  eventEncryptKey: string | null;
  headers: LarkPlatformWebhookVerificationInput["headers"];
  rawBody: string;
  rawPayload: JsonObject;
}): Promise<
  | { payload: JsonObject; status: "verified" }
  | { reasonCode: string; status: "rejected" }
> {
  const encryptedPayload = readString(input.rawPayload, "encrypt");
  if (!input.eventEncryptKey) {
    return encryptedPayload
      ? {
          reasonCode: "message_channel.webhook_encryption_key_unavailable",
          status: "rejected",
        }
      : { payload: input.rawPayload, status: "verified" };
  }
  if (!encryptedPayload) {
    return {
      reasonCode: "message_channel.webhook_encryption_required",
      status: "rejected",
    };
  }
  const signatureHeadersAbsent =
    input.headers.nonce === null &&
    input.headers.signature === null &&
    input.headers.timestamp === null;
  if (
    !(
      signatureHeadersAbsent ||
      (await verifyWebhookSignature({
        eventEncryptKey: input.eventEncryptKey,
        headers: input.headers,
        rawBody: input.rawBody,
      }))
    )
  ) {
    return {
      reasonCode: "message_channel.webhook_signature_invalid",
      status: "rejected",
    };
  }
  const decryptedPayload = await decryptWebhookPayload({
    encryptedPayload,
    eventEncryptKey: input.eventEncryptKey,
  });
  // URL verification omits signature headers; the caller still checks its token.
  if (
    signatureHeadersAbsent &&
    decryptedPayload &&
    readString(decryptedPayload, "type") !== "url_verification"
  ) {
    return {
      reasonCode: "message_channel.webhook_signature_invalid",
      status: "rejected",
    };
  }
  return decryptedPayload
    ? { payload: decryptedPayload, status: "verified" }
    : {
        reasonCode: "message_channel.webhook_decryption_failed",
        status: "rejected",
      };
}

async function verifyWebhookSignature(input: {
  eventEncryptKey: string;
  headers: LarkPlatformWebhookVerificationInput["headers"];
  rawBody: string;
}): Promise<boolean> {
  const { nonce, signature, timestamp } = input.headers;
  if (!(nonce && signature && timestamp && SIGNATURE_PATTERN.test(signature))) {
    return false;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${timestamp}${nonce}${input.eventEncryptKey}${input.rawBody}`
    )
  );
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return constantTimeEqual(signature.toLowerCase(), expected);
}

async function decryptWebhookPayload(input: {
  encryptedPayload: string;
  eventEncryptKey: string;
}): Promise<JsonObject | null> {
  let combined: Uint8Array;
  try {
    combined = Uint8Array.from(atob(input.encryptedPayload), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    return null;
  }
  if (combined.length <= 16) {
    return null;
  }
  try {
    const keyBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input.eventEncryptKey)
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt(
      { iv: combined.slice(0, 16), name: "AES-CBC" },
      key,
      combined.slice(16)
    );
    return parseJsonObject(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        plaintext
      )
    );
  } catch {
    return null;
  }
}

function validateEventIdentity(input: {
  appId: string;
  payload: JsonObject;
  tenantKey: string | null;
  verificationToken: string;
}):
  | { status: "verified"; tenantKey: string }
  | { reasonCode: string; status: "rejected" } {
  if (readString(input.payload, "schema") !== "2.0") {
    return {
      reasonCode: "message_channel.webhook_schema_unsupported",
      status: "rejected",
    };
  }
  const header = readObject(input.payload, "header");
  if (
    !(
      header &&
      constantTimeEqual(readString(header, "token"), input.verificationToken)
    )
  ) {
    return {
      reasonCode: "message_channel.webhook_verification_token_invalid",
      status: "rejected",
    };
  }
  if (readString(header, "app_id") !== input.appId) {
    return {
      reasonCode: "message_channel.webhook_app_mismatch",
      status: "rejected",
    };
  }
  const tenantKey = header ? readString(header, "tenant_key") : null;
  if (
    !(tenantKey && (input.tenantKey === null || tenantKey === input.tenantKey))
  ) {
    return {
      reasonCode: "message_channel.webhook_tenant_mismatch",
      status: "rejected",
    };
  }
  return { status: "verified", tenantKey };
}

function response(
  value: LarkPlatformWebhookVerificationResponse
): LarkPlatformWebhookVerificationResponse {
  return larkPlatformWebhookVerificationResponseSchema.parse(value);
}

function parseJsonObject(value: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readObject(object: JsonObject, key: string): JsonObject | null {
  const value = object[key];
  return isJsonObject(value) ? value : null;
}

function readString(object: JsonObject | null, key: string): string | null {
  const value = object?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeEqual(
  first: string | null,
  second: string | null
): boolean {
  if (!(first && second)) {
    return false;
  }
  const firstBytes = new TextEncoder().encode(first);
  const secondBytes = new TextEncoder().encode(second);
  let difference = Math.abs(firstBytes.length - secondBytes.length);
  const length = Math.max(firstBytes.length, secondBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference += Math.abs(
      (firstBytes[index] ?? 0) - (secondBytes[index] ?? 0)
    );
  }
  return difference === 0;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
