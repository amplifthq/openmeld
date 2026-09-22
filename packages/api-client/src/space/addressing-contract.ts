import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import { AGENT_REPLY_PLACEMENT_HEADER } from "@openmeld/schemas";

export function currentSpaceAddressingHeaders(
  contentType?: "application/json"
): Record<string, string> {
  return {
    [AGENT_REPLY_PLACEMENT_HEADER]: "1",
    ...(contentType ? { "content-type": contentType } : {}),
    [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
      OPENMELD_SPACE_ADDRESSING_VERSION,
    ...currentSpaceImageGeometryHeaders(),
  };
}

export function currentSpaceImageGeometryHeaders(): Record<string, string> {
  return {
    [OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
      OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
  };
}

export function currentSpaceFileHeaders(): Record<string, string> {
  return {
    [OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION]:
      OPENMELD_SPACE_FILES_ORIGIN_VERSION,
    ...currentSpaceImageGeometryHeaders(),
  };
}
