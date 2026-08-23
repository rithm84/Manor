import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Select } from './Select'

describe('semantic property Select', () => {
  it('renders a selected semantic value as a pill rather than a color dot', () => {
    const markup = renderToStaticMarkup(
      <Select
        value="High"
        options={[
          { value: 'Low', label: 'Low', tone: 'neutral' },
          { value: 'High', label: 'High', tone: 'overdue' }
        ]}
        onChange={() => undefined}
        placeholder="Priority"
        ariaLabel="Priority"
      />
    )

    expect(markup).toContain('ui-pill--tag is-overdue')
    expect(markup).toContain('aria-label="Priority: High"')
    expect(markup).not.toContain('ui-select-tone')
  })
})
