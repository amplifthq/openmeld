import permissionBundleSource from "../../../../../config/message-channels/lark-platform-channel-only-permission-bundle.json";

export const LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE = Object.freeze({
  callbacks: Object.freeze([...permissionBundleSource.callbacks]),
  events: Object.freeze([...permissionBundleSource.events]),
  mode: requireExactBundleValue(
    permissionBundleSource.mode,
    "channel_only_template"
  ),
  preset: requireExactBundleValue(permissionBundleSource.preset, false),
  scopes: Object.freeze([...permissionBundleSource.scopes]),
  sdkGitHead: permissionBundleSource.sdkGitHead,
  sdkVersion: permissionBundleSource.sdkVersion,
  version: permissionBundleSource.version,
});

export type LarkPlatformChannelPermissionBundle =
  typeof LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE;

const BASE64_PADDING_PATTERN = /=+$/u;

// Setup authority is requested in the provider's consent page, never granted
// to the Center Agent as a runtime Channel capability.
export const LARK_PLATFORM_APP_CONFIGURATION_SCOPE =
  "application:application:patch";

function requireExactBundleValue<const T extends boolean | string>(
  value: boolean | string,
  expected: T
): T {
  if (value !== expected) {
    throw new Error(
      `Lark platform permission bundle expected ${String(expected)} but received ${String(value)}`
    );
  }
  return expected;
}

export async function encodeLarkPlatformRegistrationAddons(
  bundle: LarkPlatformChannelPermissionBundle
): Promise<string> {
  const payload = JSON.stringify({
    callbacks: {
      items: [...bundle.callbacks],
    },
    events: {
      items: {
        tenant: [...bundle.events],
      },
    },
    preset: bundle.preset,
    scopes: {
      tenant: [...bundle.scopes, LARK_PLATFORM_APP_CONFIGURATION_SCOPE],
    },
  });
  const compressed = await new Response(
    new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"))
  ).arrayBuffer();
  return encodeBase64Url(new Uint8Array(compressed));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}
