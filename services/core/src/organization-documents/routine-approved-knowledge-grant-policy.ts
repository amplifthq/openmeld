import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import type { CenterAgentRoutineAuthorizedAction } from "@openmeld/schemas/types";

import { createCoreRpcHttpError } from "../rpc/errors";

const SAVE_APPROVED_KNOWLEDGE_ACTION =
  "organization_documents.save_approved_knowledge";

export function requireRoutineApprovedKnowledgeGrantAuthority(input: {
  currentActions: readonly CenterAgentRoutineAuthorizedAction[];
  nextActions: readonly CenterAgentRoutineAuthorizedAction[];
  role: string;
}): void {
  const addsApprovedKnowledgeGrant =
    input.nextActions.includes(SAVE_APPROVED_KNOWLEDGE_ACTION) &&
    !input.currentActions.includes(SAVE_APPROVED_KNOWLEDGE_ACTION);
  if (
    !addsApprovedKnowledgeGrant ||
    canGrantRoutineApprovedKnowledge(input.role)
  ) {
    return;
  }

  throw createCoreRpcHttpError({
    code: "organization_document.routine_grant_forbidden",
    reason:
      "Only an Organization owner or admin can let a Routine save approved knowledge without review.",
    status: 403,
  });
}

export function canGrantRoutineApprovedKnowledge(role: string): boolean {
  return memberRoleHasOrganizationPermission(role, {
    organizationDocuments: ["saveApprovedKnowledge"],
  });
}
