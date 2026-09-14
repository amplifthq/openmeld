import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";

export function currentSpaceAddressingHeaders(
  contentType?: "application/json"
): Record<string, string> {
  return {
    [AGENT_REPLY_PLACEMENT_HEADER]: "1",
    ...(contentType ? { "content-type": contentType } : {}),
    [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
      OPENMELD_SPACE_ADDRESSING_VERSION,
  };
}

import { AGENT_REPLY_PLACEMENT_HEADER } from "@openmeld/schemas";
