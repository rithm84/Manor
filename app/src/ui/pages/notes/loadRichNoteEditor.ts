type RichNoteEditorModule = typeof import('./RichNoteEditor')

let loading: Promise<RichNoteEditorModule> | null = null

/**
 * The one dynamic import of the editor chunk. Its module graph carries a top-level `await`, and the
 * WebKit module loader that ships before Safari 27 settles a repeated `import()` of such a graph before
 * the evaluation the first request started has finished, so the second caller reads exports that are
 * still uninitialized ("Cannot access 'R' before initialization" in the Notes page). Every request for the
 * editor shares this promise, and chunks that depend on the editor load only after it has resolved. A
 * failed load is forgotten so the next request tries again.
 */
export function loadRichNoteEditor(): Promise<RichNoteEditorModule> {
  if (loading === null) {
    loading = import('./RichNoteEditor').catch((cause: unknown) => {
      loading = null
      throw cause
    })
  }
  return loading
}
