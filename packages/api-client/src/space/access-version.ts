import {
  SPACE_ACCESS_VERSION,
  SPACE_ACCESS_VERSION_HEADER,
} from "@openmeld/schemas";

export function currentSpaceAccessHeaders() {
  return { [SPACE_ACCESS_VERSION_HEADER]: SPACE_ACCESS_VERSION };
}
