/** Deterministic native-boot acceptance transport. [COMP:feed/confirmation-learning] */
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { proposeFeedReplacement } from '@use-brian/doc-model'
const db = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/absent')
const appDb = new URL(process.env.DATABASE_URL_APP ?? 'postgresql://invalid/absent')
if (process.env.NODE_ENV !== 'test' || db.hostname !== '127.0.0.1' || appDb.hostname !== '127.0.0.1' || db.pathname !== '/feed_draft_collaboration_acceptance' || appDb.pathname !== db.pathname || process.env.K_SERVICE) throw new Error('Fixture requires test mode and both dedicated loopback database URLs')
const folder = '/tmp/feed-collaboration-browser'; mkdirSync(folder, { recursive: true })
const metrics = { review: {} as Record<string, number>, generation: 0, image: 0, synthesis: 0, reflection: 0, chat: 0, suggestion: 0, retrievedMemory: 0, blockedRemote: 0 }
const record = () => writeFileSync(`${folder}/transport-counts.json`, JSON.stringify(metrics, null, 2))
const imageBytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='
const actualFetch = globalThis.fetch
function jsonAfter(text: string, marker: string): any {
  const pos = text.indexOf(marker); if (pos < 0) return null
  const start = text.indexOf('{', pos); if (start < 0) return null
  let depth = 0, quoted = false, escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) { escaped = false; continue }
    if (quoted && char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '{') depth++
    if (char === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)) } catch { return null } }
  }
  return null
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return actualFetch(input, init)
  if (url.hostname !== 'generativelanguage.googleapis.com') { metrics.blockedRemote++; record(); throw new Error('External transport is disabled in the Feed acceptance fixture') }
  const body = JSON.parse(String(init?.body ?? '{}'))
  if (/[Ee]mbedContent/.test(url.pathname)) {
    const dimension = body.outputDimensionality ?? body.requests?.[0]?.outputDimensionality ?? 768
    const embedding = { values: Array.from({ length: dimension }, (_, index) => index === 0 ? 1 : 0) }
    return Response.json(url.pathname.includes('batch') ? { embeddings: (body.requests ?? [1]).map(() => embedding) } : { embedding })
  }
  if (!url.pathname.includes('GenerateContent') && !url.pathname.includes('generateContent')) { metrics.blockedRemote++; record(); throw new Error('Unexpected fixture transport operation') }
  const system = (body.systemInstruction?.parts ?? []).map((part: any) => part.text ?? '').join('\n')
  const messages = body.contents ?? []
  const last = messages.at(-1)
  const promptText = (last?.parts ?? []).map((part: any) => part.text ?? '').join('\n')
  let prompt: any; try { prompt = JSON.parse(promptText) } catch { prompt = null }
  let parts: any[]
  if (body.generationConfig?.responseModalities?.includes('IMAGE')) {
    metrics.image++; parts = [{ inlineData: { mimeType: 'image/png', data: imageBytes } }]
  } else if (system.includes('You are a Feed editor.') && prompt?.dimension) {
    const dimension = prompt.dimension; metrics.review[dimension] = (metrics.review[dimension] ?? 0) + 1
    const source = prompt.sources?.[0]
    parts = [{ text: JSON.stringify({ findings: source ? [{ issueKey: `fixture_${dimension}`, dimensions: [dimension], priority: 'low', target: { kind: 'post' }, issue: `Fixture ${dimension} check: keep the orchard example concrete.`, nextStep: 'Review this observation without changing the draft automatically.', evidence: [{ sourceId: source.id, quote: String(source.body).slice(0, 60) }] }] : [] }) }]
  } else if (system.startsWith('Draft at most') && prompt?.target?.slot) {
    metrics.generation++; parts = [{ text: JSON.stringify({ candidates: [{ markdown: 'Three orchard rows make the example concrete.', rationale: 'A bounded explanation for this selected slot.' }] }) }]
  } else if (system.includes('Summarize the confirmed Feed editorial decisions')) {
    metrics.synthesis++
    const decision = prompt?.sources?.find((source: any) => source.kind === 'decision' && source.actorUserId)
    parts = [{ text: JSON.stringify({ summary: 'The confirmed orchard opening uses a concrete example for this post.', decisions: decision ? [{ statement: 'The author revised this post using the recorded editorial discussion.', actorUserId: decision.actorUserId, outcome: decision.outcome ?? null, sourceIds: [decision.id] }] : [], conflicts: [], unresolved: [] }) }]
  } else if (prompt?.applicabilityKind === 'feed' && prompt?.evidence) {
    metrics.reflection++; parts = [{ text: JSON.stringify({ rules: [] }) }]
  } else {
    metrics.chat++
    const context = jsonAfter(system, 'Current Feed draft (server-validated source data')
    const hasMemory = JSON.stringify(context?.learningSources ?? []).includes('The confirmed orchard opening uses a concrete example for this post.')
    if (hasMemory) metrics.retrievedMemory++
    const requested = /suggest.*concrete opening/i.test(promptText)
    if (context && requested && !last?.parts?.some((part: any) => part.functionResponse) && JSON.stringify(body.tools ?? []).includes('suggestFeedDraftChange')) {
      metrics.suggestion++
      parts = [{ functionCall: { name: 'suggestFeedDraftChange', args: { mutationId: randomUUID(), edits: proposeFeedReplacement(context.content.composition, context.target.target ?? { kind: 'post' }, 'An orchard with three rows makes the opening concrete.'), rationale: 'A concrete opening proposed for your review.' } } }]
    } else parts = [{ text: context ? hasMemory ? 'I found the confirmed orchard decision memory in this draft’s reference context.' : 'The draft discussion is saved. Proposed changes remain separate until you accept them.' : body.generationConfig?.responseMimeType === 'application/json' ? '{}' : 'The local fixture assistant is ready.' }]
  }
  record()
  const result = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: metrics.image && parts[0]?.inlineData ? 1120 : 40, totalTokenCount: 140 }, modelVersion: url.pathname.split('/models/')[1]?.split(':')[0] }
  // The fixture returns a finite response body, closed immediately after one result.
  return url.searchParams.get('alt') === 'sse' ? new Response(`data: ${JSON.stringify(result)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(result) // sse-lifetime: turn-bounded
}
// Imported after the guard and transport installation. No dotenv or saved keys.
const { bootOpenApi, getPool } = await import('../../src/boot.js')
const { createOssUsageStore } = await import('../../src/db/oss-usage-store.js')
const endpoint = (await getPool().query('SELECT current_database() AS name,host(inet_server_addr()) AS host')).rows[0]
if (endpoint.name !== 'feed_draft_collaboration_acceptance' || endpoint.host !== '127.0.0.1') throw new Error('Refusing a non-fixture PostgreSQL endpoint')
const boot = await bootOpenApi({ env: { GEMINI_API_KEY: 'fixture-transport-only', JWT_SECRET: 'fictional-feed-browser-signing-secret', NODE_ENV: 'test', API_URL: 'http://localhost:4800', APP_URL: 'http://localhost:3303', AUTHED_APP_URL: 'http://localhost:3303', AUTH_PORTAL_URL: 'http://localhost:3303', SMTP_HOST: '127.0.0.1', SMTP_PORT: 4899, SMTP_USER: 'fixture@example.com', SMTP_PASSWORD: 'fixture-only-unused', EMAIL_FROM_ADDRESS: 'fixture@example.com', LOCAL_FILES_DIR: `${folder}/files`, LOCAL_FILES_PUBLIC_URL: 'http://localhost:4800', PORT: '4800' }, ports: { usageStore: createOssUsageStore() }, runWorkers: true })
await boot.start(); record()
console.log('Feed acceptance API ready on http://localhost:4800 using the isolated local fixture.')
