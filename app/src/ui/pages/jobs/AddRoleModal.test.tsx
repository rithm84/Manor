import { ViewTestServices } from '../../testing/viewServices'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AddRoleModal } from './AddRoleModal'

describe('AddRoleModal', () => {
  it('includes the complete creation fields without defaulting date posted', () => {
    const markup = renderToStaticMarkup(
      <ViewTestServices><AddRoleModal open onClose={() => undefined} onAdd={async () => undefined} /></ViewTestServices>
    )
    expect(markup).toContain('aria-label="Company"')
    expect(markup).toContain('aria-label="Role"')
    expect(markup).toContain('aria-label="Location"')
    expect(markup).toContain('aria-label="Posting link"')
    expect(markup).toContain('aria-label="Date posted"')
    expect(markup).toContain('aria-label="Initial stage: To apply"')
    expect(markup).toContain('aria-label="Resume: None"')
    expect(markup).toContain('Upload new version')
    expect(markup).toContain('accept="application/pdf"')
    expect(markup).toContain('class="ui-datepicker-trigger"')
    expect(markup).toContain('Not set')
    expect(markup).not.toContain('type="date"')
    expect(markup).not.toContain('Notes')
  })
})
