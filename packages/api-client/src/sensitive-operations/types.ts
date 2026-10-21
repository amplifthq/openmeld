import type {
  CredentialConfirmationDecision,
  DecideCredentialConfirmationResponse,
  GetCredentialConfirmationResponse,
  ListSensitiveOperationAuditResponse,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";

export type SensitiveOperationsApi = {
  /** The owner's confirmation of a sensitive CLI request. */
  getConfirmation: (
    confirmationId: string
  ) => Promise<GetCredentialConfirmationResponse>;
  /** Answer it; Core accepts only the owner's own Web or App session. */
  decideConfirmation: (
    confirmationId: string,
    decision: CredentialConfirmationDecision
  ) => Promise<DecideCredentialConfirmationResponse>;
  /** Owner-only audit of a MemberAgent's sensitive operations. */
  listMemberAgentAudit: (
    memberAgentId: string
  ) => Promise<ListSensitiveOperationAuditResponse>;
};

export type CreateSensitiveOperationsApi = (
  client: OpenMeldApiClientFoundation
) => SensitiveOperationsApi;
