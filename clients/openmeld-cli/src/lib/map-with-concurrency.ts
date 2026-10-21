// Maps inputs with at most `maxConcurrency` mappers in flight and returns the
// results in input order.
export async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  maxConcurrency: number,
  mapper: (input: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, inputs.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= inputs.length) {
          return;
        }
        results[currentIndex] = await mapper(inputs[currentIndex] as TInput);
      }
    })
  );
  return results;
}
