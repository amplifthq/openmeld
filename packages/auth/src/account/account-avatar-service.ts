import {
  buildAccountAvatarPublicPath,
  parseAccountAvatarReferenceFromUrl,
} from "@openmeld/schemas";
import type {
  AccountAvatarCommitRpcInput,
  AccountAvatarCommitRpcResponse,
  AccountAvatarPrepareRpcInput,
  AccountAvatarPrepareRpcResponse,
} from "@openmeld/schemas/types";
import type {
  AccountAvatarMutationRecord,
  AccountAvatarMutationRepository,
} from "./account-avatar-repository";

export type {
  AccountAvatarMutationRecord,
  AccountAvatarMutationRepository,
} from "./account-avatar-repository";

export function createAccountAvatarService(input: {
  repository: AccountAvatarMutationRepository;
}) {
  const readAccount = async (request: {
    actorUserId: string;
  }): Promise<
    | { ok: true; record: AccountAvatarMutationRecord }
    | {
        ok: false;
        response: Extract<AccountAvatarPrepareRpcResponse, { ok: false }>;
      }
  > => {
    const record = await input.repository.readForActor(request);
    if (!record) {
      return {
        ok: false,
        response: mutationFailure(
          "account.avatar.profile_not_found",
          "Your default profile is unavailable."
        ),
      };
    }
    return { ok: true, record };
  };

  return {
    prepare: async (
      request: AccountAvatarPrepareRpcInput
    ): Promise<AccountAvatarPrepareRpcResponse> => {
      const account = await readAccount(request);
      if (!account.ok) {
        return account.response;
      }
      return {
        currentAvatar: account.record.avatar,
        defaultHumanProfileId: account.record.defaultHumanProfileId,
        ok: true,
      };
    },
    commit: async (
      request: AccountAvatarCommitRpcInput
    ): Promise<AccountAvatarCommitRpcResponse> => {
      const account = await readAccount(request);
      if (!account.ok) {
        return account.response;
      }
      if (
        account.record.avatar !== request.expectedAvatar ||
        account.record.defaultHumanProfileId !==
          request.expectedDefaultHumanProfileId
      ) {
        return mutationFailure(
          "account.avatar.conflict",
          "Your avatar changed before this update completed."
        );
      }

      const nextAvatarUrl = request.nextAvatar?.url ?? null;
      if (
        request.nextAvatar &&
        !isExpectedManagedAvatarReference({
          assetId: request.nextAvatar.assetId,
          profileId: account.record.defaultHumanProfileId,
          url: request.nextAvatar.url,
        })
      ) {
        return mutationFailure(
          "account.avatar.invalid_reference",
          "The account avatar reference is invalid."
        );
      }

      const updated = await input.repository.compareAndSetAvatar({
        actorUserId: request.actorUserId,
        expectedAvatar: request.expectedAvatar,
        expectedDefaultHumanProfileId: request.expectedDefaultHumanProfileId,
        nextAvatar: nextAvatarUrl,
      });
      if (!updated) {
        return mutationFailure(
          "account.avatar.conflict",
          "Your avatar changed before this update completed."
        );
      }
      return {
        avatar: nextAvatarUrl,
        defaultHumanProfileId: account.record.defaultHumanProfileId,
        ok: true,
      };
    },
  };
}

function isExpectedManagedAvatarReference(input: {
  assetId: string;
  profileId: string;
  url: string;
}): boolean {
  const parsed = parseAccountAvatarReferenceFromUrl(input.url);
  return (
    parsed?.assetId === input.assetId &&
    parsed.profileId === input.profileId &&
    new URL(input.url).pathname ===
      buildAccountAvatarPublicPath({
        assetId: input.assetId,
        profileId: input.profileId,
      })
  );
}

function mutationFailure(
  code: Extract<AccountAvatarPrepareRpcResponse, { ok: false }>["code"],
  message: string
): Extract<AccountAvatarPrepareRpcResponse, { ok: false }> {
  return { code, message, ok: false };
}
