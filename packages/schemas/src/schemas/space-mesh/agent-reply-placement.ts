import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { spaceThreadContextSchema } from "./space-thread";

export const AGENT_REPLY_PLACEMENT_HEADER = "x-openmeld-agent-reply-placement";

export function agentStreamForReplyPlacementReader<
  T extends { replyThreadRootSignalId?: string | null },
>(stream: T, supported: boolean): T | null {
  if (supported || stream.replyThreadRootSignalId === undefined) {
    return stream;
  }
  if (stream.replyThreadRootSignalId !== null) {
    return null;
  }
  return { ...stream, replyThreadRootSignalId: undefined };
}

export function agentStreamsForReplyPlacementReader<
  T extends { replyThreadRootSignalId?: string | null },
>(streams: T[], supported: boolean): T[] {
  return streams.flatMap((stream) => {
    const projected = agentStreamForReplyPlacementReader(stream, supported);
    return projected ? [projected] : [];
  });
}

export const agentReplyPlacementSchema = z.enum(["conversation", "thread"]);
export const centerAgentSetReplyPlacementInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  placement: agentReplyPlacementSchema,
});
export const resolveNativeReplyPlacementInputSchema = z.strictObject({
  spaceId: z.string().min(1),
  dispatchId: z.string().min(1),
  sourceSignalId: z.string().min(1),
  profileId: z.string().min(1),
  defaultToThread: z.boolean(),
  lock: z.boolean(),
  placement: agentReplyPlacementSchema.optional(),
});
export const nativeReplyPlacementSchema = z.strictObject({
  dispatchId: z.string().min(1),
  sourceSignalId: z.string().min(1),
  profileId: z.string().min(1),
  threadContext: spaceThreadContextSchema.nullable(),
  locked: z.boolean(),
});
export type CenterAgentSetReplyPlacementInput = z.infer<
  typeof centerAgentSetReplyPlacementInputSchema
>;
export type ResolveNativeReplyPlacementInput = z.infer<
  typeof resolveNativeReplyPlacementInputSchema
>;
export type NativeReplyPlacement = z.infer<typeof nativeReplyPlacementSchema>;
