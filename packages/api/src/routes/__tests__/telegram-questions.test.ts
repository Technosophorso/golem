import { describe, it, expect, vi } from 'vitest'
import { TelegramQuestions, type QuestionBinding } from '../telegram-questions.js'
import { deliverChannelResponse } from '../channel-pipeline.js'

const binding: QuestionBinding = {
  integrationId: 'bot', assistantId: 'assistant', userId: 'resolved-user',
  incoming: { channelId: '-10:topic:3', userId: '42', text: '', timestamp: 0, isGroupChat: true, raw: {} },
}

describe('[COMP:api/telegram-questions] single-choice delivery and token security', () => {
  it('delivers question and all choices, retains documents and passes structure to the hook', async () => {
    const sendResponse = vi.fn(async () => undefined)
    const question = { question: 'Which?', options: ['A', 'B'] }
    await deliverChannelResponse({ sendResponse }, 'Private intermediate narration', [], question)
    expect(sendResponse).toHaveBeenCalledWith('Which?\n1. A\n2. B', [], question)
    await deliverChannelResponse({ sendResponse }, '', undefined, question)
    expect(sendResponse).toHaveBeenLastCalledWith('Which?\n1. A\n2. B', undefined, question)
    await deliverChannelResponse({ sendResponse }, 'Normal reply')
    expect(sendResponse).toHaveBeenLastCalledWith('Normal reply', undefined, undefined)
    await deliverChannelResponse({ sendResponse }, 'Narration', undefined, question, 'Model fallback')
    expect(sendResponse).toHaveBeenLastCalledWith('Model fallback\n\nWhich?\n1. A\n2. B', undefined, question)
  })

  it('supports a text-only channel hook that ignores structured questions', async () => {
    const texts: string[] = []
    const hooks = { sendResponse: async (text: string) => { texts.push(text) } }
    await deliverChannelResponse(hooks, 'Do not send narration', undefined,
      { question: 'Choose for action 17:', options: ['Yes', 'No', 'Something else'] })
    await deliverChannelResponse(hooks, '', undefined, { question: 'Anything else?' })
    expect(texts).toEqual(['Choose for action 17:\n1. Yes\n2. No\n3. Something else', 'Anything else?'])
  })

  it('uses compact opaque callbacks even for Unicode labels and consumes once', () => {
    const store = new TelegramQuestions()
    const [action] = store.create(binding, ['😀'.repeat(40), 'B'])
    expect(Buffer.byteLength(action!.data)).toBeLessThanOrEqual(64)
    expect(action!.data).not.toContain('😀')
    expect(store.take(action!.data, 'bot', '-10:topic:3', '42')?.answer).toBe('😀'.repeat(40))
    expect(store.take(action!.data, 'bot', '-10:topic:3', '42')).toBeNull()
  })

  it('rejects unauthorized sender, other bot, chat/topic and invalid index without consuming', () => {
    const store = new TelegramQuestions()
    const data = store.create(binding, ['A', 'B'])[0]!.data
    for (const [bot, chat, sender] of [['bot', '-10:topic:3', '43'], ['other', '-10:topic:3', '42'], ['bot', '-10', '42'], ['bot', '-10:topic:4', '42']]) {
      expect(store.take(data, bot!, chat!, sender!)).toBeNull()
    }
    expect(store.take(data.replace(/:0$/, ':7'), 'bot', '-10:topic:3', '42')).toBeNull()
    expect(store.take(`${data}:extra`, 'bot', '-10:topic:3', '42')).toBeNull()
    expect(store.take(data, 'bot', '-10:topic:3', '42')?.answer).toBe('A')
  })

  it('expires, invalidates typed answers, supersedes old questions and bounds retention', () => {
    let now = 0
    const store = new TelegramQuestions(() => now)
    const expired = store.create(binding, ['A', 'B'])[0]!.data
    now = 24 * 60 * 60 * 1000
    expect(store.take(expired, 'bot', '-10:topic:3', '42')).toBeNull()
    const typed = store.create(binding, ['A', 'B'])[0]!.data
    store.invalidate('bot', binding.incoming)
    expect(store.take(typed, 'bot', '-10:topic:3', '42')).toBeNull()
    const old = store.create(binding, ['A', 'B'])[0]!.data
    const newer = store.create(binding, ['C', 'D'])[0]!.data
    expect(store.take(old, 'bot', '-10:topic:3', '42')).toBeNull()
    for (let i = 0; i < 1000; i++) store.create({ ...binding, integrationId: String(i) }, ['A', 'B'])
    expect(store.take(newer, 'bot', '-10:topic:3', '42')).toBeNull()
  })
})
