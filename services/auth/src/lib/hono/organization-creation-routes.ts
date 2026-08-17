import {
  createWithGeneratedOrganizationSlug,
  OrganizationSlugAllocationError,
  OrganizationSlugConflictError,
} from "@openmeld/auth/server";
import { createOrganizationBodySchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";

export const ORGANIZATION_CREATE_ROUTE =
  "/api/auth/organization/create" as const;

type OrganizationCreateApi = {
  createOrganization: (input: {
    asResponse: true;
    body: {
      keepCurrentActiveOrganization: true;
      name: string;
      slug: string;
    };
    headers: Headers;
  }) => Promise<Response>;
};

export function registerOrganizationCreationRoutes(app: Hono<AppContext>) {
  app.post(ORGANIZATION_CREATE_ROUTE, requireTrustedCookieOrigin, async (c) => {
    const parsedBody = createOrganizationBodySchema.safeParse(
      await readJsonBody(c)
    );
    if (!parsedBody.success) {
      return c.json(
        {
          code: "ORGANIZATION_NAME_INVALID",
          message:
            parsedBody.error.issues[0]?.message ??
            "Organization name is invalid.",
        },
        400
      );
    }

    try {
      const organizationApi = requireOrganizationCreateApi(
        c.var.betterAuth.api
      );
      return await createWithGeneratedOrganizationSlug({
        create: async (slug) => {
          const response = await organizationApi.createOrganization({
            asResponse: true,
            body: {
              keepCurrentActiveOrganization: true,
              name: parsedBody.data.name,
              slug,
            },
            headers: c.req.raw.headers,
          });
          if (await responseHasSlugConflict(response)) {
            throw new OrganizationSlugConflictError();
          }
          return response;
        },
        name: parsedBody.data.name,
      });
    } catch (error) {
      if (error instanceof OrganizationSlugAllocationError) {
        return c.json(
          {
            code: "ORGANIZATION_URL_UNAVAILABLE",
            message:
              "OpenMeld couldn’t create a unique organization URL. Try again.",
          },
          503
        );
      }
      throw error;
    }
  });
}

function requireOrganizationCreateApi(value: unknown): OrganizationCreateApi {
  if (!(value && typeof value === "object" && "createOrganization" in value)) {
    throw new Error("Better Auth Organization creation API is unavailable.");
  }
  const createOrganization = (value as { createOrganization?: unknown })
    .createOrganization;
  if (typeof createOrganization !== "function") {
    throw new Error("Better Auth Organization creation API is unavailable.");
  }
  return value as OrganizationCreateApi;
}

async function responseHasSlugConflict(response: Response): Promise<boolean> {
  if (response.status !== 400) {
    return false;
  }
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "code" in payload &&
      payload.code === "ORGANIZATION_ALREADY_EXISTS"
  );
}

async function readJsonBody(c: {
  req: { text: () => Promise<string> };
}): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
