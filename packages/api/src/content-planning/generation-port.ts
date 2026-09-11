/** Configured generation providers and cheap, bounded reference reads. [COMP:feed/draft-generation] */
import { calculateCost } from '@use-brian/core'
import { registryRow } from '@use-brian/shared/model-registry'
import { FEED_GENERATION_LIMITS, type FeedGenerationPrice, type FeedPlaceholderAttrs } from '@use-brian/shared'
import type { FeedEditorialModel, FeedEditorialModelResolver, FeedModelIdentity } from './editorial-model.js'
import { feedEditorialHash } from '../db/feed-editorial-runs-store.js'
import { query } from '../db/client.js'
import { createPublicCustomLlmFetch } from '../custom-llm-public-fetch.js'
export type FeedGenerationSource = { id: string; title: string; body: string; hash: string }
export type FeedGenerationResolved = FeedEditorialModel & { identity: string; price(inputCharacters: number): FeedGenerationPrice }
export type FeedGenerationPort = {
  resolve(actor: FeedModelIdentity, kind: 'text' | 'image', tier: string): Promise<FeedGenerationResolved>;
  readReference(ref: FeedPlaceholderAttrs['references'][number]): Promise<{ source?: FeedGenerationSource; omission?: string }>;
}
export function createFeedGenerationPort(resolveText: FeedEditorialModelResolver): FeedGenerationPort {
  return {
    async resolve(actor, kind, tier) {
      if (kind !== 'text') throw new Error('image_generation_unavailable')
      const model = await resolveText(actor, tier); const rates = registryRow(model.model)?.rates
      const identity = feedEditorialHash({ model: model.model, tier: model.tier, maxTokens: model.maxTokens, inputCharacters: model.inputCharacters, rates, keySource: model.providerKeySource })
      return { ...model, identity, price(inputCharacters) {
        return { currency: 'USD', maximumUsd: rates ? calculateCost(model.model, { inputTokens: inputCharacters, outputTokens: model.maxTokens }) : null,
          rateVersion: `text-registry:${feedEditorialHash(rates ?? 'unpriced')}`, billing: model.providerKeySource === 'user' ? 'byo' : 'included' }
      } }
    },
    readReference: readFeedGenerationReference,
  }
}
const publicFetch = createPublicCustomLlmFetch()
/** File authority is checked by the caller before and after this read. */
export async function readFeedGenerationReference(ref: FeedPlaceholderAttrs['references'][number]) {
  if ('fileId' in ref) {
    const total = Number((await query('SELECT coalesce(sum(length(content)),0) AS size FROM file_segments WHERE file_id=$1', [ref.fileId])).rows[0].size)
    if (!total || total > FEED_GENERATION_LIMITS.referenceBytes) return { omission: `file:${ref.fileId}:${total ? 'reference_too_large' : 'indexed_text_unavailable'}` }
    const rows = (await query('SELECT content FROM file_segments WHERE file_id=$1 ORDER BY segment_index', [ref.fileId])).rows
    const body = rows.map(row => row.content).join('\n')
    return { source: { id: `file:${ref.fileId}`, title: 'Indexed reference passages', body, hash: feedEditorialHash(body) }, omission: `file:${ref.fileId}:indexed_passages_only` }
  }
  try {
    let url = new URL(ref.url); const signal = AbortSignal.timeout(10_000)
    for (let hop = 0; hop < 4; hop++) {
      if (url.username || url.password) break
      // Shared transport pins a validated public address; redirects get a new
      // validation. No cookies, credentials or paid reader fallback are sent.
      const response = await publicFetch(url, { signal, headers: { Accept: 'text/plain,text/html,application/json' }, redirect: 'manual' })
      if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); const location = response.headers.get('location'); if (!location) break; url = new URL(location, url); continue }
      if (!response.ok || !response.body || !/text\/(plain|html)|application\/(json|xhtml\+xml)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); break }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > FEED_GENERATION_LIMITS.referenceBytes) { await reader.cancel(); return { omission: `url:${ref.url}:reference_too_large` } } chunks.push(part.value) }
      let body = Buffer.concat(chunks).toString('utf8')
      if (/html/i.test(response.headers.get('content-type') ?? '')) body = body.replace(/<(script|style|nav)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim()
      if (!body) break
      return { source: { id: `url:${ref.url}`, title: ref.url, body, hash: feedEditorialHash(body) } }
    }
  } catch { /* A missing or denied source is visible before confirmation. */ }
  return { omission: `url:${ref.url}:reference_unavailable` }
}
