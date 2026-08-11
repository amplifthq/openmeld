import {
  buildSpacePasswordProof,
  type SpacePasswordProof,
  SpacePasswordProofError,
} from "../../lib/space-password-proof";
import type { CoreRpcContextInput } from "../../rpc/methods";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import {
  parseSetSpaceAccessModeBody,
  parseUpsertSpacePasswordBody,
} from "../rules/parsers/space-password-patch";

type PasswordAuthorizationResult =
  | { ok: true; meta: SpaceMetaRecord }
  | { ok: false; response: Response };

export async function handleUpsertPasswordUseCase(input: {
  body: unknown;
  context: CoreRpcContextInput;
  spaceId: string;
  authorizeSpacePasswordManagement: (
    context: CoreRpcContextInput
  ) => PasswordAuthorizationResult;
  passwordTooShortResponse: (requestId: string) => Response;
  invalidPasswordPayloadResponse: (
    requestId: string,
    message: string
  ) => Response;
  upsertSpaceMetaRecord: (record: SpaceMetaRecord) => void;
}): Promise<Response> {
  const parsed = parseUpsertSpacePasswordBody(input.body);
  if (!parsed.ok) {
    if (parsed.code === "space.password_too_short") {
      return input.passwordTooShortResponse(
        input.context.actorContext.requestId
      );
    }
    return input.invalidPasswordPayloadResponse(
      input.context.actorContext.requestId,
      parsed.message
    );
  }

  const management = input.authorizeSpacePasswordManagement(input.context);
  if (!management.ok) {
    return management.response;
  }

  let proof: SpacePasswordProof;
  try {
    proof = await buildSpacePasswordProof(parsed.password);
  } catch (error) {
    if (
      error instanceof SpacePasswordProofError &&
      error.code === "space.password_too_short"
    ) {
      return input.passwordTooShortResponse(
        input.context.actorContext.requestId
      );
    }
    throw error;
  }

  const now = new Date().toISOString();
  const next: SpaceMetaRecord = {
    ...management.meta,
    accessMode: "protected",
    passwordProof: proof,
    updatedAt: now,
  };
  input.upsertSpaceMetaRecord(next);

  return Response.json({
    spaceId: input.spaceId,
    passwordProtected: true,
  });
}

export function handleClearPasswordUseCase(input: {
  context: CoreRpcContextInput;
  spaceId: string;
  authorizeSpacePasswordManagement: (
    context: CoreRpcContextInput
  ) => PasswordAuthorizationResult;
  upsertSpaceMetaRecord: (record: SpaceMetaRecord) => void;
}): Response {
  const management = input.authorizeSpacePasswordManagement(input.context);
  if (!management.ok) {
    return management.response;
  }

  const now = new Date().toISOString();
  const next: SpaceMetaRecord = {
    ...management.meta,
    accessMode: "public",
    updatedAt: now,
  };
  next.passwordProof = undefined;
  input.upsertSpaceMetaRecord(next);

  return Response.json({
    spaceId: input.spaceId,
    passwordProtected: false,
  });
}

export async function handleSetSpaceAccessModeUseCase(input: {
  body: unknown;
  context: CoreRpcContextInput;
  spaceId: string;
  authorizeSpacePasswordManagement: (
    context: CoreRpcContextInput
  ) => PasswordAuthorizationResult;
  passwordTooShortResponse: (requestId: string) => Response;
  invalidPayloadResponse: (requestId: string, message: string) => Response;
  passwordNotConfiguredResponse: (requestId: string) => Response;
  upsertSpaceMetaRecord: (record: SpaceMetaRecord) => void;
}): Promise<Response> {
  const parsed = parseSetSpaceAccessModeBody(input.body);
  if (!parsed.ok) {
    if (parsed.code === "space.password_too_short") {
      return input.passwordTooShortResponse(
        input.context.actorContext.requestId
      );
    }
    return input.invalidPayloadResponse(
      input.context.actorContext.requestId,
      parsed.message
    );
  }

  const management = input.authorizeSpacePasswordManagement(input.context);
  if (!management.ok) {
    return management.response;
  }

  const now = new Date().toISOString();
  const next: SpaceMetaRecord = {
    ...management.meta,
    accessMode: parsed.accessMode,
    updatedAt: now,
  };

  if (parsed.accessMode === "public" || parsed.accessMode === "members_only") {
    next.passwordProof = undefined;
  } else if (parsed.password !== undefined) {
    const proof = await buildProofOrReturnResponse({
      password: parsed.password,
      requestId: input.context.actorContext.requestId,
      passwordTooShortResponse: input.passwordTooShortResponse,
    });
    if (proof instanceof Response) {
      return proof;
    }
    next.passwordProof = proof;
  } else if (!next.passwordProof) {
    return input.passwordNotConfiguredResponse(
      input.context.actorContext.requestId
    );
  }

  input.upsertSpaceMetaRecord(next);

  return Response.json({
    spaceId: input.spaceId,
    accessMode: next.accessMode,
    passwordProtected: next.accessMode === "protected",
  });
}

async function buildProofOrReturnResponse(input: {
  password: string;
  requestId: string;
  passwordTooShortResponse: (requestId: string) => Response;
}): Promise<SpacePasswordProof | Response> {
  try {
    return await buildSpacePasswordProof(input.password);
  } catch (error) {
    if (
      error instanceof SpacePasswordProofError &&
      error.code === "space.password_too_short"
    ) {
      return input.passwordTooShortResponse(input.requestId);
    }
    throw error;
  }
}
