import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth";

type ReviewedRemoval = {
  actorUserId: string;
  memberId: string;
  organizationId: string;
  expectedMemberRole: string;
};

const reviewScope = new AsyncLocalStorage<ReviewedRemoval>();

/** Only the dedicated authenticated Team route may scope its native deletion. */
export function withReviewedOrganizationMemberRemoval<T>(
  input: ReviewedRemoval,
  execute: () => Promise<T>
): Promise<T> {
  return reviewScope.run(input, execute);
}

type MemberDeleteCondition = {
  field: string;
  value: string;
  operator?: "ne";
};

export async function deleteWithReviewedMemberRemoval(input: {
  request: {
    model: string;
    where: readonly { field: string; value: unknown; operator?: string }[];
  };
  deleteNative: () => Promise<void>;
  deleteGuarded: (where: MemberDeleteCondition[]) => Promise<number>;
}): Promise<void> {
  const review = reviewScope.getStore();
  if (!review || input.request.model !== "member") {
    return input.deleteNative();
  }
  const [selector] = input.request.where;
  if (
    input.request.where.length !== 1 ||
    selector?.field !== "id" ||
    selector.value !== review.memberId ||
    (selector.operator !== undefined && selector.operator !== "eq") ||
    review.expectedMemberRole.split(",").some((role) => role.trim() === "owner")
  ) {
    throw reviewedRemovalChanged();
  }
  const deleted = await input.deleteGuarded([
    { field: "id", value: review.memberId },
    { field: "organizationId", value: review.organizationId },
    { field: "role", value: review.expectedMemberRole },
    { field: "userId", value: review.actorUserId, operator: "ne" },
  ]);
  if (deleted !== 1) {
    // Do not let Better Auth run its success/cleanup path for a rejected write.
    throw reviewedRemovalChanged();
  }
}

function reviewedRemovalChanged(): APIError {
  return new APIError("CONFLICT", {
    code: "organization.member_removal_changed",
    message:
      "The member or their role changed. Review the member again before removing them.",
  });
}
