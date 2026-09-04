import { resolveAvailableProfileHandle } from "@openmeld/protocol";
import { ACCOUNT_DISPLAY_NAME_MAX_LENGTH } from "@openmeld/schemas";
import { isProfileHandleUniqueConstraintError } from "../profile-identity/profile-handle-conflict";
import {
  AccountDisplayNameInvariantError,
  AccountDisplayNameValidationError,
} from "./account-display-name-errors";
import type {
  AccountDisplayNameRepository,
  DefaultHumanProfileRecord,
} from "./account-display-name-repository";

const MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS = 5;

export type UpdateAccountDisplayNameInput = {
  displayName: string;
  ownerUserId: string;
  expectedDefaultHumanProfileId?: string;
};

export type AccountDisplayNameUpdate = {
  displayName: string;
  defaultHumanProfile: DefaultHumanProfileRecord;
};

export type AccountDisplayNameService = ReturnType<
  typeof createAccountDisplayNameService
>;

export function createAccountDisplayNameService(
  repository: AccountDisplayNameRepository
) {
  return {
    update: async (
      input: UpdateAccountDisplayNameInput
    ): Promise<AccountDisplayNameUpdate> => {
      const ownerUserId = normalizeRequiredText(
        input.ownerUserId,
        "ownerUserId"
      );
      const displayName = normalizeDisplayName(input.displayName);

      for (
        let attempt = 0;
        attempt < MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS;
        attempt += 1
      ) {
        const defaultHumanProfile = requireExpectedDefaultHumanProfile(
          await repository.findDefaultHumanProfile(ownerUserId),
          input.expectedDefaultHumanProfileId
        );

        const profileHandle = resolveAvailableProfileHandle({
          profileKind: "human",
          profileName: displayName,
          takenHandles: await repository.listProfileHandles(
            ownerUserId,
            defaultHumanProfile.profileId
          ),
        });

        try {
          const updated = await repository.updateDisplayNamePair({
            displayName,
            ownerUserId,
            profileHandle,
            profileId: defaultHumanProfile.profileId,
          });
          return {
            displayName,
            defaultHumanProfile: updated,
          };
        } catch (error) {
          if (
            attempt === MAX_PROFILE_HANDLE_UPDATE_ATTEMPTS - 1 ||
            !isProfileHandleUniqueConstraintError(error)
          ) {
            throw error;
          }
        }
      }

      throw new AccountDisplayNameInvariantError(
        "failed to update the Account Display Name after max attempts"
      );
    },
  };
}

function normalizeDisplayName(value: unknown): string {
  const normalized = normalizeRequiredText(value, "displayName");
  if (normalized.length > ACCOUNT_DISPLAY_NAME_MAX_LENGTH) {
    throw new AccountDisplayNameValidationError(
      `displayName must be ${ACCOUNT_DISPLAY_NAME_MAX_LENGTH} characters or less`
    );
  }
  return normalized;
}

function requireExpectedDefaultHumanProfile(
  profile: DefaultHumanProfileRecord | null,
  expectedProfileId: string | undefined
): DefaultHumanProfileRecord {
  if (!profile) {
    throw new AccountDisplayNameInvariantError(
      "default profile is required before updating the Account Display Name"
    );
  }
  if (expectedProfileId && profile.profileId !== expectedProfileId) {
    throw new AccountDisplayNameInvariantError(
      "default profile identity changed during the display-name update"
    );
  }
  return profile;
}

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new AccountDisplayNameValidationError(`${field} is required`);
  }
  return normalized;
}
