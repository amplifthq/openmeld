// Maps inputs with at most `maxConcurrency` mappers in flight and returns the
// results in input order. After a mapper fails, no new input starts, and the
// call settles only once every in-flight mapper has finished, so no work keeps
// running after the caller has observed the failure.
export async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  maxConcurrency: number,
  mapper: (input: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;
  let failure: { error: unknown } | null = null;
  const workerCount = Math.max(1, Math.min(maxConcurrency, inputs.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!failure) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= inputs.length) {
          return;
        }
        try {
          results[currentIndex] = await mapper(inputs[currentIndex] as TInput);
        } catch (error) {
          failure ??= { error };
        }
      }
    })
  );
  if (failure) {
    throw failure.error;
  }
  return results;
}
