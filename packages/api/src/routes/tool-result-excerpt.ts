/**
 * Display excerpts of a tool_result for the chat SSE stream.
 *
 * A tool_result block is capped for the MODEL (per-tool `maxResultSizeChars`,
 * then the 25k-token global cap) and persisted at that size. The stream
 * carries only what the activity feed shows: a one-line error excerpt for
 * failed calls, and a bounded output excerpt for successful ones. Both ride
 * the sender's own stream only — the room mirror payload never includes them.
 *
 * Spec: docs/architecture/engine/live-streaming.md → "QueryEvent → SSE".
 * [COMP:api/tool-result-excerpt]
 */

/** Longest error line the feed shows under a retried step. */
export const TOOL_ERROR_EXCERPT_CHARS = 200
/** Longest output excerpt the stream carries per call (~2 KB). */
export const TOOL_OUTPUT_EXCERPT_CHARS = 2_000
export const TOOL_OUTPUT_EXCERPT_MARKER = '\n…'

/**
 * Trim a tool-result error string into a single short line. Long stack
 * traces are useless in the feed and oversized SSE frames hurt streaming.
 */
export function toolErrorExcerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > TOOL_ERROR_EXCERPT_CHARS
    ? `${flat.slice(0, TOOL_ERROR_EXCERPT_CHARS - 3)}…`
    : flat
}

/**
 * The first `TOOL_OUTPUT_EXCERPT_CHARS` of a successful result with newlines
 * kept (JSON and tables stay readable), runs of blank lines collapsed, and a
 * marker when clipped. Empty when there is nothing to show.
 */
export function toolOutputExcerpt(content: string): string {
  const tidy = content.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!tidy) return ''
  return tidy.length > TOOL_OUTPUT_EXCERPT_CHARS
    ? `${tidy.slice(0, TOOL_OUTPUT_EXCERPT_CHARS)}${TOOL_OUTPUT_EXCERPT_MARKER}`
    : tidy
}
