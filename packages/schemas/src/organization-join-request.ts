import * as z from "zod/v4";

const id = z.string().trim().min(1).max(255);

// A request is not membership. Email and share-link entry resolve to the same
// recipient-bound decision before either Organization or Space access is granted.
export const organizationJoinRequestSchema = z.strictObject({
  id,
  organizationId: id,
  spaceId: id.nullable(),
  requestedByUserId: id,
  email: z.email(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  reviewedByUserId: id.nullable(),
  createdAt: z.number().int().nonnegative(),
  reviewedAt: z.number().int().nonnegative().nullable(),
  invitationSentAt: z.number().int().nonnegative().nullable(),
  applicantUserId: id.nullable().optional(),
  joinedAt: z.number().int().nonnegative().nullable().optional(),
  canReview: z.boolean().optional(),
  organizationName: z.string().optional(),
  requestedByName: z.string().optional(),
  reviewedByName: z.string().nullable().optional(),
  spaceName: z.string().nullable().optional(),
});

export const organizationJoinRequestInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("create"),
      organizationId: id,
      spaceId: id.optional(),
      email: z.string().trim().toLowerCase().pipe(z.email()),
    }),
    z.strictObject({
      action: z.literal("list"),
      organizationId: id,
      before: z
        .strictObject({
          createdAt: z.number().int().nonnegative(),
          id,
          pending: z.boolean(),
        })
        .optional(),
    }),
    z.strictObject({ action: z.literal("summary"), organizationId: id }),
    z.strictObject({ action: z.literal("get"), requestId: id }),
    z.strictObject({ action: z.literal("approve"), requestId: id }),
    z.strictObject({ action: z.literal("retry"), requestId: id }),
    z.strictObject({ action: z.literal("reject"), requestId: id }),
    z.strictObject({ action: z.literal("cancel"), requestId: id }),
  ]
);

export type OrganizationJoinRequest = z.infer<
  typeof organizationJoinRequestSchema
>;
export type OrganizationJoinRequestInput = z.infer<
  typeof organizationJoinRequestInputSchema
>;

export const organizationJoinRequestRpcInputSchema = z.strictObject({
  responseVersion: z.enum(["2", "3"]).optional(),
  userId: id,
  email: z.email(),
  emailVerified: z.boolean(),
  request: z.union([
    organizationJoinRequestInputSchema,
    z.strictObject({ action: z.literal("delivery_complete"), requestId: id }),
    z.strictObject({ action: z.literal("join_complete"), requestId: id }),
    z.strictObject({
      action: z.literal("authorize_link"),
      organizationId: id,
      spaceId: id.optional(),
    }),
    z.strictObject({
      action: z.literal("create_from_link"),
      organizationId: id,
      spaceId: id.optional(),
      sponsorUserId: id,
    }),
  ]),
});

export const organizationJoinRequestResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      requests: z.array(organizationJoinRequestSchema),
      actionRequiredCount: z.number().int().nonnegative().optional(),
    }),
    z.strictObject({ ok: z.literal(false), code: id, message: z.string() }),
  ]
);
export type OrganizationJoinRequestRpcInput = z.infer<
  typeof organizationJoinRequestRpcInputSchema
>;
export type OrganizationJoinRequestResponse = z.infer<
  typeof organizationJoinRequestResponseSchema
>;

// Existing clients use strict response schemas. Join outcomes are opt-in until
// all callers can distinguish a delivered email from completed membership.
export function organizationJoinRequestResponseForVersion(
  result: OrganizationJoinRequestResponse,
  version?: string
): OrganizationJoinRequestResponse {
  if (!result.ok || version === "3") {
    return result;
  }
  return {
    ...result,
    requests: result.requests.map(
      ({ reviewedByName: _reviewer, applicantUserId, joinedAt, ...request }) =>
        version === "2" ? { ...request, applicantUserId, joinedAt } : request
    ),
  };
}
