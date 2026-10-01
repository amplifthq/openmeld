import {
  centerAgentAiUsageRpcInputSchema,
  organizationAiUsageRpcInputSchema,
  remoteAiUsageWriteSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAiUsageRpcInput,
  OrganizationAiUsageRpcInput,
  RemoteAiUsageWrite,
  RemoteAiUsageWriteResponse,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import { type CoreBindings, wakeEvidenceDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { aiUsageDay, readAiUsageAllowance } from "./ai-usage-policy";
import { queryAiUsage, recordAiUsage } from "./ai-usage-repository";

// Only exposed on the trusted Remote Agent service-binding entrypoint.
export async function rpcRecordRemoteAiUsage(
  env: CoreBindings,
  input: RemoteAiUsageWrite
): Promise<RemoteAiUsageWriteResponse> {
  const parsed = remoteAiUsageWriteSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.record.runtime !== "remote" ||
    parsed.data.record.source !== "openrouter_response"
  ) {
    throw invalidUsageQuery();
  }
  const { record, phase } = parsed.data;
  const db = requireUsageDb(env);
  if (phase === "begin") {
    if (
      record.status !== "pending" ||
      record.tokens !== null ||
      record.cost !== null
    ) {
      throw invalidUsageQuery();
    }
    const allowance = await readAiUsageAllowance({
      db,
      organizationId: record.organizationId,
      nowMs: Date.now(),
    });
    if (allowance.exhausted) {
      return { status: "limit_reached" };
    }
  } else if (record.status === "pending") {
    throw invalidUsageQuery();
  }
  await recordAiUsage(db, record);
  return { status: "accepted" };
}

export async function rpcReadOrganizationAiUsage(
  env: CoreBindings,
  input: OrganizationAiUsageRpcInput
) {
  const parsed = organizationAiUsageRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidUsageQuery();
  }
  const membership = await resolveActiveOrganizationMembership({
    context: parsed.data.context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  return queryAiUsage({
    db: requireUsageDb(env),
    organizationId: membership.organizationId,
    query: parsed.data.query ?? aiUsageDay(Date.now()),
  });
}

export async function rpcCenterAgentReadAiUsage(
  env: CoreBindings,
  input: CenterAgentAiUsageRpcInput
) {
  const parsed = centerAgentAiUsageRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidUsageQuery();
  }
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    parsed.data.context,
    parsed.data.speakerMember
  );
  return queryAiUsage({
    db: requireUsageDb(env),
    organizationId: prepared.authorization.activeOrganization.organizationId,
    query: parsed.data.query ?? aiUsageDay(Date.now()),
  });
}

function requireUsageDb(env: CoreBindings): D1Database {
  const db = wakeEvidenceDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "usage.store_unavailable",
      reason: "AI usage is unavailable.",
      status: 503,
    });
  }
  return db;
}

function invalidUsageQuery() {
  return createCoreRpcHttpError({
    code: "invalid_payload",
    reason: "Choose a valid AI usage period of up to 31 days.",
    status: 400,
  });
}
