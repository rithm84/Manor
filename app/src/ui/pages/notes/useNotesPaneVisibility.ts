import { useEffect, useState } from 'react'

interface NotesPaneVisibility {
  navigationCollapsed: boolean
  listCollapsed: boolean
  setNavigationCollapsed: (collapsed: boolean) => void
  setListCollapsed: (collapsed: boolean) => void
}

/** Device layout preferences are independent of the active note and its draft. */
export function useNotesPaneVisibility(): NotesPaneVisibility {
  const [navigationCollapsed, setNavigationCollapsed] = useState(() =>
    window.localStorage.getItem('manor.notes.navigation-collapsed') === '1')
  const [listCollapsed, setListCollapsed] = useState(() =>
    window.localStorage.getItem('manor.notes.list-collapsed') === '1')

  useEffect(() => {
    window.localStorage.setItem('manor.notes.navigation-collapsed', navigationCollapsed ? '1' : '0')
  }, [navigationCollapsed])
  useEffect(() => {
    window.localStorage.setItem('manor.notes.list-collapsed', listCollapsed ? '1' : '0')
  }, [listCollapsed])

  return { navigationCollapsed, listCollapsed, setNavigationCollapsed, setListCollapsed }
}
