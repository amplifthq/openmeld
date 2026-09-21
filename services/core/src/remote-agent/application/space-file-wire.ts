import { toLegacySpaceImageGeometryWireValue } from "@openmeld/schemas";

// Remote Agent consumes original bytes and revision identities, not UI geometry.
export async function withRemoteAgentSpaceFileWire<T>(
  value: Promise<T>
): Promise<T> {
  return toLegacySpaceImageGeometryWireValue(await value);
}
