import * as z from "zod/v4";

export const spaceDispatchPolicyModeSchema = z.enum([
  "mention_only",
  "listen_all",
]);

export const spaceDispatchPolicySchema = z.strictObject({
  mode: spaceDispatchPolicyModeSchema,
});
