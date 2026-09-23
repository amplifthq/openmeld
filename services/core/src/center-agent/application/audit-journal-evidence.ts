import { centerAgentReadAuditJournalResponseSchema } from "@openmeld/schemas";
import type { ListCenterAgentAuditJournalResponse } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { createCenterAgentEvidenceSourceAccess } from "./evidence-source-access";
import type { prepareCenterAgentRepresentedMemberRequest } from "./represented-member-request";

export async function projectCenterAgentAuditJournalEvidence(input: {
  env: CoreBindings;
  journal: ListCenterAgentAuditJournalResponse;
  prepared: Awaited<
    ReturnType<typeof prepareCenterAgentRepresentedMemberRequest>
  >;
}) {
  const access = await createCenterAgentEvidenceSourceAccess(input);
  const entries = await Promise.all(
    input.journal.entries.map(async (entry) => {
      const {
        contextLoad: _contextLoad,
        contextManifest: _contextManifest,
        interactionSource: _interactionSource,
        sourceSpaceId,
        resource,
        ...summary
      } = entry;
      const [source, target] = await Promise.all([
        sourceSpaceId ? access.readPermittedSpace(sourceSpaceId) : null,
        resource?.type === "space"
          ? access.readPermittedSpace(resource.id)
          : null,
      ]);
      return {
        ...summary,
        ...(sourceSpaceId === undefined
          ? {}
          : { sourceSpaceId: source ? sourceSpaceId : null }),
        resource: target ? resource : null,
      };
    })
  );
  return centerAgentReadAuditJournalResponseSchema.parse({
    organizationId: input.journal.organizationId,
    entries,
    coverage: {
      kind: "bounded_recent_journal",
      references: "authorized_space_references_only",
      contextDetails: "not_included",
      historicalCompleteness: "not_claimed",
    },
  });
}
