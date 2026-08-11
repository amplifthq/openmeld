export type RuntimeOwnerReferenceKind = "owner_account" | "owner_principal";

export type RuntimeOwnerReference = {
  kind: RuntimeOwnerReferenceKind;
  id: string;
};

export type RuntimeIdentityKey = {
  owner: RuntimeOwnerReference;
  deviceId: string;
  lane: string;
};

export type RuntimeIdentityKeyInput = {
  owner: RuntimeOwnerReference;
  deviceId: string;
  lane: string;
};

const FORBIDDEN_OPENMELD_SERVICE_RUNTIME_IDENTITY_SCOPE_KEYS = new Set([
  "agentProfileId",
  "humanProfileId",
  "profileId",
  "openMeldProfileId",
  "spaceId",
  "startSessionId",
  "webSocketId",
  "pid",
  "callerPrincipalId",
]);

const normalizeRequiredIdentityField = (input: {
  fieldName: string;
  value: string;
}): string => {
  const value = input.value.trim();
  if (!value) {
    throw new Error(`runtime.identity_invalid: ${input.fieldName} is required`);
  }
  return value;
};

const assertNoForbiddenRuntimeIdentityScope = (
  input: Record<string, unknown>
): void => {
  for (const key of FORBIDDEN_OPENMELD_SERVICE_RUNTIME_IDENTITY_SCOPE_KEYS) {
    if (input[key] !== undefined) {
      throw new Error(
        `runtime.identity_forbidden_scope: ${key} is not part of Runtime identity`
      );
    }
  }
};

export const createRuntimeIdentityKey = (
  input: RuntimeIdentityKeyInput & Record<string, unknown>
): RuntimeIdentityKey => {
  assertNoForbiddenRuntimeIdentityScope(input);
  const ownerKind = input.owner.kind;
  if (ownerKind !== "owner_account" && ownerKind !== "owner_principal") {
    throw new Error("runtime.identity_invalid: owner kind is not supported");
  }
  return {
    owner: {
      kind: ownerKind,
      id: normalizeRequiredIdentityField({
        fieldName: "owner.id",
        value: input.owner.id,
      }),
    },
    deviceId: normalizeRequiredIdentityField({
      fieldName: "deviceId",
      value: input.deviceId,
    }),
    lane: normalizeRequiredIdentityField({
      fieldName: "lane",
      value: input.lane,
    }),
  };
};

export const openMeldServiceRuntimeIdentityKeysEqual = (
  left: RuntimeIdentityKey,
  right: RuntimeIdentityKey
): boolean => {
  return (
    left.owner.kind === right.owner.kind &&
    left.owner.id === right.owner.id &&
    left.deviceId === right.deviceId &&
    left.lane === right.lane
  );
};
