import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { CodexRpcPeer } from '../rpc.js'
import { generateCodexImage, inspectCodexImage } from '../image.js'

const snapshot = { model: 'gpt-image-2', orchestratorModel: 'gpt-test', identity: 'test' }
async function fixture(options: { status?: string; data?: string; empty?: boolean; beforeAck?: boolean; wrongThread?: boolean; hold?: boolean } = {}) {
  const input = new PassThrough(); const output = new PassThrough(); const calls: Array<{ method: string; params: any }> = []
  const png = (await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64')
  const send = (message: unknown) => input.write(JSON.stringify(message) + '\n')
  const completed = () => {
    if (options.hold) return
    if (options.wrongThread) send({ method: 'item/completed', params: { threadId: 'other', turnId: 'turn', item: { type: 'imageGeneration', id: 'foreign', status: 'completed', result: png } } })
    if (options.empty) send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } })
    else send({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'imageGeneration', id: 'image', status: options.status ?? 'completed', result: options.data ?? png, savedPath: '/etc/never-read-this' } } })
  }
  output.on('data', chunk => {
    for (const line of String(chunk).trim().split('\n')) {
      const frame = JSON.parse(line); calls.push(frame)
      if (frame.method === 'thread/start') send({ id: frame.id, result: { thread: { id: 'thread' }, model: 'gpt-test', modelProvider: 'openai' } })
      else if (frame.method === 'turn/start') { if (options.beforeAck) completed(); send({ id: frame.id, result: { turn: { id: 'turn', status: 'inProgress' } } }); if (!options.beforeAck) queueMicrotask(completed) }
      else send({ id: frame.id, result: {} })
    }
  })
  const rpc = new CodexRpcPeer({ input, output })
  return { rpc, cwd: '/tmp/empty-fixture', calls, png }
}
describe('[COMP:core/codex-image] explicit image receipt bridge', () => {
  it.each([false, true])('accepts a decoded image and interrupts further calls (completion before ack: %s)', async beforeAck => {
    const f = await fixture({ beforeAck, wrongThread: true })
    try {
      const receipt = await generateCodexImage(f, snapshot, 'One simple diagram', AbortSignal.timeout(3000))
      expect(receipt.image).toEqual({ data: f.png, mimeType: 'image/png' })
      expect(receipt.responseId).toBe('image')
      expect(receipt.usage.measured).toBe(false)
      expect(f.calls.find(c => c.method === 'thread/start')?.params).toMatchObject({ environments: [], dynamicTools: [], sandbox: 'read-only', ephemeral: true })
      expect(f.calls.filter(c => c.method === 'turn/start')).toHaveLength(1)
      expect(f.calls.some(c => c.method === 'turn/interrupt')).toBe(true)
    } finally { f.rpc.close() }
  })
  it.each([
    [{ empty: true }, 'image_missing'], [{ status: 'failed' }, 'image_provider_rejected'],
    [{ data: 'not-base64' }, 'image_malformed'], [{ data: Buffer.from('a narrative with a path').toString('base64') }, 'image_malformed'],
    [{ data: 'iVBORw0KGgo=' }, 'image_malformed'],
  ] as const)('fails honestly for %j', async (options, expected) => {
    const f = await fixture(options)
    try { expect(await generateCodexImage(f, snapshot, 'A diagram', AbortSignal.timeout(3000))).toMatchObject({ error: expected }); }
    finally { f.rpc.close() }
  })
  it('aborts a waiting image turn and never retries it', async () => {
    const f = await fixture({ hold: true }); const controller = new AbortController()
    const result = generateCodexImage(f, snapshot, 'A diagram', controller.signal)
    const rejection = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(f.calls.some(c => c.method === 'turn/start')).toBe(true)); controller.abort()
    await rejection; expect(f.calls.filter(c => c.method === 'turn/start')).toHaveLength(1); f.rpc.close()
  })
  it.each(['free', 'unknown', null])('rejects an ineligible or missing subscription before model work: %s', async planType => {
    const request = vi.fn().mockResolvedValue({ account: planType ? { type: 'chatgpt', email: 'fixture@example.com', planType } : null, requiresOpenaiAuth: true })
    await expect(inspectCodexImage({ rpc: { request } as any, cwd: '/tmp/fixture' }, ['gpt-test'])).rejects.toThrow('image_generation_unavailable')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
