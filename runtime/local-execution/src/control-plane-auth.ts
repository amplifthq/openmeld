import type { OpenMeldDaemonControlPlaneContext } from "./control-plane.js";
import {
  buildControlPlaneResponse,
  parseControlPlaneRequest,
} from "./control-plane.js";

export const verifyControlPlaneToken = (input: {
  expectedToken: string;
  providedToken: string | undefined;
}): boolean => input.providedToken === input.expectedToken;

export const buildAuthenticatedControlPlaneResponse = async (input: {
  context: OpenMeldDaemonControlPlaneContext;
  expectedToken: string;
  request: unknown;
}) => {
  const request = parseControlPlaneRequest(input.request);
  const authorized = verifyControlPlaneToken({
    expectedToken: input.expectedToken,
    providedToken: request.authToken,
  });
  if (!authorized) {
    throw new Error("auth.unauthenticated");
  }
  return await buildControlPlaneResponse({
    context: input.context,
    request,
  });
};
