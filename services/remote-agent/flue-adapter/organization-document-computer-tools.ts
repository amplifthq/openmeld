import {
  centerAgentDraftOrganizationDocumentResponseSchema,
  ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
} from "@openmeld/schemas";
import {
  maxLength,
  minLength,
  parse,
  pipe,
  strictObject,
  string,
  trim,
} from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import {
  buildRemoteAgentCoreContext,
  resolveVerifiedTurnEnvelopeSpeaker,
} from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { OrganizationDocumentComputerWorkingCopyStore } from "./organization-document-computer-working-copies";

export const ORGANIZATION_DOCUMENT_COMPUTER_TOOL_NAMES = [
  "openmeld_checkout_org_document",
  "openmeld_submit_org_document_working_copy",
] as const;

const checkoutInputSchema = strictObject({
  documentId: pipe(string(), trim(), minLength(1), maxLength(256)),
});
const submitInputSchema = strictObject({
  path: pipe(string(), trim(), minLength(1), maxLength(1024)),
});

export function getOrganizationDocumentComputerToolDefinitions(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  workingCopies: OrganizationDocumentComputerWorkingCopyStore;
}): RemoteAgentToolDefinition[] {
  const speakerMember = resolveVerifiedTurnEnvelopeSpeaker(
    input.context.turnEnvelope
  );
  if (
    !speakerMember ||
    input.context.turnEnvelope?.trigger.source === "member_research"
  ) {
    return [];
  }
  return [
    {
      name: "openmeld_checkout_org_document",
      description:
        "Create or reopen a writable Computer working copy of one approved Organization Document. Pass the exact document id from openmeld_read_org_documents. Edit the returned path with the normal Computer tools. This does not change the formal Document.",
      input: checkoutInputSchema,
      execute: async (rawInput) => {
        const request = parse(checkoutInputSchema, rawInput);
        return await input.workingCopies.checkout(request.documentId);
      },
    },
    {
      name: "openmeld_submit_org_document_working_copy",
      description:
        "Submit an edited Computer working copy as the Organization Document's pending Markdown draft. A human owner or admin reviews it in Documents before it becomes approved. The submit fails instead of overwriting anything when the formal Document changed after checkout.",
      input: submitInputSchema,
      execute: async (rawInput) => {
        const request = parse(submitInputSchema, rawInput);
        const workingCopy = await input.workingCopies.read(request.path);
        if (
          workingCopy.content.length > ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS
        ) {
          throw new Error(
            `The working copy is longer than ${ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS.toLocaleString("en-US")} characters. Shorten it before submitting.`
          );
        }
        const response = await callCoreRpc(
          input.coreWorker,
          "centerAgentDraftOrganizationDocument",
          {
            context: buildRemoteAgentCoreContext(
              input.context,
              `remote-agent-tool:openmeld_submit_org_document_working_copy:${input.context.submissionId}`
            ),
            documentId: workingCopy.documentId,
            draftContent: workingCopy.content,
            expectedDocumentUpdatedAt: workingCopy.baseUpdatedAt,
            speakerMember,
          },
          (binding, rpcInput) =>
            binding.centerAgentDraftOrganizationDocument?.(rpcInput)
        );
        return {
          ...centerAgentDraftOrganizationDocumentResponseSchema.parse(response),
          workingCopyPath: workingCopy.path,
        };
      },
    },
  ];
}
