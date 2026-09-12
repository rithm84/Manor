// @vitest-environment happy-dom
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { describe, expect, it } from 'vitest'

import { DetailDialog } from './DetailDialog'

describe('centered detail dialog foundation', () => {
  it('exposes modal semantics, an accessible close action, and no side-panel structure', async () => {
    const markup = await renderPortalMarkup(
      <DetailDialog
        open
        onClose={() => undefined}
        title="Object details"
        width={520}
        ariaLabel="Details for test object"
      >
        <button type="button">First action</button>
      </DetailDialog>
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Details for test object"')
    expect(markup).toContain('aria-label="Close details"')
    expect(markup).toContain('ui-detail-dialog-body')
    expect(markup).not.toContain('<aside')
    expect(markup).not.toContain('ui-sidepeek')
  })
})
