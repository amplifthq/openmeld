import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcAuthorizeAgentProfileBindingForOrganization,
  rpcBulkAuthorizeAgentProfileBindingsForOrganization,
  rpcGetOrganizationBindingAuthorizationPreference,
  rpcListCurrentUserAgentProfileOrganizationWakeAccess,
  rpcListOrganizationBindingAuthorizationProfiles,
  rpcListOrganizationBindingAuthorizations,
  rpcRevokeAgentProfileBindingForOrganization,
  rpcSaveOrganizationWakeAccessChoice,
  rpcSetOrganizationBindingAuthorizationPreference,
} from "../src/rpc/methods";

const RETIRED_API_ERROR = {
  code: "agent_profile.organization_ownership_required",
  cause: {
    code: "agent_profile.organization_ownership_required",
    message:
      "Agent Profiles can only be used in the workspace where they were created.",
    status: 410,
  },
  status: 410,
};

const env = {} as CoreBindings;

const retiredApis = [
  [
    "authorize one Binding",
    () => rpcAuthorizeAgentProfileBindingForOrganization(env, {} as never),
  ],
  [
    "authorize multiple Bindings",
    () => rpcBulkAuthorizeAgentProfileBindingsForOrganization(env, {} as never),
  ],
  [
    "save current and future Wake access",
    () => rpcSaveOrganizationWakeAccessChoice(env, {} as never),
  ],
  [
    "list Binding authorizations",
    () => rpcListOrganizationBindingAuthorizations(env, {} as never),
  ],
  [
    "list authorization candidates",
    () => rpcListOrganizationBindingAuthorizationProfiles(env, {} as never),
  ],
  [
    "list current-user cross-workspace Wake access",
    () =>
      rpcListCurrentUserAgentProfileOrganizationWakeAccess(env, {} as never),
  ],
  [
    "revoke one Binding authorization",
    () => rpcRevokeAgentProfileBindingForOrganization(env, {} as never),
  ],
  [
    "read future authorization preference",
    () => rpcGetOrganizationBindingAuthorizationPreference(env, {} as never),
  ],
  [
    "write future authorization preference",
    () => rpcSetOrganizationBindingAuthorizationPreference(env, {} as never),
  ],
] as const;

describe("retired Organization Wake access APIs", () => {
  it.each(retiredApis)("rejects %s", async (_name, call) => {
    await expect(call()).rejects.toMatchObject(RETIRED_API_ERROR);
  });
});
