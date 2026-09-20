import type { RemoteAgentLarkPlatformProvider } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  getLarkPlatformApiHost,
  requestLarkPlatformTenantAccessToken,
} from "./lark-platform-openapi-client";
import {
  LARK_PLATFORM_APP_CONFIGURATION_SCOPE,
  LARK_PLATFORM_APP_SELF_MANAGE_SCOPE,
  LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE,
} from "./lark-platform-permission-bundles";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

type JsonObject = Record<string, unknown>;

type LarkPlatformAppConfigurationReason =
  | "application_config_failed"
  | "application_config_permission_required"
  | "application_publish_failed"
  | "application_publication_pending"
  | "application_publication_rejected"
  | "application_version_read_failed"
  | "bot_identity_failed"
  | "configuration_input_invalid"
  | "permission_bundle_mismatch"
  | "permission_scope_read_failed";

export class LarkPlatformAppConfigurationError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "LarkPlatformAppConfigurationError";
    this.reasonCode = reasonCode;
  }
}

/** The official Personal Agent page creates and publishes the channel-only
 * application in persistent mode. Existing Webhook apps migrate explicitly. */
export async function configureAndVerifyLarkPlatformPersistentApp(input: {
  appId: string;
  appSecret: string;
  provider: RemoteAgentLarkPlatformProvider;
  migrateWebhook: boolean;
  applicationVersionId: string | null;
  onPublicationSubmitted: (versionId: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{
  botName: string | null;
  botOpenId: string;
  grantedCapabilityGroups: ["conversation.text"];
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiHost = getLarkPlatformApiHost(input.provider);
  const token = await requestLarkPlatformTenantAccessToken({
    ...input,
    apiHost,
    fetchImpl,
  });
  if (token.status !== "ready") {
    throw new LarkPlatformAppConfigurationError(token.result.reasonCode);
  }
  const context = {
    ...input,
    apiHost,
    fetchImpl,
    tenantAccessToken: token.tenantAccessToken,
  };
  await verifyChannelOnlyPermissionBundle(context);
  if (input.migrateWebhook) {
    let versionId = input.applicationVersionId;
    if (!versionId) {
      const patched = await requestJson({
        fetchImpl,
        provider: input.provider,
        reason: "application_config_failed",
        url: `${apiHost}/open-apis/application/v7/applications/${encodeURIComponent(input.appId)}/config`,
        init: {
          method: "PATCH",
          headers: {
            ...JSON_HEADERS,
            Authorization: `Bearer ${token.tenantAccessToken}`,
          },
          body: JSON.stringify({
            event: {
              subscription_type: "websocket",
              add_events: [
                ...LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.events,
              ],
            },
            callback: {
              callback_type: "websocket",
              add_callbacks: [
                ...LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.callbacks,
              ],
            },
          }),
        },
      });
      if (readProviderCode(patched) !== 0) {
        throw configurationError(input.provider, "application_config_failed");
      }
      versionId = await publishLarkPlatformApp(context);
      await input.onPublicationSubmitted(versionId);
    }
    await verifyLarkPlatformPublishedVersion({ ...context, versionId });
  }
  const bot = await readBotIdentity(context);
  return {
    botName: bot.name,
    botOpenId: bot.openId,
    grantedCapabilityGroups: ["conversation.text"],
  };
}

export async function publishLarkPlatformApp(input: {
  apiHost: string;
  appId: string;
  fetchImpl: typeof fetch;
  provider: RemoteAgentLarkPlatformProvider;
  tenantAccessToken: string;
}): Promise<string> {
  const body = await requestJson({
    fetchImpl: input.fetchImpl,
    init: {
      body: JSON.stringify({
        mobile_default_ability: "bot",
        pc_default_ability: "bot",
        remark: "Connect this bot to the OpenMeld Center Agent.",
        changelog: "Enable persistent message delivery to OpenMeld.",
      }),
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${input.tenantAccessToken}`,
      },
      method: "POST",
    },
    provider: input.provider,
    reason: "application_publish_failed",
    url: `${input.apiHost}/open-apis/application/v7/applications/${encodeURIComponent(input.appId)}/publish`,
  });
  const versionId = isJsonObject(body.data)
    ? readString(body.data, "version_id")
    : null;
  if (readProviderCode(body) !== 0 || !versionId) {
    throw configurationError(input.provider, "application_publish_failed");
  }
  return versionId;
}

export async function verifyLarkPlatformPublishedVersion(input: {
  apiHost: string;
  appId: string;
  fetchImpl: typeof fetch;
  provider: RemoteAgentLarkPlatformProvider;
  tenantAccessToken: string;
  versionId: string;
}): Promise<void> {
  const body = await requestJson({
    fetchImpl: input.fetchImpl,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${input.tenantAccessToken}` },
    },
    provider: input.provider,
    reason: "application_version_read_failed",
    url: `${input.apiHost}/open-apis/application/v6/applications/${encodeURIComponent(input.appId)}/app_versions/${encodeURIComponent(input.versionId)}?lang=en_us`,
  });
  const version = isJsonObject(body.data) ? body.data.app_version : null;
  if (
    readProviderCode(body) !== 0 ||
    !isJsonObject(version) ||
    version.app_id !== input.appId ||
    version.version_id !== input.versionId
  ) {
    throw configurationError(input.provider, "application_version_read_failed");
  }
  if (version.status === 2) {
    throw configurationError(
      input.provider,
      "application_publication_rejected"
    );
  }
  if (version.status !== 1) {
    throw configurationError(input.provider, "application_publication_pending");
  }
  const eventInfos = version.event_infos;
  const events = Array.isArray(eventInfos)
    ? eventInfos.filter(isJsonObject).map((event) => event.event_type)
    : null;
  if (
    !Array.isArray(events) ||
    LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.events.some(
      (event) => !events.includes(event)
    )
  ) {
    throw configurationError(input.provider, "application_version_read_failed");
  }
}

async function verifyChannelOnlyPermissionBundle(input: {
  apiHost: string;
  fetchImpl: typeof fetch;
  provider: RemoteAgentLarkPlatformProvider;
  tenantAccessToken: string;
}): Promise<void> {
  const body = await requestJson({
    fetchImpl: input.fetchImpl,
    init: {
      headers: {
        Authorization: `Bearer ${input.tenantAccessToken}`,
      },
      method: "GET",
    },
    provider: input.provider,
    reason: "permission_scope_read_failed",
    url: `${input.apiHost}/open-apis/application/v6/scopes`,
  });
  if (readProviderCode(body) !== 0) {
    throw configurationError(input.provider, "permission_scope_read_failed");
  }
  const data = body.data;
  const scopes = isJsonObject(data) ? data.scopes : null;
  if (!Array.isArray(scopes)) {
    throw configurationError(input.provider, "permission_scope_read_failed");
  }
  const actualScopeNames = new Set<string>();
  for (const scope of scopes) {
    if (!isJsonObject(scope)) {
      throw configurationError(input.provider, "permission_scope_read_failed");
    }
    const scopeName = readString(scope, "scope_name");
    const grantStatus = scope.grant_status;
    const scopeType = scope.scope_type;
    if (
      !(scopeName && Number.isSafeInteger(grantStatus)) ||
      (scopeType !== undefined &&
        scopeType !== "tenant" &&
        scopeType !== "user")
    ) {
      throw configurationError(input.provider, "permission_scope_read_failed");
    }
    if (
      grantStatus !== 1 ||
      scopeType === "user" ||
      actualScopeNames.has(scopeName)
    ) {
      throw configurationError(input.provider, "permission_bundle_mismatch");
    }
    actualScopeNames.add(scopeName);
  }
  const expectedScopes = LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.scopes;
  // Explicit app-configuration consent is setup authority, not a Channel tool grant.
  actualScopeNames.delete(LARK_PLATFORM_APP_CONFIGURATION_SCOPE);
  actualScopeNames.delete(LARK_PLATFORM_APP_SELF_MANAGE_SCOPE);
  if (
    actualScopeNames.size !== expectedScopes.length ||
    expectedScopes.some((scopeName) => !actualScopeNames.has(scopeName))
  ) {
    throw configurationError(input.provider, "permission_bundle_mismatch");
  }
}

async function readBotIdentity(input: {
  apiHost: string;
  fetchImpl: typeof fetch;
  provider: RemoteAgentLarkPlatformProvider;
  tenantAccessToken: string;
}): Promise<{ name: string | null; openId: string }> {
  const body = await requestJson({
    fetchImpl: input.fetchImpl,
    init: {
      headers: {
        Authorization: `Bearer ${input.tenantAccessToken}`,
      },
      method: "GET",
    },
    provider: input.provider,
    reason: "bot_identity_failed",
    url: `${input.apiHost}/open-apis/bot/v3/info`,
  });
  const bot = body.bot;
  const openId = isJsonObject(bot) ? readString(bot, "open_id") : null;
  if (readProviderCode(body) !== 0 || !openId) {
    throw configurationError(input.provider, "bot_identity_failed");
  }
  return {
    name: isJsonObject(bot) ? readString(bot, "app_name") : null,
    openId,
  };
}

async function requestJson(input: {
  fetchImpl: typeof fetch;
  init: RequestInit;
  provider: RemoteAgentLarkPlatformProvider;
  reason: LarkPlatformAppConfigurationReason;
  url: string;
}): Promise<JsonObject> {
  let response: Response;
  try {
    const fetchImpl = input.fetchImpl;
    response = await fetchImpl(input.url, input.init);
  } catch {
    throw configurationError(input.provider, input.reason);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw configurationError(input.provider, input.reason);
  }
  if (
    isJsonObject(body) &&
    (input.reason === "application_config_failed" ||
      input.reason === "application_publish_failed" ||
      input.reason === "application_version_read_failed") &&
    readProviderCode(body) === 99_991_672
  ) {
    throw configurationError(
      input.provider,
      "application_config_permission_required"
    );
  }
  if (!(response.ok && isJsonObject(body))) {
    throw configurationError(input.provider, input.reason);
  }
  return body;
}

function readProviderCode(body: JsonObject): number | null {
  const value = body.code;
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function readString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configurationError(
  provider: RemoteAgentLarkPlatformProvider,
  reason: LarkPlatformAppConfigurationReason
): LarkPlatformAppConfigurationError {
  return new LarkPlatformAppConfigurationError(`${provider}.${reason}`);
}
