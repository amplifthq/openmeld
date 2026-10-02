import {
  type PluginChannelSourceProof,
  pluginChannelSourceProofSchema,
} from "@openmeld/schemas";
import { digestCanonicalJson } from "@openmeld/utils";

/** Raw admitted text/resource identities, not a model rendering or truncated
 * history summary. Revision separately rejects edits even when text is reverted. */
export async function buildPluginChannelSourceProof(input: {
  provider: PluginChannelSourceProof["provider"];
  messageId: string;
  providerUserId: string;
  text: string;
  resourceIds: readonly string[];
  revision?: string | null;
}): Promise<PluginChannelSourceProof> {
  return pluginChannelSourceProofSchema.parse({
    provider: input.provider,
    messageId: input.messageId,
    providerUserId: input.providerUserId,
    fingerprint: await digestCanonicalJson([
      input.provider,
      input.messageId,
      input.providerUserId,
      input.text.trim(),
      [...new Set(input.resourceIds)].sort(),
    ]),
    revision: input.revision ?? null,
  });
}
export function assertPluginChannelSourceUnchanged(
  expected: PluginChannelSourceProof,
  current: PluginChannelSourceProof | null
) {
  if (
    !current ||
    current.provider !== expected.provider ||
    current.messageId !== expected.messageId ||
    current.providerUserId !== expected.providerUserId ||
    current.fingerprint !== expected.fingerprint ||
    current.revision !== expected.revision
  ) {
    throw new Error(
      "plugin.channel.original_request_changed: The original channel request was edited, removed or is no longer available. This check did not start a continuation. A previously accepted continuation may still be active: inspect the original conversation and do not repeat completed writes."
    );
  }
}
