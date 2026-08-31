import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";

export function currentSpaceAddressingHeaders(
  contentType?: "application/json"
): Record<string, string> {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
      OPENMELD_SPACE_ADDRESSING_VERSION,
  };
}
