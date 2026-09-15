import { useManorService } from '../services/ManorServices'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Library,
  Move,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { parseNoteContentJson } from '../../shared/notes'
import type { NoteFolder, NotePage, NotesState } from '../../shared/notes'
import { hasOpenDismissLayer, useDismissLayer } from '../components/ui/dismissLayer'
import { Toast } from '../components/ui/Toast'
import { PageShell } from './PageShell'
import { importedNoteTitle, pagesForScope, scopeTitle, treeRows } from './notes/notesModel'
import type { NotesScope } from './notes/notesModel'
import { createNoteSaveQueue } from './notes/notesAutosave'
import { FolderDialog, MoveDialog, PurgeDialog } from './notes/NotesDialogs'
import { NotesList } from './notes/NotesList'
import { EMPTY_SELECTION, pruneSelection, selectOne } from './notes/notesSelection'
import type { NoteSelection } from './notes/notesSelection'
import type { RichNoteEditorHandle } from './notes/RichNoteEditor'
import { loadRichNoteEditor } from './notes/loadRichNoteEditor'
import { NoteFindBar } from './notes/NoteFindBar'
import { NotesPaneToggle } from './notes/NotesPaneToggle'
import { useNotesPaneVisibility } from './notes/useNotesPaneVisibility'
import './notes/notes.css'

const NoteReviewDialog = lazy(async () => {
  await loadRichNoteEditor()
  const module = await import('./notes/NoteReviewDialog')
  return { default: module.NoteReviewDialog }
})

const NoteReadOnlyPreview = lazy(async () => {
  await loadRichNoteEditor()
  const module = await import('./notes/NoteReadOnlyPreview')
  return { default: module.NoteReadOnlyPreview }
})

const RichNoteEditor = lazy(async () => {
  const module = await loadRichNoteEditor()
  return { default: module.RichNoteEditor }
})

type SaveState = 'saved' | 'unsaved' | 'protecting' | 'protected' | 'unprotected' | 'saving' | 'error'

interface NoteDraft {
  id: string
  title: string
  contentJson: string
}

type DialogState =
  | { kind: 'folder'; folder: NoteFolder | null }
  | { kind: 'move'; page: NotePage }
  | null

const EMPTY_CONTENT = JSON.stringify([{ type: 'paragraph', content: [], children: [] }])

/** How long the syncing label stays up once it appears, so a save that lands in
    a few frames reads as a save rather than a flicker. */
const SYNCING_HOLD_MS = 450

function newestCreatedPage(previousIds: ReadonlySet<string>, state: NotesState): NotePage {
  const created = state.pages.find((page) => !previousIds.has(page.id))
  if (created === undefined) throw new Error('The note was created but could not be found')
  return created
}

function activeFolderForScope(scope: NotesScope): string | null {
  return scope.startsWith('folder:') ? scope.slice(7) : null
}

function scopeForPage(page: NotePage): NotesScope {
  if (page.status === 'archived') return 'archived'
  if (page.status === 'trash') return 'trash'
  return page.folderId === null ? 'all' : `folder:${page.folderId}`
}

function SidebarButton({ active, icon, label, count, onClick }: {
  active: boolean
  icon: ReactNode
  label: string
  count: number
  onClick: () => void
}): ReactNode {
  return (
    <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} className={`notes-nav-row${active ? ' is-selected' : ''}`} onClick={onClick}>
      {icon}<span>{label}</span>{count > 0 ? <span className="notes-nav-count">{count}</span> : null}
    </button>
  )
}

function EmptyEditor({ scope, listEmpty }: { scope: NotesScope; listEmpty: boolean }): ReactNode {
  const trash = scope === 'trash'
  return (
    <div className="notes-empty-editor">
      <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
      <h2>{trash && listEmpty ? 'Trash is empty' : 'Select a note'}</h2>
      <p>{trash ? (listEmpty ? 'Deleted notes appear here.' : 'Choose a note to read it, restore it, or delete it permanently.') : 'Choose a note or create a new one.'}</p>
    </div>
  )
}

/** Local-first, block-based notes workspace. */
export function NotesPage(): ReactNode {
  const notesApi = useManorService('notes')
  const { navigationCollapsed, listCollapsed, setNavigationCollapsed, setListCollapsed } = useNotesPaneVisibility()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedNoteIdRef = useRef(searchParams.get('note'))
  const attemptedRouteRef = useRef<string | null>(null)
  const pendingRouteRef = useRef<string | null | undefined>(undefined)
  const [data, setData] = useState<NotesState>({ folders: [], pages: [] })
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<NotesScope>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [writerReady, setWriterReady] = useState(false)
  const [writerError, setWriterError] = useState<string | null>(null)
  const [writerAttempt, setWriterAttempt] = useState(0)
  const protectionRef = useRef<Promise<void>>(Promise.resolve())
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [shownSaveState, setShownSaveState] = useState<SaveState>('saved')
  const syncingSinceRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deferredNoteIds, setDeferredNoteIds] = useState<readonly string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [reviewMode, setReviewMode] = useState<'versions' | 'suggestions' | 'conflict' | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [selection, setSelection] = useState<NoteSelection>(EMPTY_SELECTION)
  const [purgeRequest, setPurgeRequest] = useState<readonly string[] | null>(null)
  const [toast, setToast] = useState<{ message: string; action: { label: string; onSelect: () => void } | null } | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])
  const editorHandleRef = useRef<RichNoteEditorHandle | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingTitleFocusRef = useRef(false)
  const importRef = useRef<HTMLInputElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [exportedFlash, setExportedFlash] = useState(false)
  const exportTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<NoteDraft | null>(null)
  const draftRef = useRef<NoteDraft | null>(null)
  const saveQueue = useMemo(
    () => createNoteSaveQueue(
      notesApi,
      () => pendingRef.current,
      (confirmed) => {
        if (pendingRef.current === confirmed) pendingRef.current = null
      },
      () => protectionRef.current
    ),
    [notesApi]
  )

  const selectNoteRoute = useCallback((pageId: string | null): void => {
    pendingRouteRef.current = pageId
    setSelectedId(pageId)
    setSearchParams(pageId === null ? {} : { note: pageId }, { replace: true })
  }, [setSearchParams])

  const selectedPage = useMemo(
    () => data.pages.find((page) => page.id === selectedId) ?? null,
    [data.pages, selectedId]
  )
  const scopedPages = useMemo(
    () => pagesForScope(data.pages, scope, query),
    [data.pages, query, scope]
  )
  const rows = useMemo(() => treeRows(scopedPages), [scopedPages])
  useEffect(() => { setSelection((current) => pruneSelection(current, rows.map((row) => row.page.id))) }, [rows])



  const runPendingSave = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current === null) return true
    setSaveState('saving')
    let protectedLocally = false
    try {
      protectionRef.current = protectionRef.current.catch(async () => {
        const current = pendingRef.current
        if (current !== null) await notesApi.protectDraft(current)
      })
      await protectionRef.current
      protectedLocally = true
      if (!navigator.onLine) { setSaveState('protected'); return true }
      // Only flush the note being edited here. Other protected drafts may
      // legitimately belong to another open tab and must not block routing.
      const savedPages = await saveQueue()
      const savedById = new Map(savedPages.map((saved) => [saved.id, saved] as const))
      // A save that merged foreign block changes hands them to the open editor as block ops, so the cursor stays put.
      for (const saved of savedPages) {
        const ops = notesApi.takeMergedBlockOps(saved.id)
        const current = draftRef.current
        const editor = editorHandleRef.current
        if (ops.length === 0 || current === null || current.id !== saved.id || editor === null) continue
        draftRef.current = { ...current, contentJson: editor.applyBlockOps(ops) }
        setDraft(draftRef.current)
      }
      setDeferredNoteIds((current) => current.filter((id) => !savedById.has(id)))
      setData((current) => ({
        ...current,
        pages: current.pages.map((page) => savedById.get(page.id) ?? page)
      }))
      setSaveState(pendingRef.current === null ? 'saved' : 'unsaved')
      setError(null)
      return true
    } catch (saveError) {
      setSaveState(protectedLocally ? 'error' : 'unprotected')
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    }
  }, [notesApi, saveQueue])

  const savePending = runPendingSave

  const queueSave = useCallback((next: NoteDraft): void => {
    setDraft(next)
    draftRef.current = next
    pendingRef.current = next
    setSaveState('protecting')
    const protection = protectionRef.current.then(() => notesApi.protectDraft(next))
    protectionRef.current = protection
    void protection.then(() => {
      if (pendingRef.current === next) setSaveState('protected')
    }, (failure: unknown) => {
      setSaveState('unprotected')
      setError(failure instanceof Error ? failure.message : String(failure))
    })
    setData((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === next.id
        ? { ...page, title: next.title, contentJson: next.contentJson }
        : page)
    }))
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void savePending(), 650)
  }, [notesApi, savePending])

  const prepareNavigation = useCallback(async (): Promise<boolean> => {
    if (pendingRef.current === null) return true
    if (saveState !== 'error' && await savePending()) return true
    try {
      await protectionRef.current
      const pending = pendingRef.current
      if (pending === null) return true
      const protectedDraft = (await notesApi.pendingDrafts()).find((item) => item.id === pending.id)
      if (protectedDraft?.title !== pending.title || protectedDraft.contentJson !== pending.contentJson) {
        throw new Error('Your latest edit is not saved on this device. Retry saving before leaving this note.')
      }
      setDeferredNoteIds((current) => current.includes(pending.id) ? current : [...current, pending.id])
      pendingRef.current = null
      setError(null)
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    }
  }, [notesApi, savePending, saveState])

  const openPage = useCallback(async (pageId: string): Promise<void> => {
    if (!(await prepareNavigation())) return
    pendingRef.current = null
    selectNoteRoute(pageId)
    setSelection(selectOne(pageId))
    setMenuOpen(false)
    try {
      const touched = await notesApi.touchPage(pageId)
      setData((current) => ({
        ...current,
        pages: current.pages.map((page) => page.id === touched.id ? touched : page)
      }))
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    }
  }, [prepareNavigation, selectNoteRoute])

  useEffect(() => {
    let active = true
    notesApi.load()
      .then((state) => {
        if (!active) return
        setData(state)
        const requested = requestedNoteIdRef.current === null
          ? null
          : state.pages.find((page) => page.id === requestedNoteIdRef.current) ?? null
        const initial = requested
          ?? state.pages.find((page) => page.status === 'active')
          ?? null
        if (requested !== null) setScope(scopeForPage(requested))
        setSelectedId(initial?.id ?? null)
        setSearchParams(initial === null ? {} : { note: initial.id }, { replace: true })
        setLoading(false)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setLoading(false)
      })
    return (): void => {
      active = false
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [notesApi])

  useEffect(() => {
    let active = true
    let sequence = 0
    const refresh = (event: Event): void => {
      const operation = (event as CustomEvent<{ operation?: string }>).detail?.operation
      if (operation !== undefined && operation !== 'remote_change' && !operation.includes('note')) return
      const request = ++sequence
      void protectionRef.current.then(() => notesApi.load()).then((state) => {
        if (!active || request !== sequence) return
        setData((current) => {
          const pending = pendingRef.current
          if (pending === null) return state
          const pages = state.pages.map((page) => page.id === pending.id ? { ...page, title: pending.title, contentJson: pending.contentJson } : page)
          if (!pages.some((page) => page.id === pending.id)) {
            const local = current.pages.find((page) => page.id === pending.id)
            if (local !== undefined) pages.push({ ...local, title: pending.title, contentJson: pending.contentJson })
          }
          return { ...state, pages }
        })
      }).catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
    }
    window.addEventListener('manor:committed', refresh)
    return () => { active = false; window.removeEventListener('manor:committed', refresh) }
  }, [notesApi])

  useEffect(() => {
    const requestedId = searchParams.get('note')
    // A URL update and its React state update can render separately. Ignore
    // the previous URL until the explicit navigation reaches the router.
    if (pendingRouteRef.current !== undefined) {
      if (requestedId !== pendingRouteRef.current) return
      pendingRouteRef.current = undefined
    }
    if (loading || requestedId === null) return
    if (requestedId === selectedId) { attemptedRouteRef.current = null; return }
    if (attemptedRouteRef.current === requestedId) return
    attemptedRouteRef.current = requestedId
    const requested = data.pages.find((page) => page.id === requestedId)
    if (requested === undefined) {
      setError('This note is not available in your account.')
      return
    }
    setScope(scopeForPage(requested))
    void openPage(requestedId)
  }, [searchParams, loading, selectedId, data.pages, openPage])

  useEffect(() => {
    if (selectedId === null) { setWriterReady(false); return }
    let active = true
    let release: (() => void) | null = null
    setWriterReady(false)
    setWriterError(null)
    void notesApi.acquireWriter(selectedId).then(async (unlock) => {
      if (!active) { unlock(); return }
      release = unlock
      const recovered = (await notesApi.pendingDrafts()).find((item) => item.id === selectedId)
      if (!active) return
      if (recovered !== undefined) {
        pendingRef.current = recovered
        draftRef.current = recovered
        setDraft(recovered)
        setSaveState('protected')
      }
      setWriterReady(true)
      if (recovered !== undefined && navigator.onLine) void savePending()
    }).catch((failure: unknown) => { if (active) setWriterError(failure instanceof Error ? failure.message : String(failure)) })
    return () => {
      active = false
      const unlock = release
      if (unlock !== null) void protectionRef.current.then(unlock, unlock)
    }
  }, [notesApi, savePending, selectedId, writerAttempt])

  useEffect(() => {
    const retry = (): void => { if (pendingRef.current !== null) void savePending() }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [savePending])

  useEffect(() => {
    const onBeforeUpdate = (event: Event): void => {
      if (pendingRef.current !== null && (saveState === 'protecting' || saveState === 'unprotected')) event.preventDefault()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (pendingRef.current !== null && (saveState === 'protecting' || saveState === 'unprotected')) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('manor:before-update', onBeforeUpdate)
    return (): void => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('manor:before-update', onBeforeUpdate)
    }
  }, [notesApi, saveState])

  /** Holds the syncing label for a beat once it appears; every other state
      shows the moment it arrives. */
  useEffect(() => {
    if (saveState === 'saving') {
      syncingSinceRef.current = Date.now()
      setShownSaveState('saving')
      return
    }
    const since = syncingSinceRef.current
    const remaining = since === null ? 0 : SYNCING_HOLD_MS - (Date.now() - since)
    if (remaining <= 0) {
      syncingSinceRef.current = null
      setShownSaveState(saveState)
      return
    }
    const timer = window.setTimeout(() => {
      syncingSinceRef.current = null
      setShownSaveState(saveState)
    }, remaining)
    return (): void => window.clearTimeout(timer)
  }, [saveState])

  useEffect(() => {
    if (selectedPage === null) {
      setDraft(null)
      draftRef.current = null
      return
    }
    if (pendingRef.current?.id === selectedPage.id) return
    const nextDraft = { id: selectedPage.id, title: selectedPage.title, contentJson: selectedPage.contentJson }
    setDraft(nextDraft)
    draftRef.current = nextDraft
    setSaveState('saved')
  }, [selectedPage])

  useEffect(() => {
    const onOpenMention = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      void openPage(event.detail)
    }
    window.addEventListener('manor:open-note', onOpenMention)
    return (): void => window.removeEventListener('manor:open-note', onOpenMention)
  }, [openPage])

  useDismissLayer(menuOpen, () => {
    setMenuOpen(false)
    menuTriggerRef.current?.focus()
  })

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    return (): void => {
      document.removeEventListener('pointerdown', closeOnPointer)
    }
  }, [menuOpen])

  const createPage = useCallback(async (parentPageId: string | null): Promise<void> => {
    if (!(await prepareNavigation())) return
    try {
      const previousIds = new Set(data.pages.map((page) => page.id))
      const parent = parentPageId === null
        ? null
        : data.pages.find((page) => page.id === parentPageId) ?? null
      const state = await notesApi.createPage({
        title: 'Untitled',
        folderId: parent?.folderId ?? activeFolderForScope(scope),
        parentPageId,
        contentJson: EMPTY_CONTENT
      })
      setData(state)
      setError(null)
      const created = newestCreatedPage(previousIds, state)
      pendingTitleFocusRef.current = true
      selectNoteRoute(created.id)
      setScope(created.folderId === null ? 'all' : `folder:${created.folderId}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    }
  }, [data.pages, prepareNavigation, scope, selectNoteRoute])

  // A freshly created page gets its title focused once the editor renders.
  useEffect(() => {
    if (!pendingTitleFocusRef.current) return
    if (draft === null || selectedPage === null || draft.id !== selectedPage.id) return
    pendingTitleFocusRef.current = false
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [draft, selectedPage])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      // Leave the shortcuts alone while any modal, menu, or dialog is up.
      if (hasOpenDismissLayer() || document.querySelector('.ui-overlay') !== null) return
      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey && selectedId !== null) {
        event.preventDefault()
        void savePending()
      }
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        void createPage(null)
      }
      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        setNavigationCollapsed(false)
        setListCollapsed(false)
        window.requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [createPage, savePending, selectedId, setNavigationCollapsed, setListCollapsed])

  const replaceState = (promise: Promise<NotesState>): Promise<NotesState | null> =>
    promise.then((state) => {
      setData(state)
      setError(null)
      return state
    }).catch((actionError: unknown) => {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
      return null
    })

  const selectScope = async (nextScope: NotesScope): Promise<void> => {
    if (!(await prepareNavigation())) return
    setListCollapsed(false)
    setScope(nextScope)
    setQuery('')
    selectNoteRoute(null)
    setMenuOpen(false)
  }

  const mutateSelected = async (action: () => Promise<NotesState>): Promise<void> => {
    if (!(await savePending())) return
    await replaceState(action())
    selectNoteRoute(null)
    setMenuOpen(false)
  }

  /** The ids plus every page nested under them, which the server moves with them. */
  const withDescendants = (pageIds: readonly string[]): ReadonlySet<string> => {
    const ids = new Set(pageIds)
    for (let grew = true; grew;) {
      grew = false
      for (const page of data.pages) if (page.parentPageId !== null && ids.has(page.parentPageId) && !ids.has(page.id)) { ids.add(page.id); grew = true }
    }
    return ids
  }

  /** Applies a lifecycle change to the list at once, runs it, and puts the previous list back if it fails. */
  const moveOptimistically = async (pageIds: readonly string[], apply: (page: NotePage) => NotePage | null, run: () => Promise<NotesState>): Promise<NotesState | null> => {
    const affected = withDescendants(pageIds)
    const before = data.pages
    setData((current) => ({ ...current, pages: current.pages.flatMap((page) => { if (!affected.has(page.id)) return [page]; const next = apply(page); return next === null ? [] : [next] }) }))
    const state = await replaceState(run())
    if (state === null) setData((current) => ({ ...current, pages: before }))
    return state
  }

  /** Lifecycle moves are batch operations with a toast; a move to Trash is reversible from the toast while it shows. */
  const trashPages = async (pageIds: readonly string[]): Promise<void> => {
    if (!(await savePending())) return
    const now = new Date().toISOString()
    const state = await moveOptimistically(pageIds, (page) => ({ ...page, status: 'trash', deletedAt: now }), () => notesApi.trashPages(pageIds))
    setMenuOpen(false)
    if (state === null) return
    if (selectedId !== null && pageIds.includes(selectedId)) selectNoteRoute(null)
    setToast({ message: pageIds.length === 1 ? 'Note moved to Trash' : `${pageIds.length} notes moved to Trash`, action: { label: 'Undo', onSelect: () => { setToast(null); void restorePages(pageIds) } } })
  }

  /** Restore follows the open note back to its live scope. */
  const restorePages = async (pageIds: readonly string[]): Promise<void> => {
    if (!(await savePending())) return
    const state = await moveOptimistically(pageIds, (page) => ({ ...page, status: 'active', deletedAt: null, archivedAt: null }), () => notesApi.restorePages(pageIds))
    setMenuOpen(false)
    if (state === null) return
    const restored = selectedId === null ? undefined : state.pages.find((page) => page.id === selectedId && pageIds.includes(page.id))
    if (restored !== undefined) setScope(scopeForPage(restored))
    setToast({ message: pageIds.length === 1 ? 'Note restored' : `${pageIds.length} notes restored`, action: null })
  }

  const purgePages = async (pageIds: readonly string[]): Promise<void> => {
    if (!(await savePending())) return
    setPurgeRequest(null)
    const state = await moveOptimistically(pageIds, () => null, () => notesApi.purgePages(pageIds))
    setMenuOpen(false)
    if (state === null) return
    if (selectedId !== null && pageIds.includes(selectedId)) selectNoteRoute(null)
    setToast({ message: pageIds.length === 1 ? 'Note deleted permanently' : `${pageIds.length} notes deleted permanently`, action: null })
  }

  const duplicateSelected = async (pageId: string): Promise<void> => {
    if (!(await savePending())) return
    setMenuOpen(false)
    const previousIds = new Set(data.pages.map((page) => page.id))
    const state = await replaceState(notesApi.duplicatePage(pageId))
    if (state === null) return
    try {
      selectNoteRoute(newestCreatedPage(previousIds, state).id)
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError))
    }
  }

  const exportMarkdown = async (): Promise<void> => {
    if (selectedPage === null) return
    const contentJson = draft?.id === selectedPage.id ? draft.contentJson : selectedPage.contentJson
    if (!(await savePending())) return
    setMenuOpen(false)
    try {
      const module = await loadRichNoteEditor()
      const markdown = module.contentJsonToMarkdown(contentJson)
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
      anchor.download = `${selectedPage.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'note'}.md`
      anchor.hidden = true
      document.body.append(anchor)
      anchor.click()
      window.setTimeout(() => {
        URL.revokeObjectURL(anchor.href)
        anchor.remove()
      }, 1_000)
      setExportNotice('Markdown turns columns and tabs into sections. Image crops and some formatting are not preserved. Export a native document to keep the full structure.')
      setExportedFlash(true)
      if (exportTimerRef.current !== null) window.clearTimeout(exportTimerRef.current)
      exportTimerRef.current = window.setTimeout(() => setExportedFlash(false), 2_000)
    } catch (exportError) {
      setError(`Export failed: ${exportError instanceof Error ? exportError.message : String(exportError)}`)
    }
  }

  const exportNative = (): void => {
    if (selectedPage === null) return
    const contentJson = draft?.id === selectedPage.id ? draft.contentJson : selectedPage.contentJson
    const file = JSON.stringify({ format: 'manor-note', version: 1, title: draft?.title || selectedPage.title, content: JSON.parse(contentJson) }, null, 2)
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }))
    anchor.download = `${selectedPage.title.replace(/[^a-z0-9]+/gi, '-') || 'note'}.manor.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
    setMenuOpen(false)
    setExportNotice('Native document exported with its full block structure.')
  }

  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    if (!(await savePending())) return
    const previousIds = new Set(data.pages.map((page) => page.id))
    const folderId = activeFolderForScope(scope)
    const failures: string[] = []
    let lastState: NotesState | null = null
    let module: typeof import('./notes/RichNoteEditor')
    try {
      module = await loadRichNoteEditor()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      return
    }
    for (const file of files) {
      try {
        const source = await file.text()
        let title = importedNoteTitle(file.name)
        let contentJson: string
        if (file.name.endsWith('.json')) {
          const native: unknown = JSON.parse(source)
          if (typeof native !== 'object' || native === null || !('format' in native) || native.format !== 'manor-note' || !('version' in native) || native.version !== 1 || !('title' in native) || typeof native.title !== 'string' || !('content' in native)) throw new TypeError('Choose a Manor native document or a Markdown file')
          title = native.title
          contentJson = parseNoteContentJson(JSON.stringify(native.content))
        } else contentJson = module.markdownToContentJson(source)
        lastState = await notesApi.createPage({
          title,
          folderId,
          parentPageId: null,
          contentJson
        })
      } catch (fileError) {
        failures.push(`${file.name}: ${fileError instanceof Error ? fileError.message : String(fileError)}`)
      }
    }
    if (lastState !== null) {
      setData(lastState)
      try {
        selectNoteRoute(newestCreatedPage(previousIds, lastState).id)
      } catch (selectionError) {
        failures.push(selectionError instanceof Error ? selectionError.message : String(selectionError))
      }
    }
    setError(
      failures.length === 0
        ? null
        : `Could not import ${failures.length} of ${files.length} file${files.length === 1 ? '' : 's'}. ${failures.join('; ')}`
    )
  }

  useEffect(() => (): void => {
    if (exportTimerRef.current !== null) window.clearTimeout(exportTimerRef.current)
  }, [])

  /* Cmd+F opens find-in-note even while typing in the editor, which the
     shortcut handler above deliberately ignores editable targets for. */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'f') return
      if (selectedId === null) return
      if (hasOpenDismissLayer() || document.querySelector('.ui-overlay') !== null) return
      event.preventDefault()
      setFindOpen(true)
      document.querySelector<HTMLInputElement>('.notes-find-bar input')?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  /** Favorites flush the pending draft first so the list row never shows stale data. */
  const toggleFavorite = async (page: NotePage): Promise<void> => {
    if (!(await savePending())) return
    await moveOptimistically([page.id], (candidate) => candidate.id === page.id ? { ...candidate, favorite: !page.favorite } : candidate, () => notesApi.setFavorite({ id: page.id, favorite: !page.favorite }))
  }

  const updateEditorContent = useCallback((contentJson: string): void => {
    const current = draftRef.current
    if (current !== null) queueSave({ ...current, contentJson })
  }, [queueSave])

  const moveEditorBlocks = useCallback(async (blockIds: readonly string[], targetNoteId: string): Promise<void> => {
    if (selectedId === null) throw new Error('Open a note before moving blocks')
    if (!(await savePending())) throw new Error('Sync your changes before moving blocks')
    setData(await notesApi.moveBlocks({ sourceNoteId: selectedId, targetNoteId, blockIds }))
  }, [notesApi, savePending, selectedId])

  const activeCount = data.pages.filter((page) => page.status === 'active').length
  const favoriteCount = data.pages.filter((page) => page.status === 'active' && page.favorite).length
  const archivedCount = data.pages.filter((page) => page.status === 'archived').length
  const trashCount = data.pages.filter((page) => page.status === 'trash').length
  const folderName = selectedPage?.folderId === null
    ? 'Notes'
    : data.folders.find((folder) => folder.id === selectedPage?.folderId)?.name ?? 'Notes'

  return (
    <PageShell title="Notes" fullBleed={true}>
      <div className="notes-workspace" data-navigation-collapsed={navigationCollapsed} data-list-collapsed={listCollapsed}>
        <nav id="notes-navigation" className={`notes-nav${navigationCollapsed ? ' is-collapsed' : ''}`} aria-label="Notes navigation">
          <div className="notes-nav-head">
            <strong>Notes</strong>
            <div className="notes-pane-actions">
              {!navigationCollapsed ? <button type="button" className="notes-icon-button" aria-label="New note" onClick={() => void createPage(null)}><FilePlus2 size={16} /></button> : null}
              <NotesPaneToggle collapsed={navigationCollapsed} panelId="notes-navigation" label="Notes navigation" onToggle={() => setNavigationCollapsed(!navigationCollapsed)} />
            </div>
          </div>
          <div className="notes-search-wrap">
            <Search size={15} aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query !== '') { event.preventDefault(); setQuery('') } }} placeholder="Search notes" aria-label="Search notes" />
            {query !== '' ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>⌘⇧F</kbd>}
          </div>
          <div className="notes-nav-scroll">
            <SidebarButton active={scope === 'all'} icon={<Library size={15} />} label="All notes" count={activeCount} onClick={() => void selectScope('all')} />
            <SidebarButton active={scope === 'favorites'} icon={<Star size={15} />} label="Favorites" count={favoriteCount} onClick={() => void selectScope('favorites')} />
            <SidebarButton active={scope === 'recent'} icon={<Clock3 size={15} />} label="Recent" count={0} onClick={() => void selectScope('recent')} />
            <SidebarButton active={scope === 'archived'} icon={<Archive size={15} />} label="Archived" count={archivedCount} onClick={() => void selectScope('archived')} />
            <SidebarButton active={scope === 'trash'} icon={<Trash2 size={15} />} label="Trash" count={trashCount} onClick={() => void selectScope('trash')} />
            <div className="notes-folder-heading"><span>Folders</span><button type="button" className="notes-icon-button" aria-label="New folder" onClick={() => setDialog({ kind: 'folder', folder: null })}><FolderPlus size={15} /></button></div>
            {data.folders.map((folderItem) => {
              const folderScope = `folder:${folderItem.id}` as const
              return (
                <div className="notes-folder-row" key={folderItem.id}>
                  <button type="button" className={`notes-nav-row${scope === folderScope ? ' is-selected' : ''}`} onClick={() => void selectScope(folderScope)}>
                    <Folder size={15} /><span>{folderItem.name}</span><span className="notes-nav-count">{data.pages.filter((page) => page.folderId === folderItem.id && page.status === 'active').length}</span>
                  </button>
                  <button type="button" className="notes-folder-edit" aria-label={`Rename ${folderItem.name}`} onClick={() => setDialog({ kind: 'folder', folder: folderItem })}><Pencil size={13} /></button>
                </div>
              )
            })}
          </div>
          <div className="notes-nav-foot">
            <button type="button" onClick={() => void notesApi.syncDrafts().then((pages) => {
              setData((current) => ({ ...current, pages: current.pages.map((page) => pages.find((saved) => saved.id === page.id) ?? page) }))
              setDeferredNoteIds((current) => current.filter((id) => !pages.some((page) => page.id === id)))
              setError(null)
            }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))}><RefreshCw size={14} />Sync changes</button>
            <button type="button" onClick={() => importRef.current?.click()}><Upload size={14} /> Import notes</button>
            <input ref={importRef} type="file" accept=".md,.markdown,.json,text/markdown,application/json" multiple onChange={(event) => void importMarkdown(event)} hidden />
          </div>
        </nav>

        <NotesList rows={rows} title={scopeTitle(scope, data.folders)} loading={loading} collapsed={listCollapsed} onToggleCollapsed={() => setListCollapsed(!listCollapsed)}
          canCreate={scope !== 'trash' && scope !== 'archived'} onCreate={() => void createPage(null)} openId={selectedId} selection={selection} onSelectionChange={setSelection}
          onOpen={(pageId) => void openPage(pageId)} onTrash={(ids) => void trashPages(ids)} onRestore={(ids) => void restorePages(ids)} onPurge={setPurgeRequest}
          onToggleFavorite={(page) => void toggleFavorite(page)} onDuplicate={(pageId) => void duplicateSelected(pageId)} />

        <main className="notes-editor-pane">
          {error !== null ? <div className="notes-error" role="alert"><span>{error}</span>{/changed|conflict/i.test(error) && saveState === 'error' ? <button type="button" onClick={() => setReviewMode('conflict')}>Compare versions</button> : null}{saveState === 'error' || saveState === 'unprotected' ? <button type="button" className="notes-error-retry" onClick={() => void savePending()}>Retry</button> : null}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={14} /></button></div> : null}
          {deferredNoteIds.length > 0 && !deferredNoteIds.includes(selectedId ?? '') ? <p className="notes-export-notice" role="status">
            {deferredNoteIds.length === 1 ? 'One note has changes saved on this device that still need to sync.' : `${deferredNoteIds.length} notes have changes saved on this device that still need to sync.`}
            <button type="button" aria-label="Open unsynced note" onClick={() => void openPage(deferredNoteIds[0])}>Open note</button>
          </p> : null}
          {exportNotice !== null ? <p className="notes-export-notice" role="status">{exportNotice}<button type="button" aria-label="Dismiss export notice" onClick={() => setExportNotice(null)}><X size={14} /></button></p> : null}
          {selectedPage !== null && draft !== null && draft.id === selectedPage.id ? (
            <>
              <div className="notes-editor-toolbar">
                <div className="notes-breadcrumb"><span>{folderName}</span><ChevronRight size={13} /><strong>{draft.title || 'Untitled'}</strong></div>
                <div ref={actionsRef} className="notes-editor-actions">
                  <span key={shownSaveState} className={`notes-save-state is-${shownSaveState}`}>{shownSaveState === 'saving' ? <span className="notes-save-ring" aria-hidden="true" /> : null}{shownSaveState === 'unsaved' ? 'Unsaved' : shownSaveState === 'protecting' ? 'Protecting changes…' : shownSaveState === 'protected' ? 'Saved on this device' : shownSaveState === 'unprotected' ? 'Draft protection failed' : shownSaveState === 'saving' ? 'Syncing' : shownSaveState === 'error' ? 'Saved on device · Sync failed' : exportedFlash ? 'Exported' : 'Saved to cloud'}</span>
                  <button type="button" className={`notes-favorite-button${selectedPage.favorite ? ' is-active' : ''}`} aria-label={selectedPage.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void toggleFavorite(selectedPage)}><Star size={15} fill={selectedPage.favorite ? 'currentColor' : 'none'} /></button>
                  <button type="button" ref={menuTriggerRef} className="notes-icon-button" aria-label="Note actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={17} /></button>
                  {menuOpen ? (
                    <div className="notes-action-menu">
                      {selectedPage.status === 'active' ? <button type="button" onClick={() => void createPage(selectedPage.id)}><FilePlus2 size={14} />Add subpage</button> : null}
                      {selectedPage.status === 'active' ? <button type="button" onClick={() => setDialog({ kind: 'move', page: selectedPage })}><Move size={14} />Move</button> : null}
                      {selectedPage.status === 'active' ? <button type="button" onClick={() => void duplicateSelected(selectedPage.id)}><Copy size={14} />Duplicate</button> : null}
                      <button type="button" onClick={() => { setReviewMode('versions'); setMenuOpen(false) }}><Clock3 size={14} />Version history</button>
                      <button type="button" onClick={() => { setReviewMode('suggestions'); setMenuOpen(false) }}><Pencil size={14} />Suggestions</button>
                      <button type="button" onClick={exportNative}><Download size={14} />Export native document</button>
                      <button type="button" onClick={() => void exportMarkdown()}><Download size={14} />Export Markdown</button>
                      {selectedPage.status === 'active' ? <button type="button" onClick={() => void mutateSelected(() => notesApi.archivePage(selectedPage.id))}><Archive size={14} />Archive</button> : null}
                      {selectedPage.status === 'archived' ? <button type="button" onClick={() => void restorePages([selectedPage.id])}><ArchiveRestore size={14} />Restore</button> : null}
                      {selectedPage.status !== 'trash' ? <button type="button" className="is-danger" onClick={() => void trashPages([selectedPage.id])}><Trash2 size={14} />Move to Trash</button> : null}
                      {selectedPage.status === 'trash' ? <button type="button" onClick={() => void restorePages([selectedPage.id])}><ArchiveRestore size={14} />Restore</button> : null}
                      {selectedPage.status === 'trash' ? <button type="button" className="is-danger" onClick={() => { setMenuOpen(false); setPurgeRequest([selectedPage.id]) }}><Trash2 size={14} />Delete permanently</button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {findOpen ? (
                <NoteFindBar
                  targetRef={editorScrollRef}
                  contentVersion={draft.contentJson}
                  onClose={() => setFindOpen(false)}
                />
              ) : null}
              <div className="notes-editor-scroll" ref={editorScrollRef}>
                <article className="notes-editor-measure">
                  <textarea rows={1} ref={titleRef} className="notes-title-input" disabled={!writerReady || selectedPage.status === 'trash'} value={draft.title} maxLength={300} onChange={(event) => queueSave({ ...draft, title: event.target.value.replace(/\n/g, ' ') })} onBlur={() => void savePending()} aria-label="Note title" placeholder="Untitled" />
                  <Suspense fallback={<div className="notes-editor-loading">Opening editor…</div>}>
                    {writerError !== null && <div className="notes-writer-notice" role="status"><span>{writerError}</span><button type="button" aria-label="Try editing again" onClick={() => setWriterAttempt(attempt => attempt + 1)}>Try editing again</button></div>}
                    {writerReady && selectedPage.status !== 'trash' ? <RichNoteEditor key={selectedPage.id} page={{ ...selectedPage, title: draft.title, contentJson: draft.contentJson }} allPages={data.pages} handle={editorHandleRef} onChange={updateEditorContent} onMoveBlocks={moveEditorBlocks} /> : writerError !== null || selectedPage.status === 'trash' ? <NoteReadOnlyPreview contentJson={draft.contentJson} /> : <p className="notes-editor-loading">Opening editor…</p>}
                  </Suspense>
                </article>
              </div>
            </>
          ) : <EmptyEditor scope={scope} listEmpty={rows.length === 0} />}
        </main>
      </div>

      {reviewMode !== null ? <Suspense fallback={null}><NoteReviewDialog mode={reviewMode} page={selectedPage} onClose={() => setReviewMode(null)} beforeChange={savePending} onApplied={(saved) => {
        if (pendingRef.current?.id === saved.id) pendingRef.current = null
        draftRef.current = { id: saved.id, title: saved.title, contentJson: saved.contentJson }
        setDraft(draftRef.current)
        setSaveState('saved')
        setError(null)
        setData((current) => ({ ...current, pages: current.pages.map((page) => page.id === saved.id ? saved : page) }))
      }} /></Suspense> : null}
      {toast !== null ? <Toast message={toast.message} action={toast.action} duration={6000} onDismiss={dismissToast} /> : null}
      <PurgeDialog pageIds={purgeRequest} onClose={() => setPurgeRequest(null)} onConfirm={purgePages} />
      <FolderDialog value={dialog?.kind === 'folder' ? dialog : null} onClose={() => setDialog(null)} onDelete={async (folderItem) => {
        await replaceState(notesApi.deleteFolder(folderItem.id))
        if (scope === `folder:${folderItem.id}`) setScope('all')
        setDialog(null)
      }} onSubmit={async (name, folderItem) => {
        if (folderItem === null) {
          const state = await replaceState(notesApi.createFolder({ name, parentFolderId: null }))
          if (state === null) return
          const created = state.folders.find((candidate) => !data.folders.some((existing) => existing.id === candidate.id))
          if (created !== undefined) setScope(`folder:${created.id}`)
        } else await replaceState(notesApi.renameFolder({ id: folderItem.id, name }))
        setDialog(null)
      }} />
      <MoveDialog value={dialog?.kind === 'move' ? dialog.page : null} folders={data.folders} pages={data.pages} onClose={() => setDialog(null)} onSubmit={async (page, folderId, parentPageId) => {
        await replaceState(notesApi.movePage({ id: page.id, folderId, parentPageId }))
        setDialog(null)
      }} />
    </PageShell>
  )
}
