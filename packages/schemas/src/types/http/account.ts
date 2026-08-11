import type { z } from "zod/v4";

type AccountDisplayNameSchema =
  typeof import("../../schemas/http/account")["accountDisplayNameSchema"];
type UpdateAccountDisplayNameBodySchema =
  typeof import("../../schemas/http/account")["updateAccountDisplayNameBodySchema"];
type UpdateAccountDisplayNameCompatibilityBodySchema =
  typeof import("../../schemas/http/account")["updateAccountDisplayNameCompatibilityBodySchema"];
type UpdateAccountDisplayNameCompatibilityResponseSchema =
  typeof import("../../schemas/http/account")["updateAccountDisplayNameCompatibilityResponseSchema"];
type UpdateAccountDisplayNameResponseSchema =
  typeof import("../../schemas/http/account")["updateAccountDisplayNameResponseSchema"];
type SelectLastSelectedOrganizationBodySchema =
  typeof import("../../schemas/http/account")["selectLastSelectedOrganizationBodySchema"];
type SelectLastSelectedOrganizationErrorCodeSchema =
  typeof import("../../schemas/http/account")["selectLastSelectedOrganizationErrorCodeSchema"];
type SelectLastSelectedOrganizationErrorResponseSchema =
  typeof import("../../schemas/http/account")["selectLastSelectedOrganizationErrorResponseSchema"];
type SelectLastSelectedOrganizationResponseSchema =
  typeof import("../../schemas/http/account")["selectLastSelectedOrganizationResponseSchema"];

export type AccountDisplayName = z.infer<AccountDisplayNameSchema>;
export type UpdateAccountDisplayNameBody =
  z.infer<UpdateAccountDisplayNameBodySchema>;
export type UpdateAccountDisplayNameCompatibilityBody =
  z.infer<UpdateAccountDisplayNameCompatibilityBodySchema>;
export type UpdateAccountDisplayNameCompatibilityResponse =
  z.infer<UpdateAccountDisplayNameCompatibilityResponseSchema>;
export type UpdateAccountDisplayNameResponse =
  z.infer<UpdateAccountDisplayNameResponseSchema>;
export type SelectLastSelectedOrganizationBody =
  z.infer<SelectLastSelectedOrganizationBodySchema>;
export type SelectLastSelectedOrganizationErrorCode =
  z.infer<SelectLastSelectedOrganizationErrorCodeSchema>;
export type SelectLastSelectedOrganizationErrorResponse =
  z.infer<SelectLastSelectedOrganizationErrorResponseSchema>;
export type SelectLastSelectedOrganizationResponse =
  z.infer<SelectLastSelectedOrganizationResponseSchema>;
