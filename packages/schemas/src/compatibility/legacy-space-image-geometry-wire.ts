/** Project validated wire output only; canonical revisions retain geometry. */
export function toLegacySpaceImageGeometryWireValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(toLegacySpaceImageGeometryWireValue) as T;
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
      .map(([key, nested]) => [
        key,
        toLegacySpaceImageGeometryWireValue(nested),
      ])
  ) as T;
}
