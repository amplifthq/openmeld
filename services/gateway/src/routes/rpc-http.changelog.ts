import {
  changelogQueryResponseSchema,
  changelogQuerySchema,
} from "@openmeld/schemas";
import type { ChangelogQuery } from "@openmeld/schemas/types";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  executePublicRpcRoute,
  respondPublicBadRequest,
} from "./rpc-http.helpers";

const CHANGELOG_ROUTE = "/v1/changelog";
const CHANGELOG_CACHE_CONTROL = "public, max-age=60";
const ALLOWED_CHANGELOG_QUERY_KEYS = new Set([
  "area",
  "audience",
  "kind",
  "limit",
  "offset",
  "release",
  "since",
]);

type ParseChangelogQueryResult =
  | { ok: true; value: ChangelogQuery }
  | { ok: false; message: string };

export function registerChangelogRoutes(app: Hono<HonoBindings>): void {
  app.get(CHANGELOG_ROUTE, async (c) => {
    const query = parseChangelogQuery(c.req.url);
    if (!query.ok) {
      return respondPublicBadRequest({
        c,
        route: CHANGELOG_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: query.message,
      });
    }

    const response = await executePublicRpcRoute({
      c,
      route: CHANGELOG_ROUTE,
      method: "GET",
      responseSchema: changelogQueryResponseSchema,
      execute: async () => await c.var.coreRpc.readChangelog(query.value),
    });
    if (response.ok) {
      response.headers.set("Cache-Control", CHANGELOG_CACHE_CONTROL);
    }
    return response;
  });
}

export function parseChangelogQuery(url: string): ParseChangelogQueryResult {
  const searchParams = new URL(url).searchParams;
  for (const key of searchParams.keys()) {
    if (!ALLOWED_CHANGELOG_QUERY_KEYS.has(key)) {
      return { ok: false, message: `Unknown Changelog query field: ${key}` };
    }
  }

  for (const key of ["limit", "offset", "release", "since"] as const) {
    if (searchParams.getAll(key).length > 1) {
      return {
        ok: false,
        message: `Changelog query field must appear once: ${key}`,
      };
    }
  }

  const rawQuery = {
    ...(searchParams.has("area") ? { areas: searchParams.getAll("area") } : {}),
    ...(searchParams.has("audience")
      ? { audiences: searchParams.getAll("audience") }
      : {}),
    ...(searchParams.has("kind") ? { kinds: searchParams.getAll("kind") } : {}),
    ...(searchParams.has("limit")
      ? { limit: Number(searchParams.get("limit")) }
      : {}),
    ...(searchParams.has("offset")
      ? { offset: Number(searchParams.get("offset")) }
      : {}),
    ...(searchParams.has("release")
      ? { release: searchParams.get("release") }
      : {}),
    ...(searchParams.has("since") ? { since: searchParams.get("since") } : {}),
  };
  const parsed = changelogQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Changelog query is invalid.",
    };
  }
  return { ok: true, value: parsed.data };
}
