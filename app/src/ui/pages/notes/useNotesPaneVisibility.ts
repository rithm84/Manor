import { useEffect, useState } from 'react'

interface NotesPaneVisibility {
  listCollapsed: boolean
  setListCollapsed: (collapsed: boolean) => void
}

/** The device remembers whether the note list is tucked away; that preference is independent of the open note. */
export function useNotesPaneVisibility(): NotesPaneVisibility {
  const [listCollapsed, setListCollapsed] = useState(() =>
    window.localStorage.getItem('manor.notes.list-collapsed') === '1')

  useEffect(() => {
    window.localStorage.setItem('manor.notes.list-collapsed', listCollapsed ? '1' : '0')
  }, [listCollapsed])

  return { listCollapsed, setListCollapsed }
}
