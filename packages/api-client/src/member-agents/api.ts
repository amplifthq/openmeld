import {
  listMemberAgentsResponseSchema,
  MEMBER_AGENTS_DISABLED_CODE,
} from "@openmeld/schemas";
import { OpenMeldApiClientHttpError } from "../errors";
import { buildMemberAgentsPath } from "./routes";
import type { CreateMemberAgentsApi } from "./types";

export const createMemberAgentsApi: CreateMemberAgentsApi = (client) => ({
  list: async () =>
    await client.requestJson({
      invalidMessage: "Invalid MemberAgent list response.",
      method: "GET",
      operation: "member_agents.list",
      schema: listMemberAgentsResponseSchema,
      url: buildMemberAgentsPath(),
    }),
});

/**
 * True when Auth answered that the MemberAgent release flag is off. Auth
 * replies with its own `{ ok: false, code }` body, not a Gateway envelope, so
 * the code is read from the raw body.
 */
export function isMemberAgentsDisabledError(error: unknown): boolean {
  if (!(error instanceof OpenMeldApiClientHttpError) || error.status !== 404) {
    return false;
  }
  try {
    const body: unknown = JSON.parse(error.rawBody);
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { code?: unknown }).code === MEMBER_AGENTS_DISABLED_CODE
    );
  } catch {
    return false;
  }
}
