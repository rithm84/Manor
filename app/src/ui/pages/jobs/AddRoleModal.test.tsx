// @vitest-environment happy-dom
import { ViewTestServices } from '../../testing/viewServices'
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { describe, expect, it } from 'vitest'

import { AddRoleModal } from './AddRoleModal'

describe('AddRoleModal', () => {
  it('includes the complete creation fields without defaulting date posted', async () => {
    const markup = await renderPortalMarkup(
      <ViewTestServices><AddRoleModal open onClose={() => undefined} onAdd={async () => undefined} /></ViewTestServices>
    )
    expect(markup).toContain('aria-label="Company"')
    expect(markup).toContain('aria-label="Role"')
    expect(markup).toContain('aria-label="Location"')
    expect(markup).toContain('aria-label="Posting link"')
    expect(markup).toContain('aria-label="Date posted"')
    expect(markup).toContain('aria-label="Initial stage: To apply"')
    expect(markup).toContain('Sign in to attach resume versions.')
    expect(markup).toContain('class="ui-datepicker-trigger"')
    expect(markup).toContain('Not set')
    expect(markup).not.toContain('type="date"')
    expect(markup).not.toContain('Notes')
  })
})
