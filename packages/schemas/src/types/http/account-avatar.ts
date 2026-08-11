import type { z } from "zod/v4";

type AccountAvatarMimeTypeSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarMimeTypeSchema"];
type AccountAvatarReferenceSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarReferenceSchema"];
type AccountAvatarPrepareRpcInputSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarPrepareRpcInputSchema"];
type AccountAvatarPrepareRpcResponseSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarPrepareRpcResponseSchema"];
type AccountAvatarCommitRpcInputSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarCommitRpcInputSchema"];
type AccountAvatarCommitRpcResponseSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarCommitRpcResponseSchema"];
type AccountAvatarMutationErrorCodeSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarMutationErrorCodeSchema"];
type AccountAvatarResponseSchema =
  typeof import("../../schemas/http/account-avatar")["accountAvatarResponseSchema"];

export type AccountAvatarMimeType = z.infer<AccountAvatarMimeTypeSchema>;
export type AccountAvatarReference = z.infer<AccountAvatarReferenceSchema>;
export type AccountAvatarPrepareRpcInput =
  z.infer<AccountAvatarPrepareRpcInputSchema>;
export type AccountAvatarPrepareRpcResponse =
  z.infer<AccountAvatarPrepareRpcResponseSchema>;
export type AccountAvatarCommitRpcInput =
  z.infer<AccountAvatarCommitRpcInputSchema>;
export type AccountAvatarCommitRpcResponse =
  z.infer<AccountAvatarCommitRpcResponseSchema>;
export type AccountAvatarMutationErrorCode =
  z.infer<AccountAvatarMutationErrorCodeSchema>;
export type AccountAvatarResponse = z.infer<AccountAvatarResponseSchema>;
