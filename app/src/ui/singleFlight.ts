/**
 * Wraps a chunk import so every caller shares one request. Two overlapping requests for the same chunk
 * misbehave in two ways: Vite's preload helper waits for the chunk's stylesheets only on the first request
 * and returns at once for a later one, so the second caller can render before the styles have applied
 * (the editor toolbar drawn as bare boxes); and the WebKit module loader before Safari 27 settles a repeated
 * `import()` of a graph with a top-level `await` before the first evaluation has finished, so the second
 * caller reads exports that are still uninitialized. One shared promise avoids both. A failed load is
 * forgotten so the next request tries again.
 */
export function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return (): Promise<T> => {
    if (pending === null) {
      pending = load().catch((cause: unknown) => {
        pending = null
        throw cause
      })
    }
    return pending
  }
}
