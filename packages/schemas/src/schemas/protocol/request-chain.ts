import * as z from "zod/v4";
import { MAX_VISITED_PROFILE_IDS } from "./constants";

// Contract: developing/architecture/agent-transport-contract.md (Request Chain).
// Core writes the chain at Wake time. Agents and clients never supply it.

const reference = z.string().trim().min(1).max(2048);

/**
 * The most distinct Agents one chain can hold. It equals the visited-list
 * ceiling, so the chain is never stricter than the Auto-Relay Loop Policy.
 * A conversational revisit does not add an entry, so rounds are unbounded.
 */
export const REQUEST_CHAIN_MAX_AGENTS = MAX_VISITED_PROFILE_IDS;

export const requestChainHumanEntrySchema = z.strictObject({
  kind: z.literal("human"),
  profileId: reference,
});
export const requestChainSourceEntrySchema = z.strictObject({
  kind: z.literal("source"),
  source: z.enum(["routine"]),
  sourceId: reference,
});
export const requestChainAgentEntrySchema = z.strictObject({
  kind: z.literal("agent"),
  profileId: reference,
});
export const requestChainEntrySchema = z.discriminatedUnion("kind", [
  requestChainHumanEntrySchema,
  requestChainSourceEntrySchema,
  requestChainAgentEntrySchema,
]);

/**
 * `[root human, optional source marker, Agent, Agent, ...]`. The first entry
 * is the human root requester; each Agent appears at most once.
 */
export const requestChainSchema = z
  .array(requestChainEntrySchema)
  .min(1)
  .max(REQUEST_CHAIN_MAX_AGENTS + 2)
  .superRefine((chain, context) => {
    if (chain[0]?.kind !== "human") {
      context.addIssue({
        code: "custom",
        message: "A request chain starts with its human root requester.",
      });
      return;
    }
    const agents = new Set<string>();
    for (const [index, entry] of chain.entries()) {
      if (index === 0) {
        continue;
      }
      if (entry.kind === "human") {
        context.addIssue({
          code: "custom",
          message: "A request chain has exactly one human root requester.",
        });
        return;
      }
      if (entry.kind === "source" && index !== 1) {
        context.addIssue({
          code: "custom",
          message: "A source marker directly follows the root requester.",
        });
        return;
      }
      if (entry.kind === "agent") {
        if (agents.has(entry.profileId)) {
          context.addIssue({
            code: "custom",
            message: "An Agent appears at most once in a request chain.",
          });
          return;
        }
        agents.add(entry.profileId);
      }
    }
    if (agents.size > REQUEST_CHAIN_MAX_AGENTS) {
      context.addIssue({
        code: "custom",
        message: "The request chain has too many Agents.",
      });
    }
  });
