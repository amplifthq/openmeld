import type { CoreBindings } from "../../lib/bindings";
import type { RemoteAgentLarkPlatformProvider } from "../infrastructure/d1/lark-platform-channel-connection-repo";

export type LarkPlatformProviderPolicyEnvironment = Pick<
  CoreBindings,
  | "OPENMELD_FEISHU_CHANNEL_ENABLED"
  | "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS"
  | "OPENMELD_LARK_CHANNEL_ENABLED"
  | "OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS"
>;

export function isLarkPlatformProviderGloballyEnabled(
  env: LarkPlatformProviderPolicyEnvironment,
  provider: RemoteAgentLarkPlatformProvider
): boolean {
  return isEnabled(
    provider === "lark"
      ? env.OPENMELD_LARK_CHANNEL_ENABLED
      : env.OPENMELD_FEISHU_CHANNEL_ENABLED
  );
}

export function isLarkPlatformProviderEnabledForOrganization(input: {
  env: LarkPlatformProviderPolicyEnvironment;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): boolean {
  if (!isLarkPlatformProviderGloballyEnabled(input.env, input.provider)) {
    return false;
  }
  const organizationIds = parseOrganizationIds(
    input.provider === "lark"
      ? input.env.OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS
      : input.env.OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS
  );
  return (
    organizationIds.has("*") || organizationIds.has(input.organizationId.trim())
  );
}

export function listLarkPlatformProvidersEnabledForOrganization(input: {
  env: LarkPlatformProviderPolicyEnvironment;
  organizationId: string;
}): RemoteAgentLarkPlatformProvider[] {
  return (["lark", "feishu"] as const).filter((provider) =>
    isLarkPlatformProviderEnabledForOrganization({
      ...input,
      provider,
    })
  );
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseOrganizationIds(value: string | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((organizationId) => organizationId.trim())
      .filter(Boolean)
  );
}
