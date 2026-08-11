import type { z } from "zod/v4";

type AuthProfileKindSchema =
  typeof import("../../schemas/http/profiles")["authProfileKindSchema"];
type AuthProfileStatusSchema =
  typeof import("../../schemas/http/profiles")["authProfileStatusSchema"];
type AuthProfileManagedRoleSchema =
  typeof import("../../schemas/http/profiles")["authProfileManagedRoleSchema"];
type AuthProfileViewSchema =
  typeof import("../../schemas/http/profiles")["authProfileViewSchema"];
type CreateAgentProfileBodySchema =
  typeof import("../../schemas/http/profiles")["createAgentProfileBodySchema"];
type CreateAgentProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["createAgentProfileResponseSchema"];
type CreateHumanProfileBodySchema =
  typeof import("../../schemas/http/profiles")["createHumanProfileBodySchema"];
type CreateHumanProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["createHumanProfileResponseSchema"];
type EnsureManagedAgentProfileBodySchema =
  typeof import("../../schemas/http/profiles")["ensureManagedAgentProfileBodySchema"];
type EnsureManagedAgentProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["ensureManagedAgentProfileResponseSchema"];
type DeleteProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["deleteProfileResponseSchema"];
type ListProfilesResponseSchema =
  typeof import("../../schemas/http/profiles")["listProfilesResponseSchema"];
type ProfileCapabilitiesResponseSchema =
  typeof import("../../schemas/http/profiles")["profileCapabilitiesResponseSchema"];
type ProfileErrorResponseSchema =
  typeof import("../../schemas/http/profiles")["profileErrorResponseSchema"];
type ProfileErrorStatusSchema =
  typeof import("../../schemas/http/profiles")["profileErrorStatusSchema"];
type ProfileRpcErrorResponseSchema =
  typeof import("../../schemas/http/profiles")["profileRpcErrorResponseSchema"];
type ResolveProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["resolveProfileResponseSchema"];
type UpdateProfileResponseSchema =
  typeof import("../../schemas/http/profiles")["updateProfileResponseSchema"];
type UpdateAgentProfileDefaultProjectBodySchema =
  typeof import("../../schemas/http/profiles")["updateAgentProfileDefaultProjectBodySchema"];
type UpdateAgentProfileDefaultProjectResponseSchema =
  typeof import("../../schemas/http/profiles")["updateAgentProfileDefaultProjectResponseSchema"];
type UpdateAgentProfileDefaultProjectRouteParamsSchema =
  typeof import("../../schemas/http/profiles")["updateAgentProfileDefaultProjectRouteParamsSchema"];
type UpdateAgentProfileDefaultProjectRpcInputSchema =
  typeof import("../../schemas/http/profiles")["updateAgentProfileDefaultProjectRpcInputSchema"];

export type AuthProfileKind = z.infer<AuthProfileKindSchema>;
export type AuthProfileStatus = z.infer<AuthProfileStatusSchema>;
export type AuthProfileManagedRole = z.infer<AuthProfileManagedRoleSchema>;
export type AuthProfileView = z.infer<AuthProfileViewSchema>;
export type CreateAgentProfileBody = z.infer<CreateAgentProfileBodySchema>;
export type CreateAgentProfileResponse =
  z.infer<CreateAgentProfileResponseSchema>;
export type CreateHumanProfileBody = z.infer<CreateHumanProfileBodySchema>;
export type CreateHumanProfileResponse =
  z.infer<CreateHumanProfileResponseSchema>;
export type EnsureManagedAgentProfileBody =
  z.infer<EnsureManagedAgentProfileBodySchema>;
export type EnsureManagedAgentProfileResponse =
  z.infer<EnsureManagedAgentProfileResponseSchema>;
export type DeleteProfileResponse = z.infer<DeleteProfileResponseSchema>;
export type ListProfilesResponse = z.infer<ListProfilesResponseSchema>;
export type ProfileCapabilitiesResponse =
  z.infer<ProfileCapabilitiesResponseSchema>;
export type ProfileErrorResponse = z.infer<ProfileErrorResponseSchema>;
export type ProfileErrorStatus = z.infer<ProfileErrorStatusSchema>;
export type ProfileRpcErrorResponse = z.infer<ProfileRpcErrorResponseSchema>;
export type ResolveProfileResponse = z.infer<ResolveProfileResponseSchema>;
export type UpdateProfileResponse = z.infer<UpdateProfileResponseSchema>;
export type UpdateAgentProfileDefaultProjectBody =
  z.infer<UpdateAgentProfileDefaultProjectBodySchema>;
export type UpdateAgentProfileDefaultProjectResponse =
  z.infer<UpdateAgentProfileDefaultProjectResponseSchema>;
export type UpdateAgentProfileDefaultProjectRouteParams =
  z.infer<UpdateAgentProfileDefaultProjectRouteParamsSchema>;
export type UpdateAgentProfileDefaultProjectRpcInput =
  z.infer<UpdateAgentProfileDefaultProjectRpcInputSchema>;
