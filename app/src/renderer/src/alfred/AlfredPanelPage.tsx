import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { AlfredRoute } from '../../../shared/alfred'
import { AlfredExperience } from './AlfredExperience'

export function AlfredPanelPage(): ReactNode {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('alfred-panel-document')
    document.body.classList.add('alfred-panel-document')
    const unsubscribe = window.manor.alfred.onPanelVisibility(setVisible)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void window.manor.alfred.dismissPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('alfred-panel-document')
      document.body.classList.remove('alfred-panel-document')
    }
  }, [])

  const navigate = (route: AlfredRoute): void => {
    void window.manor.alfred.navigate(route)
  }

  return (
    <main className="alfred-panel-shell">
      {visible ? (
        <AlfredExperience
          active
          variant="panel"
          onEnd={() => void window.manor.alfred.dismissPanel()}
          onNavigate={navigate}
        />
      ) : null}
    </main>
  )
}
