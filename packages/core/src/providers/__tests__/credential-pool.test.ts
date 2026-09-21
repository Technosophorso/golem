import { describe, expect, it, vi } from 'vitest'
import { wrapCredentialPoolProvider, type ExternalCredentialPool } from '../credential-pool.js'
import { authorizeGoogleRequest, credentialPoolAiStudioTransport } from '../google-transport.js'
import type { LLMProvider, StreamChunk } from '../types.js'

async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function providerFor(secret: string): LLMProvider {
  return {
    name: 'fixture',
    models: [],
    async *stream(request) {
      yield { type: 'message_start', model: request.model }
      yield { type: 'text_delta', text: secret }
      yield {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, calculatedCostUsd: 0.25 },
      }
    },
    createSession(options) {
      return {
        send: (messages) => this.stream({
          model: options.model,
          systemPrompt: options.systemPrompt,
          messages,
        }),
      }
    },
  }
}

describe('[COMP:providers/credential-pool] credential-resolving provider', () => {
  it('resolves each stateless call live and records reported spend on its lease', async () => {
    const recordFirst = vi.fn(async () => {})
    const recordSecond = vi.fn(async () => {})
    const pool: ExternalCredentialPool = {
      resolve: vi.fn()
        .mockResolvedValueOnce({
          credentialId: 'first', provider: 'gemini', secret: 'promo-one', source: 'managed',
          recordSpend: recordFirst,
        })
        .mockResolvedValueOnce({
          credentialId: 'second', provider: 'gemini', secret: 'promo-two', source: 'managed',
          recordSpend: recordSecond,
        }),
    }
    const provider = wrapCredentialPoolProvider({
      providerId: 'gemini', pool, systemFallback: 'stable', create: providerFor,
    })

    const request = { model: 'fixture-model', systemPrompt: '', messages: [] }
    const first = await drain(provider.stream(request))
    const second = await drain(provider.stream(request))

    expect(first).toContainEqual({ type: 'text_delta', text: 'promo-one' })
    expect(second).toContainEqual({ type: 'text_delta', text: 'promo-two' })
    expect(recordFirst).toHaveBeenCalledWith(0.25)
    expect(recordSecond).toHaveBeenCalledWith(0.25)
  })

  it('keeps one lease for every turn in a stateful provider session', async () => {
    const recordSpend = vi.fn(async () => {})
    const pool: ExternalCredentialPool = {
      resolve: vi.fn().mockResolvedValue({
        credentialId: 'first', provider: 'gemini', secret: 'session-key', source: 'managed',
        recordSpend,
      }),
    }
    const provider = wrapCredentialPoolProvider({
      providerId: 'gemini', pool, create: providerFor,
    })
    const session = provider.createSession({ model: 'fixture-model', systemPrompt: '' })

    await drain(session.send([{ role: 'user', content: 'one' }]))
    await drain(session.send([{ role: 'user', content: 'two' }]))

    expect(pool.resolve).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledTimes(2)
  })

  it('binds Google spend to the same lease that produced the request headers', async () => {
    const recordFirst = vi.fn(async () => {})
    const recordSecond = vi.fn(async () => {})
    const pool: ExternalCredentialPool = {
      resolve: vi.fn()
        .mockResolvedValueOnce({
          credentialId: 'first', provider: 'gemini', secret: 'first-key', source: 'managed',
          recordSpend: recordFirst,
        })
        .mockResolvedValueOnce({
          credentialId: 'second', provider: 'gemini', secret: 'second-key', source: 'managed',
          recordSpend: recordSecond,
        }),
    }
    const transport = credentialPoolAiStudioTransport(pool, 'stable-key')

    const first = await authorizeGoogleRequest(transport)
    const second = await authorizeGoogleRequest(transport)
    await first.recordSpend?.('fixture', {
      inputTokens: 1,
      outputTokens: 1,
      calculatedCostUsd: 0.4,
    })

    expect(first.headers['x-goog-api-key']).toBe('first-key')
    expect(second.headers['x-goog-api-key']).toBe('second-key')
    expect(recordFirst).toHaveBeenCalledWith(0.4)
    expect(recordSecond).not.toHaveBeenCalled()
  })
})
