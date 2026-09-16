/**
 * [COMP:api/tool-result-excerpt] Display excerpts of a tool_result for the
 * chat SSE stream: a one-line error excerpt and a bounded output excerpt.
 */
import { describe, expect, it } from 'vitest'
import {
  TOOL_OUTPUT_EXCERPT_CHARS,
  toolErrorExcerpt,
  toolOutputExcerpt,
} from '../tool-result-excerpt.js'

describe('[COMP:api/tool-result-excerpt] toolErrorExcerpt', () => {
  it('flattens whitespace to one line and clips at 200 characters', () => {
    expect(toolErrorExcerpt('Error:   Column Not\n  Found')).toBe('Error: Column Not Found')
    const long = toolErrorExcerpt('x'.repeat(500))
    // 197 characters plus the ellipsis.
    expect(long).toHaveLength(198)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('[COMP:api/tool-result-excerpt] toolOutputExcerpt', () => {
  it('keeps newlines, collapses blank runs, and returns empty for nothing', () => {
    expect(toolOutputExcerpt('{\r\n  "a": 1\r\n}\n\n\n\nnext')).toBe('{\n  "a": 1\n}\n\nnext')
    expect(toolOutputExcerpt('   \n ')).toBe('')
  })

  it('bounds the excerpt at ~2 KB with a marker, and leaves short results whole', () => {
    const big = toolOutputExcerpt('y'.repeat(50_000))
    expect(big.length).toBe(TOOL_OUTPUT_EXCERPT_CHARS + 2)
    expect(big.endsWith('\n…')).toBe(true)
    expect(toolOutputExcerpt('short')).toBe('short')
  })
})
