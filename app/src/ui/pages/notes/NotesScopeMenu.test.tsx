// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type { NoteFolder } from '../../../shared/notes'
import type { NotesScope } from './notesModel'
import { NotesScopeMenu } from './NotesScopeMenu'

const FOLDERS: NoteFolder[] = [
  { id: 'f-school', name: 'School', parentFolderId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'f-work', name: 'Work', parentFolderId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
]

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label)
  if (found === undefined) throw new Error(`No button labelled ${label}`)
  return found
}

describe('NotesScopeMenu', () => {
  it('names the current view, opens to the views and folders with counts, and selects one', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const chosen: NotesScope[] = []
    const renamed: string[] = []
    let created = 0
    const render = (scope: NotesScope): Promise<void> => act(async () => root.render(
      <NotesScopeMenu scope={scope} folders={FOLDERS} onSelect={(next) => chosen.push(next)} onNewFolder={() => { created += 1 }} onRenameFolder={(folder) => renamed.push(folder.id)}
        counts={{ all: 14, favorites: 2, archived: 0, trash: 16, folder: (id) => (id === 'f-work' ? 3 : 0) }} />
    ))
    try {
      await render('all')
      const trigger = document.querySelector<HTMLButtonElement>('.notes-scope-trigger')
      if (trigger === null) throw new Error('The picker did not mount')
      expect(trigger.textContent).toContain('All notes')
      expect(document.querySelector('[role="menu"]')).toBeNull()

      await act(async () => trigger.click())
      const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      expect(items.map((item) => item.textContent)).toEqual(['All notes14', 'Favorites2', 'Recent', 'Archived', 'Trash16', 'School0', 'Work3'])
      expect(items[0]?.getAttribute('aria-checked')).toBe('true')

      await act(async () => button('Work3').click())
      expect(chosen).toEqual(['folder:f-work'])
      expect(document.querySelector('[role="menu"]')).toBeNull()

      await render('folder:f-work')
      expect(document.querySelector('.notes-scope-trigger')?.textContent).toContain('Work')

      await act(async () => document.querySelector<HTMLButtonElement>('.notes-scope-trigger')?.click())
      await act(async () => button('Rename School').click())
      expect(renamed).toEqual(['f-school'])
      await act(async () => document.querySelector<HTMLButtonElement>('.notes-scope-trigger')?.click())
      await act(async () => button('New folder').click())
      expect(created).toBe(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
