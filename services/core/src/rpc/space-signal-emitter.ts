import type {
  Profile,
  SignalEnvelope,
  SignalStatusData,
  SignalSystemNoticeData,
  SignalText,
} from "@openmeld/protocol";
import type {
  SpaceSignalAuthoringPolicy,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import type { SpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../lib/bindings";
import type { FinalOutcomeWriteAuthority } from "../space/application/types";
import type {
  CoreRpcContextInput,
  ExecutionRecoveryNoticeSignalData,
  PostExecutionRecoveryNoticeSignalResponse,
} from "./methods";
import {
  rpcPostExecutionRecoveryNoticeSignal,
  rpcPostSignal,
  rpcPostSignalOnceByClientMessageId,
  rpcPostStatusSignal,
  rpcPostSystemNoticeSignal,
  rpcPostTransientSignal,
} from "./methods";

type EmitSpaceTextSignalInput = {
  agentStreamId?: string;
  attachments?: SignalText["data"]["attachments"];
  files?: SignalText["data"]["files"];
  env: CoreBindings;
  spaceId: string;
  profile: Profile;
  text: string;
  authoringPolicy: SpaceSignalAuthoringPolicy;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  messageEnvelope?: SignalText["data"]["messageEnvelope"];
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  transient?: boolean;
  meta?: SignalText["data"]["meta"];
  replyTo?: SignalText["data"]["replyTo"];
  threadContext?: SpaceThreadContext;
};

export const emitSpaceTextSignal = async (
  input: EmitSpaceTextSignalInput
): Promise<SignalEnvelope | null> => {
  if (input.transient === true) {
    await emitTransientSpaceTextSignal(input);
    return null;
  }

  return await rpcPostSignal(input.env, {
    ...(input.agentStreamId === undefined
      ? {}
      : { agentStreamId: input.agentStreamId }),
    spaceId: input.spaceId,
    profile: input.profile,
    text: input.text,
    authoringPolicy: input.authoringPolicy,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.files ? { files: input.files } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
  });
};

export const emitSpaceTextSignalOnceByClientMessageId = async (
  input: EmitSpaceTextSignalInput & { clientMessageId: string }
): Promise<SignalEnvelope> => {
  return await rpcPostSignalOnceByClientMessageId(input.env, {
    ...(input.agentStreamId === undefined
      ? {}
      : { agentStreamId: input.agentStreamId }),
    spaceId: input.spaceId,
    clientMessageId: input.clientMessageId,
    profile: input.profile,
    text: input.text,
    authoringPolicy: input.authoringPolicy,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.files ? { files: input.files } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
  });
};

async function emitTransientSpaceTextSignal(
  input: EmitSpaceTextSignalInput
): Promise<void> {
  await rpcPostTransientSignal(input.env, {
    spaceId: input.spaceId,
    profile: input.profile,
    text: input.text,
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
}

type EmitSpaceStatusSignalInput = {
  env: CoreBindings;
  spaceId: string;
  profile: Profile;
  data: SignalStatusData;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  threadContext?: SpaceThreadContext;
};

type EmitSpaceSystemNoticeSignalInput = {
  env: CoreBindings;
  spaceId: string;
  profile: Profile;
  data: SignalSystemNoticeData;
  finalOutcomeAuthority?: FinalOutcomeWriteAuthority;
  password?: string;
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  threadContext?: SpaceThreadContext;
};

type EmitSpaceExecutionRecoveryNoticeSignalInput = Omit<
  EmitSpaceSystemNoticeSignalInput,
  "data" | "finalOutcomeAuthority"
> & {
  data: ExecutionRecoveryNoticeSignalData;
};

export const emitSpaceStatusSignal = async (
  input: EmitSpaceStatusSignalInput
): Promise<SignalEnvelope> => {
  return await rpcPostStatusSignal(input.env, {
    spaceId: input.spaceId,
    profile: input.profile,
    data: input.data,
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
  });
};

export const emitSpaceSystemNoticeSignal = async (
  input: EmitSpaceSystemNoticeSignalInput
): Promise<SignalEnvelope> => {
  return await rpcPostSystemNoticeSignal(input.env, {
    spaceId: input.spaceId,
    profile: input.profile,
    data: input.data,
    ...(input.finalOutcomeAuthority
      ? { finalOutcomeAuthority: input.finalOutcomeAuthority }
      : {}),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
  });
};

export const emitSpaceExecutionRecoveryNoticeSignal = async (
  input: EmitSpaceExecutionRecoveryNoticeSignalInput
): Promise<PostExecutionRecoveryNoticeSignalResponse> => {
  return await rpcPostExecutionRecoveryNoticeSignal(input.env, {
    spaceId: input.spaceId,
    profile: input.profile,
    data: input.data,
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.spaceAccess ? { spaceAccess: input.spaceAccess } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
  });
};
