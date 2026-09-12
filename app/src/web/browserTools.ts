import { z } from 'zod'
import type { JsonObject, JsonValue, ToolSchema } from '../../../supabase/functions/_shared/toolCatalog'
import type { NotePage, NotesApi } from '../shared/notes'
import { ManorGateway, ManorRequestError } from './ManorGateway'
import { NoteDraftStore, type ProtectedNoteDraft } from './notes/NoteDraftStore'
import { readThemePreference, setThemePreference } from './theme'
import { soundsEnabled, setSoundsEnabled } from '../ui/sound/sounds'

export interface BrowserTool {
  name: string
  description: string
  inputSchema: ToolSchema
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute(input: JsonObject): Promise<JsonValue>
}

export interface EditorSurface {
  noteId: string
  selection(): { block_ids: string[]; selected_text: string; content_json: string; focused: boolean }
  reveal(blockIds: readonly string[]): JsonValue
}

export interface NotesSurface {
  context(): { selected_note_id: string | null; scope: string; search: string; visible_note_ids: string[] }
  filter(scope: 'all' | 'favorites' | 'recent' | 'archived' | 'trash', search: string): void
}

export const moduleFilterSchema = z.discriminatedUnion('module', [
  z.object({ module: z.literal('home'), view: z.enum(['weekly', 'master']), schedule_day: z.enum(['today', 'tomorrow']) }).strict(),
  z.object({ module: z.literal('jobs'), view: z.enum(['pipeline', 'browse']) }).strict(),
  z.object({ module: z.literal('leetcode'), expanded_topics: z.array(z.string().min(1).max(200)).max(100) }).strict(),
  z.object({ module: z.literal('bookmarks'), search: z.string().max(500) }).strict()
])
export type ModuleFilter = z.infer<typeof moduleFilterSchema>
export type PresentationModule = 'home' | 'jobs' | 'leetcode' | 'bookmarks' | 'weekly-reviews'
export interface ModuleSurface {
  module: PresentationModule
  context(): { ready: boolean; selected_object_id: string | null; navigation_blocked: boolean; filters: JsonObject; presentation: 'dialog' | 'inline_expansion' }
  open(id: string): void
  filter: ((request: ModuleFilter) => void) | null
}

/** Mounted components supply authoritative UI state, rather than inferred DOM text. */
class BrowserSurfaces {
  private editor: EditorSurface | null = null
  private notes: NotesSurface | null = null
  private readonly modules = new Map<PresentationModule, ModuleSurface>()

  attachModule(surface: ModuleSurface): () => void {
    this.modules.set(surface.module, surface)
    return () => { if (this.modules.get(surface.module) === surface) this.modules.delete(surface.module) }
  }

  module(name: PresentationModule): ModuleSurface | null { return this.modules.get(name) ?? null }
  moduleContexts(): JsonObject {
    return Object.fromEntries([...this.modules].map(([name, surface]) => [name, surface.context()]))
  }

  attachEditor(surface: EditorSurface): () => void {
    this.editor = surface
    return () => { if (this.editor === surface) this.editor = null }
  }

  attachNotes(surface: NotesSurface): () => void {
    this.notes = surface
    return () => { if (this.notes === surface) this.notes = null }
  }

  currentEditor(): EditorSurface | null { return this.editor }
  currentNotes(): NotesSurface | null { return this.notes }
}

export const browserSurfaces = new BrowserSurfaces()
const empty = z.object({}).strict()
const id = z.string().min(1).max(200)
const modules = z.enum(['home', 'habits', 'mood-focus', 'leetcode', 'jobs', 'notes', 'bookmarks', 'weekly-reviews', 'settings'])
const view = z.object({ module: modules, note_id: id.optional() }).strict()
const notesFilter = z.object({ module: z.literal('notes'), scope: z.enum(['all', 'favorites', 'recent', 'archived', 'trash']), search: z.string().max(500) }).strict()

async function protectedDrafts(accountId: string): Promise<readonly ProtectedNoteDraft[]> {
  const store = await NoteDraftStore.open(indexedDB)
  try { return await store.list(accountId) }
  finally { store.close() }
}

function fieldIds(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(fieldIds)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    if ((key === 'id' || key.endsWith('_id')) && typeof child === 'string') return [child]
    if (key.endsWith('_ids') && Array.isArray(child)) return child.filter((item): item is string => typeof item === 'string')
    return fieldIds(child)
  })
}

function ancestorAffected(page: NotePage, pages: readonly NotePage[], ids: ReadonlySet<string>): boolean {
  if (ids.has(page.id) || (page.folderId !== null && ids.has(page.folderId))) return true
  const visited = new Set<string>([page.id])
  let parent = page.parentPageId
  while (parent !== null) {
    if (ids.has(parent)) return true
    if (visited.has(parent)) throw new Error(`Note hierarchy contains a cycle at ${parent}`)
    visited.add(parent)
    const ancestor = pages.find(candidate => candidate.id === parent)
    if (!ancestor) throw new Error(`Note hierarchy is missing parent ${parent}; reload before editing`)
    parent = ancestor.parentPageId
  }
  return false
}

/** Nested batch items and ancestor lifecycle changes must not bypass local protection. */
export async function assertDraftsUnaffected(operation: string, input: JsonObject, notes: NotesApi): Promise<void> {
  const drafts = await notes.pendingDrafts()
  if (drafts.length === 0) return
  const ids = new Set(fieldIds(input))
  const direct = drafts.find(draft => ids.has(draft.id))
  if (direct) throw new ManorRequestError(operation, 'UNSAVED_NOTE_CONFLICT', `Note ${direct.id} has a protected unsaved draft. Resolve its local draft before changing it.`)
  if (ids.size === 0) return
  const state = await notes.load()
  let expanded = true
  while (expanded) {
    expanded = false
    for (const folder of state.folders) {
      if (folder.parentFolderId !== null && ids.has(folder.parentFolderId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        expanded = true
      }
    }
  }
  const conflict = state.pages.find(page => drafts.some(draft => draft.id === page.id) && ancestorAffected(page, state.pages, ids))
  if (conflict) throw new ManorRequestError(operation, 'UNSAVED_NOTE_CONFLICT', `The operation affects protected draft ${conflict.id} through its note hierarchy. Resolve that draft first.`)
}

async function waitForPresentation(ready: () => boolean, operation: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (!ready()) {
    if (performance.now() >= deadline) throw new ManorRequestError(operation, 'PRESENTATION_UNAVAILABLE', 'The requested Manor surface did not become available within five seconds')
    await new Promise<void>(resolve => window.setTimeout(resolve, 25))
  }
}

function requireClosedDetail(module: PresentationModule, id: string): void {
  const current = browserSurfaces.module(module)?.context()
  if (current?.navigation_blocked && current.selected_object_id !== id) {
    throw new ManorRequestError('open_object', 'DETAIL_ALREADY_OPEN', 'Close the current detail dialog before opening another object so its pending edits are preserved')
  }
}

async function navigate(route: string): Promise<void> {
  const destination = route.split('?')[0]
  if (location.pathname !== destination) {
    for (const name of ['home', 'jobs', 'leetcode', 'weekly-reviews'] as const) {
      const current = browserSurfaces.module(name)?.context()
      if (current?.navigation_blocked) throw new ManorRequestError('open_view', 'DETAIL_ALREADY_OPEN', 'Close the current detail dialog before navigating so its pending edits are preserved')
    }
  }
  window.dispatchEvent(new CustomEvent('manor:navigate', { detail: route }))
  await waitForPresentation(() => location.pathname + location.search === route, 'open_view')
}

function appearance(): JsonObject {
  return { theme: readThemePreference(), sounds_enabled: soundsEnabled(), storage_scope: 'this_browser' }
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(',')}}`
  return JSON.stringify(value)
}

async function selection(gateway: ManorGateway): Promise<JsonObject> {
  const editor = browserSurfaces.currentEditor()
  if (!editor) return { available: false, reason: 'No editable Notes document is currently mounted' }
  const snapshot = editor.selection()
  const drafts = await protectedDrafts(gateway.accountId)
  const draft = drafts.find(candidate => candidate.noteId === editor.noteId)
  const rows = await gateway.rowsWhere('note_pages', [{ column: 'id', value: editor.noteId }])
  const committed = rows[0]
  if (!committed) throw new ManorRequestError('get_selection', 'NOTE_UNAVAILABLE', `Note ${editor.noteId} is not available to this account`)
  const revision = z.number().int().positive().parse(committed.revision)
  const localContent = canonical(z.json().parse(JSON.parse(snapshot.content_json)))
  const exactCommitted = localContent === canonical(committed.content_json ?? null)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(localContent))
  if (browserSurfaces.currentEditor() !== editor) throw new ManorRequestError('get_selection', 'SELECTION_CHANGED', 'The Notes editor changed while its revision was being read; retry the selection read')
  return { available: true, note_id: editor.noteId, block_ids: snapshot.block_ids, selected_text: snapshot.selected_text,
    focused: snapshot.focused, committed_revision: revision, selection_document: exactCommitted ? 'committed' : 'local_editor',
    protected_draft_base_revision: draft?.baseRevision ?? null, protected_draft_mutation_id: draft?.mutationId ?? null,
    revision_bound: exactCommitted, document_sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
}

export function createBrowserTools(gateway: ManorGateway, notes: NotesApi): BrowserTool[] {
  return browserToolDefinitions(() => gateway, () => notes)
}

/** Metadata can be inspected without creating an account connection or reading drafts. */
export function browserToolDescriptors(): Omit<BrowserTool, 'execute'>[] {
  const unavailable = (): never => { throw new Error('Tool execution services are unavailable during metadata inspection') }
  return browserToolDefinitions(unavailable, unavailable).map(({ execute: _execute, ...descriptor }) => descriptor)
}

function browserToolDefinitions(gateway: () => ManorGateway, notes: () => NotesApi): BrowserTool[] {
  const tool = (name: string, description: string, schema: z.ZodType, readOnly: boolean, execute: (input: JsonObject) => Promise<JsonValue>): BrowserTool => ({
    name, description, inputSchema: z.toJSONSchema(schema) as ToolSchema,
    annotations: { readOnlyHint: readOnly, untrustedContentHint: true }, execute
  })
  return [
    tool('get_browser_context', 'Read actual route, mounted Notes filters, selection and protected draft base revisions. Other modules expose only their route parameters.', empty, true, async input => {
      empty.parse(input)
      return { route: location.pathname + location.search, route_parameters: Object.fromEntries(new URLSearchParams(location.search)), online: navigator.onLine,
        notes: browserSurfaces.currentNotes()?.context() ?? null, modules: browserSurfaces.moduleContexts(), selection: await selection(gateway()),
        protected_drafts: (await protectedDrafts(gateway().accountId)).map(draft => ({ id: draft.noteId, title: draft.title, base_revision: draft.baseRevision, mutation_id: draft.mutationId })) }
    }),
    tool('get_selection', 'Read current BlockNote selection with stable block IDs, committed revision and protected local draft base revision. Local editor selections explicitly identify when they differ from the committed revision.', empty, true, async input => { empty.parse(input); return selection(gateway()) }),
    tool('read_note_draft', 'Read a protected local draft with its base revision and mutation ID. Null means no protected draft.', z.object({ id }).strict(), true, async input => {
      const request = z.object({ id }).strict().parse(input)
      const draft = (await protectedDrafts(gateway().accountId)).find(candidate => candidate.noteId === request.id)
      return draft ? { id: draft.noteId, title: draft.title, content_json: z.json().parse(JSON.parse(draft.contentJson)), base_revision: draft.baseRevision, mutation_id: draft.mutationId, state: 'protected_locally' } : null
    }),
    tool('open_view', 'Open a live Manor module or Notes page and verify the route changed.', view, false, async input => {
      const request = view.parse(input)
      if (request.note_id && request.module !== 'notes') throw new TypeError('note_id requires the notes module')
      if (request.note_id && !(await notes().load()).pages.some(page => page.id === request.note_id)) throw new ManorRequestError('open_view', 'NOTE_UNAVAILABLE', 'The requested note does not exist in this account')
      const route = `/${request.module}${request.note_id ? `?note=${encodeURIComponent(request.note_id)}` : ''}`
      await navigate(route)
      if (request.note_id) await waitForPresentation(() => browserSurfaces.currentNotes()?.context().selected_note_id === request.note_id, 'open_view')
      return { route, opened: true }
    }),
    tool('open_object', 'Open an account-owned task (home), application (jobs), problem (leetcode), review, note, or expandable bookmark through its existing UI handler. Bookmark details are inline; entries without expandable detail fail explicitly.', z.object({ module: z.enum(['notes', 'home', 'jobs', 'leetcode', 'bookmarks', 'weekly-reviews']), id }).strict(), false, async (input): Promise<JsonValue> => {
      const request = z.object({ module: z.enum(['notes', 'home', 'jobs', 'leetcode', 'bookmarks', 'weekly-reviews']), id }).strict().parse(input)
      if (request.module === 'notes') {
        if (!(await notes().load()).pages.some(page => page.id === request.id)) throw new ManorRequestError('open_object', 'NOTE_UNAVAILABLE', 'The requested note does not exist in this account')
        const route = `/notes?note=${encodeURIComponent(request.id)}`
        await navigate(route)
        await waitForPresentation(() => browserSurfaces.currentNotes()?.context().selected_note_id === request.id, 'open_object')
        return { route, opened: true, note_id: request.id }
      }
      const module = request.module
      requireClosedDetail(module, request.id)
      if (location.pathname !== `/${module}`) await navigate(`/${module}`)
      await waitForPresentation(() => browserSurfaces.module(module)?.context().ready === true, 'open_object')
      const surface = browserSurfaces.module(module)
      if (!surface) throw new ManorRequestError('open_object', 'PRESENTATION_UNAVAILABLE', 'The module closed before the object could be opened')
      requireClosedDetail(module, request.id)
      surface.open(request.id)
      await waitForPresentation(() => browserSurfaces.module(module)?.context().selected_object_id === request.id, 'open_object')
      return { route: location.pathname + location.search, opened: true, id: request.id, presentation: surface.context().presentation }
    }),
    tool('show_filtered_view', 'Apply existing view controls: Notes scope/search, Home weekly/master and schedule day, Jobs pipeline/browse, LeetCode expanded topic names, or Bookmarks search. Other filter combinations are unsupported.', z.union([notesFilter, moduleFilterSchema]), false, async input => {
      const request = z.union([notesFilter, moduleFilterSchema]).parse(input)
      if (request.module === 'notes') {
        if (location.pathname !== '/notes') await navigate('/notes')
        await waitForPresentation(() => browserSurfaces.currentNotes() !== null, 'show_filtered_view')
        const surface = browserSurfaces.currentNotes()
        if (!surface) throw new ManorRequestError('show_filtered_view', 'PRESENTATION_UNAVAILABLE', 'Notes closed before filters could be applied')
        surface.filter(request.scope, request.search)
        await waitForPresentation(() => { const current = browserSurfaces.currentNotes()?.context(); return current?.scope === request.scope && current.search === request.search }, 'show_filtered_view')
        return browserSurfaces.currentNotes()?.context() ?? null
      }
      const module = request.module
      if (location.pathname !== `/${module}`) await navigate(`/${module}`)
      await waitForPresentation(() => browserSurfaces.module(module)?.context().ready === true, 'show_filtered_view')
      const surface = browserSurfaces.module(module)
      if (!surface?.filter) throw new ManorRequestError('show_filtered_view', 'FILTER_UNAVAILABLE', 'This module does not expose the requested view controls')
      surface.filter(request)
      const expected = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'module'))
      await waitForPresentation(() => {
        const current = browserSurfaces.module(module)?.context().filters
        return current !== undefined && Object.entries(expected).every(([key, value]) => canonical(current[key] ?? null) === canonical(value))
      }, 'show_filtered_view')
      return browserSurfaces.module(module)?.context() ?? null
    }),
    tool('reveal_blocks', 'Highlight validated blocks in the current editor without moving the caret or scroll position. Offscreen blocks remain offscreen; returned bounds describe their position.', z.object({ note_id: id, block_ids: z.array(id).min(1).max(50), expected_revision: z.number().int().positive() }).strict(), false, async input => {
      const request = z.object({ note_id: id, block_ids: z.array(id).min(1).max(50), expected_revision: z.number().int().positive() }).strict().parse(input)
      const current = await selection(gateway())
      if (current.note_id !== request.note_id || current.revision_bound !== true || current.committed_revision !== request.expected_revision) throw new ManorRequestError('reveal_blocks', 'SELECTION_REVISION_CONFLICT', 'Open the requested committed note revision before revealing blocks; local edits must be saved first')
      const editor = browserSurfaces.currentEditor()
      if (!editor || editor.noteId !== request.note_id) throw new ManorRequestError('reveal_blocks', 'PRESENTATION_UNAVAILABLE', 'The requested editor is not mounted')
      return editor.reveal(request.block_ids)
    }),
    tool('get_appearance_preferences', 'Read theme and completion sounds stored in this browser. These are not remote account preferences.', empty, true, async input => { empty.parse(input); return appearance() }),
    tool('update_appearance_preferences', 'Update explicitly supplied theme or completion sounds in this browser.', z.object({ theme: z.enum(['system', 'light', 'dark']).optional(), sounds_enabled: z.boolean().optional() }).strict(), false, async input => {
      const request = z.object({ theme: z.enum(['system', 'light', 'dark']).optional(), sounds_enabled: z.boolean().optional() }).strict().parse(input)
      if (request.theme === undefined && request.sounds_enabled === undefined) throw new TypeError('Supply theme or sounds_enabled')
      if (request.theme !== undefined) setThemePreference(request.theme)
      if (request.sounds_enabled !== undefined) setSoundsEnabled(request.sounds_enabled)
      window.dispatchEvent(new CustomEvent('manor:appearance-changed'))
      return appearance()
    })
  ]
}
