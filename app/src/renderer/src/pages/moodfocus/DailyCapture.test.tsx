import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DailyCapture } from './DailyCapture'

describe('DailyCapture', () => {
  it('renders only the two keyboard-addressable signal controls and the Alfred entry point', () => {
    const markup = renderToStaticMarkup(
      <DailyCapture
        dayTitle="Today"
        dayDate="Thursday, August 20"
        previousDisabled={false}
        nextDisabled={true}
        onPreviousDay={() => undefined}
        onNextDay={() => undefined}
        entry={null}
        saving={false}
        onMoodChange={() => undefined}
        onFocusChange={() => undefined}
        onDebrief={() => undefined}
      />
    )

    expect(markup.match(/role="radiogroup"/g)).toHaveLength(2)
    expect(markup.match(/role="radio"/g)).toHaveLength(11)
    expect(markup).toContain('aria-labelledby="mood-label"')
    expect(markup).toContain('aria-labelledby="focus-label"')
    expect(markup).toContain('Debrief with Alfred')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('Context')
    expect(markup).not.toContain('A sentence is enough')
  })
})
