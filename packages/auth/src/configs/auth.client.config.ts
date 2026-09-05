import { passkeyClient } from "@better-auth/passkey/client";
import type { BetterAuthClientOptions } from "better-auth";
import {
  lastLoginMethodClient,
  multiSessionClient,
  organizationClient,
} from "better-auth/client/plugins";
import {
  organizationAccessControl,
  organizationRoles,
} from "../organization/access-control";
import { LAST_USED_LOGIN_METHOD_COOKIE_NAME } from "./constants";

export type CreateAuthClientConfigInput = {
  baseURL: string;
  basePath?: string;
};

const DEFAULT_AUTH_BASE_PATH = "/api/auth";

type OpenMeldAuthClientPlugins = [
  OpenMeldPasskeyClientPlugin,
  OpenMeldMultiSessionClientPlugin,
  OpenMeldOrganizationClientPlugin,
  OpenMeldLastLoginMethodClientPlugin,
];

type OpenMeldPasskeyClientPlugin = ReturnType<typeof passkeyClient>;
type OpenMeldMultiSessionClientPlugin = ReturnType<typeof multiSessionClient>;
type OpenMeldOrganizationClientOptions = {
  ac: typeof organizationAccessControl;
  roles: typeof organizationRoles;
};
type OpenMeldOrganizationClientPlugin = ReturnType<
  typeof organizationClient<OpenMeldOrganizationClientOptions>
>;
type OpenMeldLastLoginMethodClientPlugin = ReturnType<
  typeof lastLoginMethodClient
>;

function createOpenMeldAuthClientPlugins(): OpenMeldAuthClientPlugins {
  const passkeyPlugin: OpenMeldPasskeyClientPlugin = passkeyClient();
  const multiSessionPlugin: OpenMeldMultiSessionClientPlugin =
    multiSessionClient();
  const organizationPlugin: OpenMeldOrganizationClientPlugin =
    organizationClient({
      ac: organizationAccessControl,
      roles: organizationRoles,
    });
  const lastLoginMethodPlugin: OpenMeldLastLoginMethodClientPlugin =
    lastLoginMethodClient({
      cookieName: LAST_USED_LOGIN_METHOD_COOKIE_NAME,
    });

  return [
    passkeyPlugin,
    multiSessionPlugin,
    organizationPlugin,
    lastLoginMethodPlugin,
  ];
}

export type OpenMeldAuthClientConfig = Omit<
  BetterAuthClientOptions,
  "plugins"
> & {
  plugins: OpenMeldAuthClientPlugins;
};

export function createAuthClientConfig({
  baseURL,
  basePath,
}: CreateAuthClientConfigInput): OpenMeldAuthClientConfig {
  const normalizedBaseURL = baseURL.trim();
  if (!normalizedBaseURL) {
    throw new Error("Better Auth client baseURL is required");
  }

  return {
    baseURL: normalizedBaseURL,
    basePath: basePath ?? DEFAULT_AUTH_BASE_PATH,
    plugins: createOpenMeldAuthClientPlugins(),
    fetchOptions: {
      credentials: "include",
    },
  };
}
