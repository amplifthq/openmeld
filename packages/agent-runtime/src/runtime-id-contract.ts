import {
  createRuntimeIdentityKey,
  type RuntimeIdentityKey,
  type RuntimeIdentityKeyInput,
} from "./runtime-identity";

export type RuntimeLookupInput = RuntimeIdentityKey;

export type OpenMeldServiceRuntimeIdAuthoritySource =
  "runtime_registry_authority";

export type AuthorityOpenMeldServiceRuntimeId = {
  value: string;
  source: OpenMeldServiceRuntimeIdAuthoritySource;
};

export type AuthorityOpenMeldServiceRuntimeIdInput = {
  openMeldServiceRuntimeId: string;
  source: string;
  lookupInput?: RuntimeLookupInput;
};

export type AuthoritativeReadyOpenMeldServiceRuntimeIdInput = {
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId;
};

const RUNTIME_REGISTRY_AUTHORITY_SOURCE: OpenMeldServiceRuntimeIdAuthoritySource =
  "runtime_registry_authority";

const normalizeRuntimeId = (openMeldServiceRuntimeId: string): string => {
  const value = openMeldServiceRuntimeId.trim();
  if (!value) {
    throw new Error("runtime.id_invalid: openMeldServiceRuntimeId is required");
  }
  return value;
};

const getClientComputedLookupForms = (
  lookupInput: RuntimeLookupInput
): Set<string> => {
  const owner = lookupInput.owner;
  return new Set([
    `${owner.kind}:${owner.id}:${lookupInput.deviceId}:${lookupInput.lane}`,
    `${owner.id}:${lookupInput.deviceId}:${lookupInput.lane}`,
    JSON.stringify(lookupInput),
  ]);
};

export const createRuntimeLookupInput = (
  input: RuntimeIdentityKeyInput & Record<string, unknown>
): RuntimeLookupInput => {
  return createRuntimeIdentityKey(input);
};

export const createAuthorityOpenMeldServiceRuntimeId = (
  input: AuthorityOpenMeldServiceRuntimeIdInput
): AuthorityOpenMeldServiceRuntimeId => {
  if (input.source !== RUNTIME_REGISTRY_AUTHORITY_SOURCE) {
    throw new Error(
      "runtime.id_source_invalid: openMeldServiceRuntimeId must come from Runtime Registry authority"
    );
  }

  const value = normalizeRuntimeId(input.openMeldServiceRuntimeId);
  if (
    input.lookupInput &&
    getClientComputedLookupForms(input.lookupInput).has(value)
  ) {
    throw new Error(
      "runtime.id_not_opaque: openMeldServiceRuntimeId must not be computed from Runtime lookup input"
    );
  }

  return {
    value,
    source: RUNTIME_REGISTRY_AUTHORITY_SOURCE,
  };
};

export const assertAuthoritativeReadyOpenMeldServiceRuntimeId = (
  input: AuthoritativeReadyOpenMeldServiceRuntimeIdInput
): void => {
  if (!input.openMeldServiceRuntimeId) {
    throw new Error(
      "runtime.id_missing: authoritative ready requires Runtime Registry openMeldServiceRuntimeId"
    );
  }
};
