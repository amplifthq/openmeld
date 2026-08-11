export type TargetWakeLifecycleIdentity = import("zod/v4").infer<
  typeof import("../../schemas/protocol/target-wake-lifecycle")["targetWakeLifecycleIdentitySchema"]
>;
