import {
  decodeOpenMeldHeaderText,
  OPENMELD_HEADER_SPACE_PASSWORD,
} from "@openmeld/gateway-contract";
import { normalizeSpacePasswordText } from "@openmeld/schemas";

export function readSpacePasswordHeader(headers: Headers): string | undefined {
  const value = headers.get(OPENMELD_HEADER_SPACE_PASSWORD);
  if (value === null) {
    return undefined;
  }
  const normalizedPassword = normalizeSpacePasswordText(
    decodeOpenMeldHeaderText(value.trim())
  );
  return normalizedPassword.length > 0 ? normalizedPassword : undefined;
}
