/** One bounded, retryable page. Never discard metadata before objects are gone. */
export async function purgeFileObjectPrefix(
  bucket: R2Bucket,
  prefix: string
): Promise<boolean> {
  const page = await bucket.list({ prefix, limit: 500 });
  if (page.objects.length) {
    await bucket.delete(page.objects.map((object) => object.key));
  }
  return !page.truncated;
}
