/**
 * Run asynchronous work with a hard concurrency ceiling while preserving the
 * input order. A rejected item stops the batch and rejects the caller.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return [];
  const limit = Math.max(1, Math.min(values.length, Math.floor(concurrency) || 1));
  const results = new Array<R>(values.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await worker(values[index], index);
      }
    })
  );
  return results;
}
