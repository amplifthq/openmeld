import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  type SpaceAccessContext,
} from "@openmeld/space";
import type { Context } from "hono";
import type { HonoBindings } from "./bindings";
import { readSpacePasswordHeader } from "./space-password-header";

export function buildGatewaySpaceAccessContext(
  c: Context<HonoBindings>,
  spaceId: string
): SpaceAccessContext {
  if (c.var.spaceAccessContext) {
    return c.var.spaceAccessContext;
  }

  const password = readSpacePassword(c.req.raw.headers);
  const requestContext = c.var.openMeldRequestContext;
  if (requestContext) {
    return createAuthenticatedSpaceAccessContext({
      spaceId,
      requestContext,
      ...(password === undefined ? {} : { password }),
    });
  }

  return createAnonymousViewerSpaceAccessContext({
    spaceId,
    requestId: c.var.ingressOpenMeldContext.requestId,
    ...(password === undefined ? {} : { password }),
  });
}

export function readSpacePassword(headers: Headers): string | undefined {
  return readSpacePasswordHeader(headers);
}
