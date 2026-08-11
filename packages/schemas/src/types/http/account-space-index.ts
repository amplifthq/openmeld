import type { z } from "zod/v4";

type AccountSpaceIndexJoinedProfileSchema =
  typeof import("../../schemas/http/account-space-index")["accountSpaceIndexJoinedProfileSchema"];
type AccountSpaceIndexDeletedItemSchema =
  typeof import("../../schemas/http/account-space-index")["accountSpaceIndexDeletedItemSchema"];
type AccountSpaceIndexItemSchema =
  typeof import("../../schemas/http/account-space-index")["accountSpaceIndexItemSchema"];
type AccountSpaceIndexQuerySchema =
  typeof import("../../schemas/http/account-space-index")["accountSpaceIndexQuerySchema"];
type AccountSpaceIndexResponseSchema =
  typeof import("../../schemas/http/account-space-index")["accountSpaceIndexResponseSchema"];

export type AccountSpaceIndexJoinedProfile =
  z.infer<AccountSpaceIndexJoinedProfileSchema>;
export type AccountSpaceIndexDeletedItem =
  z.infer<AccountSpaceIndexDeletedItemSchema>;
export type AccountSpaceIndexItem = z.infer<AccountSpaceIndexItemSchema>;
export type AccountSpaceIndexQuery = z.infer<AccountSpaceIndexQuerySchema>;
export type AccountSpaceIndexResponse =
  z.infer<AccountSpaceIndexResponseSchema>;
