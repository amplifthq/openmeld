import type {
  AuthRpcClaims,
  AuthRpcMethod,
  ProfileKind,
} from "@openmeld/schemas/types";

export type AuthProfileKind = ProfileKind;
export type AuthMethod = AuthRpcMethod;
export type AuthClaims = AuthRpcClaims;

export function createUnauthenticatedClaims(requestId: string): AuthClaims {
  return {
    authenticated: false,
    requestId,
    ownerIds: [],
    authMethod: "none",
  };
}
