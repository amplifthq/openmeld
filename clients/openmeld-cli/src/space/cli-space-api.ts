import { createSpaceApi, type SpaceApi } from "@openmeld/api-client";
import { createCliApiClientFoundation } from "./api-client-foundation";

export type {
  SpaceApi,
  SpaceSignalsReadQuery,
} from "@openmeld/api-client";

export function createCliSpaceApi(
  baseUrl: string,
  options: { organizationId?: string } = {}
): SpaceApi {
  return createSpaceApi(createCliApiClientFoundation(baseUrl, options));
}
