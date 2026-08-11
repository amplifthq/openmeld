import {
  LEGACY_RUNTIME_DISPATCH_POLICY,
  type RuntimeDispatchPolicy,
} from "@openmeld/schemas";

export type TriggerMode = RuntimeDispatchPolicy;

export const shouldDispatchForMentionOnly = (input: {
  mentioned: boolean;
  triggerMode?: TriggerMode;
}): boolean => {
  const triggerMode = input.triggerMode ?? LEGACY_RUNTIME_DISPATCH_POLICY;
  if (triggerMode === "listen_all") {
    return true;
  }
  return triggerMode === LEGACY_RUNTIME_DISPATCH_POLICY && input.mentioned;
};
