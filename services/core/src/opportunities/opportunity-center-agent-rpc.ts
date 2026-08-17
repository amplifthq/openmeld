import {
  centerAgentListOpportunitiesToolResponseSchema,
  centerAgentListOpportunitiesToolRpcInputSchema,
  centerAgentRecommendOpportunityToolResponseSchema,
  centerAgentRecommendOpportunityToolRpcInputSchema,
  centerAgentRespondToOpportunityToolResponseSchema,
  centerAgentRespondToOpportunityToolRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentListOpportunitiesToolResponse,
  CenterAgentListOpportunitiesToolRpcInput,
  CenterAgentRecommendOpportunityToolResponse,
  CenterAgentRecommendOpportunityToolRpcInput,
  CenterAgentRespondToOpportunityToolResponse,
  CenterAgentRespondToOpportunityToolRpcInput,
  OpportunityDecision,
  OpportunityStatus,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { type CoreBindings, opportunityDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  createOpportunityService,
  OpportunityConflictError,
  OpportunityNotFoundError,
} from "./application/opportunity-service";

export async function rpcCenterAgentRecommendOpportunity(
  env: CoreBindings,
  input: CenterAgentRecommendOpportunityToolRpcInput
): Promise<CenterAgentRecommendOpportunityToolResponse> {
  const request = parseInput(
    centerAgentRecommendOpportunityToolRpcInputSchema,
    input,
    "Center Agent Opportunity recommendation is invalid."
  );
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const db = requireOpportunityDb(env);
  const { context: _context, speakerMember: _speakerMember, ...body } = request;
  const result = await mapOpportunityError(() =>
    createOpportunityService(db).recommend({
      createdByProfileId: represented.authorization.actorProfileId,
      nowMs: Date.now(),
      organizationId:
        represented.authorization.activeOrganization.organizationId,
      recipientUserId: represented.representedHuman.userId,
      request: body,
      sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
    })
  );
  return centerAgentRecommendOpportunityToolResponseSchema.parse({
    ...result,
    instruction: recommendInstruction(
      result.created,
      result.opportunity.status
    ),
  });
}

export async function rpcCenterAgentListOpportunities(
  env: CoreBindings,
  input: CenterAgentListOpportunitiesToolRpcInput
): Promise<CenterAgentListOpportunitiesToolResponse> {
  const request = parseInput(
    centerAgentListOpportunitiesToolRpcInputSchema,
    input,
    "Center Agent Opportunity list request is invalid."
  );
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const db = requireOpportunityDb(env);
  const { context: _context, speakerMember: _speakerMember, ...body } = request;
  const organizationId =
    represented.authorization.activeOrganization.organizationId;
  const opportunities = await createOpportunityService(db).list({
    organizationId,
    recipientUserId: represented.representedHuman.userId,
    request: body,
  });
  return centerAgentListOpportunitiesToolResponseSchema.parse({
    opportunities,
    organizationId,
  });
}

export async function rpcCenterAgentRespondToOpportunity(
  env: CoreBindings,
  input: CenterAgentRespondToOpportunityToolRpcInput
): Promise<CenterAgentRespondToOpportunityToolResponse> {
  const request = parseInput(
    centerAgentRespondToOpportunityToolRpcInputSchema,
    input,
    "Center Agent Opportunity decision is invalid."
  );
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const db = requireOpportunityDb(env);
  const { context: _context, speakerMember: _speakerMember, ...body } = request;
  const result = await mapOpportunityError(() =>
    createOpportunityService(db).respond({
      nowMs: Date.now(),
      organizationId:
        represented.authorization.activeOrganization.organizationId,
      recipientUserId: represented.representedHuman.userId,
      request: body,
    })
  );
  return centerAgentRespondToOpportunityToolResponseSchema.parse({
    ...result,
    instruction: responseInstruction(body.decision),
  });
}

function requireOpportunityDb(env: CoreBindings): D1Database {
  const db = opportunityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "opportunity.store_unavailable",
      reason: "Opportunity storage is unavailable.",
      status: 503,
    });
  }
  return db;
}

function recommendInstruction(
  created: boolean,
  status: OpportunityStatus
): string {
  if (created) {
    return "Present this opportunity once to the verified member. Ask them to accept it, say not now, or dismiss it. Do not imply that accepting executes the suggested next step.";
  }
  if (status === "open") {
    return "This opportunity is already open for this member. Do not create or announce a duplicate; summarize the existing record only if it answers the current request.";
  }
  return `This opportunity is already ${status}. Do not present it again unless the member explicitly asks to review past opportunities.`;
}

function responseInstruction(decision: OpportunityDecision): string {
  switch (decision) {
    case "accepted":
      return "The member accepted the recommendation. Nothing has been executed. Use the existing owning capability only if the member also authorized the concrete action and every required input is known.";
    case "deferred":
      return "The member chose not now. Do not resurface this opportunity automatically in phase one.";
    case "dismissed":
      return "The member dismissed the opportunity. Do not resurface the same opportunity key.";
    default:
      return assertNever(decision);
  }
}

function parseInput<T>(
  schema: { safeParse(value: unknown): { data?: T; success: boolean } },
  input: unknown,
  reason: string
): T {
  const parsed = schema.safeParse(input);
  if (!(parsed.success && parsed.data)) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason,
      status: 400,
    });
  }
  return parsed.data;
}

async function mapOpportunityError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      throw createCoreRpcHttpError({
        code: "opportunity.not_found",
        reason: error.message,
        status: 404,
      });
    }
    if (error instanceof OpportunityConflictError) {
      throw createCoreRpcHttpError({
        code: "opportunity.conflict",
        reason: error.message,
        status: 409,
      });
    }
    throw error;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Opportunity decision: ${String(value)}`);
}
