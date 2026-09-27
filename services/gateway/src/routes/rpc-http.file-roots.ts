import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { forwardCoreHttp } from "./rpc-http.forward-core";

const ROOT_ROUTE = "/v1/organizations/current/files/:location";
const MULTIPART_ROUTE = `${ROOT_ROUTE}/file-uploads/:uploadId`;
const FOLDERS_ROUTE = `${ROOT_ROUTE}/folders`;
const COPIES_ROUTE = `${ROOT_ROUTE}/copies`;
const COPY_TO_SPACE_ROUTE = "/v1/spaces/:spaceId/files/copies";
const ENTRY_ROUTE = `${ROOT_ROUTE}/:entryId`;
const CONTENT_ROUTE = `${ENTRY_ROUTE}/content`;
const REVISIONS_ROUTE = `${ENTRY_ROUTE}/revisions`;
const RESTORE_ROUTE = `${ENTRY_ROUTE}/restore`;

export function registerFileRootRoutes(app: Hono<HonoBindings>): void {
  app.get(ROOT_ROUTE, (c) => forwardCoreHttp(c, ROOT_ROUTE));
  app.post(ROOT_ROUTE, (c) => forwardCoreHttp(c, ROOT_ROUTE));
  app.post(MULTIPART_ROUTE, (c) => forwardCoreHttp(c, MULTIPART_ROUTE));
  app.post(FOLDERS_ROUTE, (c) => forwardCoreHttp(c, FOLDERS_ROUTE));
  app.post(COPIES_ROUTE, (c) => forwardCoreHttp(c, COPIES_ROUTE));
  app.post(COPY_TO_SPACE_ROUTE, (c) => forwardCoreHttp(c, COPY_TO_SPACE_ROUTE));
  app.get(REVISIONS_ROUTE, (c) => forwardCoreHttp(c, REVISIONS_ROUTE));
  app.get(CONTENT_ROUTE, (c) => forwardCoreHttp(c, CONTENT_ROUTE));
  app.on("HEAD", CONTENT_ROUTE, (c) => forwardCoreHttp(c, CONTENT_ROUTE));
  app.put(CONTENT_ROUTE, (c) => forwardCoreHttp(c, CONTENT_ROUTE));
  app.get(ENTRY_ROUTE, (c) => forwardCoreHttp(c, ENTRY_ROUTE));
  app.patch(ENTRY_ROUTE, (c) => forwardCoreHttp(c, ENTRY_ROUTE));
  app.delete(ENTRY_ROUTE, (c) => forwardCoreHttp(c, ENTRY_ROUTE));
  app.post(RESTORE_ROUTE, (c) => forwardCoreHttp(c, RESTORE_ROUTE));
}
