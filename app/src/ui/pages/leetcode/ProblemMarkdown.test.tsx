import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProblemMarkdown } from './ProblemMarkdown'

describe('ProblemMarkdown', () => {
  it('renders statement exponents as superscripts without executing markup or touching code blocks', () => {
    const markup = renderToStaticMarkup(<ProblemMarkdown text={'Up to 10<sup>5</sup> items, O(n^2) time, `-10^9 <= x <= 2<sup>31</sup>`, a^b stays.\n\n<script>alert(1)</script>\n\n```\nx = a^2\n```'} />)
    expect(markup).toContain('10<sup>5</sup> items')
    expect(markup).toContain('O(n<sup>2</sup>) time')
    expect(markup).toContain('<code>-10⁹ &lt;= x &lt;= 2³¹</code>')
    expect(markup).toContain('a^b stays')
    expect(markup).toContain('x = a^2')
    expect(markup).not.toContain('<script>')
  })
})
