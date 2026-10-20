import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  accountOrganizationContextSchema,
  normalizeOrganizationList,
} from "@openmeld/schemas";
import type { betterAuth } from "better-auth";
import type { organization } from "better-auth/plugins";
import type { Hono } from "hono";
import { getAccountOrganizationPreferenceRepository } from "../account/organization-preference-service";
import type { AppContext } from "../context";
import { observeAccountOrganizationContextRead } from "../observability/cloudflare-runtime-evidence";
import { requireAuthenticatedUser } from "./authenticated-user";

type OrganizationListApi = Pick<
  ReturnType<
    typeof betterAuth<{
      plugins: [ReturnType<typeof organization>];
    }>
  >["api"],
  "listOrganizations"
>;

function requireOrganizationListApi(api: object): OrganizationListApi {
  if (
    !("listOrganizations" in api) ||
    typeof api.listOrganizations !== "function"
  ) {
    throw new Error("Organization membership API is unavailable.");
  }
  return api as OrganizationListApi;
}

export function registerAccountOrganizationContextRoutes(
  app: Hono<AppContext>
) {
  app.get(ACCOUNT_ORGANIZATION_CONTEXT_PATH, async (c) => {
    const auth = requireAuthenticatedUser(c);
    if (!auth.ok) {
      return auth.response;
    }
    const [memberships, lastSelected] = await Promise.all([
      observeAccountOrganizationContextRead(c, "memberships", () =>
        requireOrganizationListApi(c.var.betterAuth.api).listOrganizations({
          headers: c.req.raw.headers,
        })
      ),
      observeAccountOrganizationContextRead(c, "preference", () =>
        getAccountOrganizationPreferenceRepository(
          c.env
        ).getLastSelectedOrganizationId(auth.user.id)
      ),
    ]);
    const organizations = normalizeOrganizationList(memberships);
    const session = c.var.session;
    const activeId =
      session &&
      "activeOrganizationId" in session &&
      typeof session.activeOrganizationId === "string"
        ? session.activeOrganizationId
        : null;
    const defaultOrganization =
      [lastSelected, activeId]
        .map((id) =>
          organizations.find((organization) => organization.id === id?.trim())
        )
        .find(Boolean) ?? organizations[0];
    return c.json(
      accountOrganizationContextSchema.parse({
        account: {
          email: auth.user.email ?? null,
          image: auth.user.image ?? null,
          name: auth.user.name ?? null,
        },
        currentUserId: auth.user.id,
        organizations,
        defaultOrganizationId: defaultOrganization?.id ?? null,
      })
    );
  });
}
