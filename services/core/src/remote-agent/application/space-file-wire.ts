/**
 * Remote Agent uses original bytes and revision identities, not UI geometry.
 * Project validated RPC output only; never persist this as Space truth.
 * Walk plain records so nested messages/revisions are covered without copying
 * streams, typed arrays, or other RPC resources.
 */
export function projectRemoteAgentSpaceFileWire<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(projectRemoteAgentSpaceFileWire) as T;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return value;
  }
  const isFileRevision =
    "fileId" in value &&
    "revision" in value &&
    "mimeType" in value &&
    "sizeBytes" in value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isFileRevision || key !== "imageDimensions")
      .map(([key, nested]) => [key, projectRemoteAgentSpaceFileWire(nested)])
  ) as T;
}

export async function withRemoteAgentSpaceFileWire<T>(
  value: Promise<T>
): Promise<T> {
  return projectRemoteAgentSpaceFileWire(await value);
}
