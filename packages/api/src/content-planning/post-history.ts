/** Authorized full-body Feed history, including bounded older phrase search. [COMP:feed/draft-review] */
import type { FeedReader } from '../db/feed-collaboration-store.js'
import { FEED_EDITORIAL_LIMITS, type FeedReviewSource, type FeedReviewCoverage } from '@use-brian/shared'
import { feedEditorialHash } from '../db/feed-editorial-runs-store.js'
export async function readFeedPostHistory(client: FeedReader, input: { workspaceId: string; assistantIds: string[]; sessionId: string; text: string; cursor?: number; additionalHistorySql?: string }) {
  // The optional trusted composition-root adapter normalizes hosted storage
  // into these columns. It shares the same $1/$2/$3 scope parameters.
  const openRows = `SELECT d.id::text,d.platform,d.status,coalesce(d.final_text,d.draft_text,'') AS body,d.post_format,jsonb_build_object('threadSegments',d.format_data->'threadSegments','article',d.format_data->'article') AS format_data,coalesce(d.resolved_at,d.created_at) AS date,d.posted_permalink AS link FROM content_planning_drafts d JOIN assistants a ON a.id=d.assistant_id WHERE a.workspace_id=$1 AND d.assistant_id=ANY($2::uuid[]) AND d.status IN ('ready','posted') AND d.removed_at IS NULL AND d.session_id IS DISTINCT FROM $3::uuid`
  const base = `FROM (${openRows}${input.additionalHistorySql ? ` UNION ALL ${input.additionalHistorySql}` : ''}) d`
  const values = [input.workspaceId, input.assistantIds, input.sessionId]
  const total = Number((await client.query(`SELECT count(*) ${base}`, values)).rows[0].count)
  // Full bodies are read before review; previews and topic labels cannot prove
  // repetition. Use a bounded OR query so older concept matches survive dates.
  const terms = [...new Set(input.text.toLowerCase().match(/[\p{L}\p{N}]{4,40}/gu) ?? [])].slice(0, 24)
  const phrase = terms.join(' OR ')
  const cursor = input.cursor ?? 0
  const columns = 'd.*'
  const recent = (await client.query(`SELECT ${columns} ${base} WHERE length(d.body)>0 ORDER BY d.date DESC,d.id DESC LIMIT $4`, [...values, FEED_EDITORIAL_LIMITS.recentPosts])).rows
  const excluded = recent.map(row => row.id)
  const older = terms.length ? (await client.query(`SELECT ${columns} ${base} WHERE length(d.body)>0 AND NOT(d.id=ANY($4::text[])) AND (to_tsvector('simple',d.body) @@ websearch_to_tsquery('simple',$5) OR EXISTS (SELECT 1 FROM unnest($6::text[]) term WHERE strpos(lower(d.body),term)>0)) ORDER BY d.date DESC,d.id DESC LIMIT $7 OFFSET $8`, [...values, excluded, phrase, terms, FEED_EDITORIAL_LIMITS.olderPosts + 1, cursor])).rows : []
  const more = older.length > FEED_EDITORIAL_LIMITS.olderPosts
  const rows = [...(cursor === 0 ? recent : []), ...older.slice(0, FEED_EDITORIAL_LIMITS.olderPosts)]
  const sources: FeedReviewSource[] = rows.map(row => {
    const body = JSON.stringify({ text: row.body, format: row.post_format, formatData: row.format_data })
    return { id: `post:${row.id}`, kind: 'post', title: `${row.platform} ${row.date.toISOString().slice(0, 10)}`, body, hash: feedEditorialHash(body), date: row.date.toISOString(), ...(row.link ? { link: row.link } : {}), state: row.status === 'posted' ? 'published' : 'planned' }
  })
  const dates = sources.map(source => source.date!).sort()
  const coverage: FeedReviewCoverage = { state: total === 0 ? 'unavailable' : rows.length < total ? 'partial' : 'checked', eligible: total, retrieved: rows.length, reviewed: 0, limits: rows.length < total ? ['recent_30_and_older_keyword_matches'] : [], oldest: dates[0] ?? null, newest: dates.at(-1) ?? null, nextCursor: more ? cursor + FEED_EDITORIAL_LIMITS.olderPosts : null }
  return { sources, coverage }
}
