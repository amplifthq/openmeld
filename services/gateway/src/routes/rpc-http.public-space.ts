import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { registerConversationStateRoute } from "./rpc-http.conversation-state";
import { registerLinkPreviewRoutes } from "./rpc-http.link-previews";
import { registerMembersRoutes } from "./rpc-http.members";
import { registerSignalsRoutes } from "./rpc-http.signals";
import { registerSpaceEntryResolutionRoute } from "./rpc-http.space-entry";
import { registerStatusRoutes } from "./rpc-http.status";
import { registerThreadRoutes } from "./rpc-http.threads";
import type { RpcHttpMethod } from "./rpc-http.types";

const PUBLIC_SPACE_BOUNDARY_ROUTE_DEFINITIONS = [
  ["getSpaceLinkPreviews", "GET", "/v1/spaces/:spaceId/link-previews"],
  [
    "getSpaceConversationState",
    "GET",
    "/v1/spaces/:spaceId/conversation-state",
  ],
  ["getSpaceStatus", "GET", "/v1/spaces/:spaceId/status"],
  ["getSpaceEntryResolution", "GET", "/v1/spaces/:spaceId/entry-resolution"],
  ["getSpaceMembers", "GET", "/v1/spaces/:spaceId/members"],
  [
    "getSpaceIdentityDirectory",
    "GET",
    "/v1/spaces/:spaceId/identity-directory",
  ],
  ["getSpaceMemberDirectory", "GET", "/v1/spaces/:spaceId/member-directory"],
  ["addSpaceMembers", "POST", "/v1/spaces/:spaceId/members"],
  ["removeSpaceMembers", "POST", "/v1/spaces/:spaceId/members/remove"],
  ["leaveSpace", "POST", "/v1/spaces/:spaceId/leave"],
  ["joinSpace", "POST", "/v1/spaces/:spaceId/join"],
  ["addCenterAgentToSpace", "POST", "/v1/spaces/:spaceId/center-agent"],
  [
    "addOrganizationDirectoryProfilesToSpace",
    "POST",
    "/v1/spaces/:spaceId/organization-directory-profiles",
  ],
  ["listSignals", "GET", "/v1/spaces/:spaceId/signals"],
  ["postSignal", "POST", "/v1/spaces/:spaceId/signals"],
  ["listSpaceThreads", "GET", "/v1/spaces/:spaceId/threads"],
  ["createSpaceThread", "POST", "/v1/spaces/:spaceId/threads"],
] as const satisfies readonly [
  endpoint: string,
  method: RpcHttpMethod,
  path: string,
][];

export const PUBLIC_SPACE_BOUNDARY_ROUTES =
  PUBLIC_SPACE_BOUNDARY_ROUTE_DEFINITIONS.map(([, method, path]) => ({
    method,
    path,
  })) as readonly {
    method: RpcHttpMethod;
    path: string;
  }[];

export const PUBLIC_SPACE_BOUNDARY_ENDPOINTS = Object.fromEntries(
  PUBLIC_SPACE_BOUNDARY_ROUTE_DEFINITIONS.map(([endpoint, method, path]) => [
    endpoint,
    `${method} ${path}`,
  ])
) as Record<
  (typeof PUBLIC_SPACE_BOUNDARY_ROUTE_DEFINITIONS)[number][0],
  string
>;

export function registerPublicSpaceBoundaryRoutes(
  app: Hono<HonoBindings>
): void {
  registerConversationStateRoute(app);
  registerLinkPreviewRoutes(app);
  registerSignalsRoutes(app);
  registerMembersRoutes(app);
  registerStatusRoutes(app);
  registerSpaceEntryResolutionRoute(app);
  registerThreadRoutes(app);
}
