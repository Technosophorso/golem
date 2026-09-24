import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { buildTool, type ToolContext } from '@use-brian/core'
import { handleChannelQuestionReply, workflowQuestionActions, type ChannelQuestion, type ChannelQuestionStore } from '../channel-questions.js'
import { dispatchQuestionResponse } from '../question-response.js'

const binding: ChannelQuestion = {
  token: 'a'.repeat(24), integrationId: 'integration', channelId: '-100:topic:7', messageId: '42',
  workspaceId: 'workspace', assistantId: 'assistant', userId: 'user',
  question: { question: 'Which environment?', options: ['dev', 'prod'], allowCustom: true,
    actionId: 'action-9', version: 3, context: 'Workflow-authored context' },
  response: { toolName: 'answer_action', arguments: { action_id: 'action-9', version: 3 }, answerField: 'answer' },
}
function fixture(overrides: Partial<ChannelQuestion> = {}) {
  const row = { ...binding, ...overrides }
  let consumed = false
  const store: ChannelQuestionStore = {
    create: vi.fn(), attach: vi.fn(), isQuestionMessage: vi.fn(async () => true),
    find: vi.fn(async (address) => Object.entries(address).every(([k, v]) => row[k as keyof ChannelQuestion] === v) ? [row] : []),
    consume: vi.fn(async () => { if (consumed) return false; consumed = true; return true }),
  }
  const params = { store, address: { integrationId: row.integrationId, channelId: row.channelId,
    workspaceId: row.workspaceId, assistantId: row.assistantId, userId: row.userId },
  text: 'test', replyToMessageId: '42', authorized: vi.fn(async () => true), dispatch: vi.fn(async (_binding: ChannelQuestion, _answer: string, claim: () => Promise<boolean>) => await claim() ? 'sent' : 'This question has expired or was already answered.') }
  return { row, store, params }
}

describe('[COMP:workflow/channel-questions] bound replies', () => {
  it('uses opaque callback data and routes the selected answer with the full original context', async () => {
    const { params, row } = fixture()
    const actions = workflowQuestionActions(row.token, row.question)!
    expect(actions[0].data).toBe(`wq:${row.token}:0`)
    expect(actions[0].data).not.toContain('action-9')
    expect(await handleChannelQuestionReply({ ...params, callback: { data: actions[1].data, messageId: '42' } })).toBe('sent')
    expect(params.dispatch).toHaveBeenCalledWith(row, 'prod', expect.any(Function))
    expect(await handleChannelQuestionReply({ ...params, callback: { data: actions[1].data, messageId: '42' } })).toContain('already answered')
    expect(params.dispatch).toHaveBeenCalledTimes(2)
  })
  it('routes typed custom text unchanged rather than interpreting it or inferring approval', async () => {
    const { params, row } = fixture()
    expect(await handleChannelQuestionReply(params)).toBe('sent')
    expect(params.dispatch).toHaveBeenCalledWith(row, 'test', expect.any(Function))
  })
  it.each(['integrationId', 'channelId', 'workspaceId', 'assistantId', 'userId'] as const)('isolates %s without consuming', async (key) => {
    const { params, store } = fixture()
    expect(await handleChannelQuestionReply({ ...params, address: { ...params.address, [key]: 'other' } })).toContain('unavailable')
    expect(store.consume).not.toHaveBeenCalled()
    expect(params.dispatch).not.toHaveBeenCalled()
  })
  it('rejects revoked membership, stale messages, expired questions, invalid choices and disallowed custom text', async () => {
    const { params, store } = fixture()
    params.authorized.mockResolvedValueOnce(false)
    expect(await handleChannelQuestionReply(params)).toContain('not authorized')
    expect(store.consume).not.toHaveBeenCalled()
    expect(await handleChannelQuestionReply({ ...params, callback: { data: `wq:${binding.token}:0`, messageId: 'wrong' } })).toContain('unavailable')
    expect(await handleChannelQuestionReply({ ...params, callback: { data: `wq:${binding.token}:7`, messageId: '42' } })).toContain('valid answer')
    vi.mocked(store.consume).mockResolvedValueOnce(false)
    expect(await handleChannelQuestionReply(params)).toContain('expired')
    const closed = fixture({ question: { ...binding.question, allowCustom: false } })
    expect(await handleChannelQuestionReply(closed.params)).toContain('listed options')
    expect(closed.store.consume).not.toHaveBeenCalled()
  })
  it('fails closed for a quoted opaque reference if send succeeded but binding attachment did not', async () => {
    const { params, store } = fixture()
    vi.mocked(store.find).mockResolvedValueOnce([])
    vi.mocked(store.isQuestionMessage).mockResolvedValueOnce(false)
    expect(await handleChannelQuestionReply({ ...params, referenceToken: binding.token })).toContain('unavailable')
    expect(params.dispatch).not.toHaveBeenCalled()
  })

  it('never falls back to chat for missing response configuration or ambiguous questions', async () => {
    const { params, store } = fixture({ response: undefined })
    expect(await handleChannelQuestionReply(params)).toContain('no response action')
    expect(params.dispatch).not.toHaveBeenCalled()
    vi.mocked(store.find).mockResolvedValueOnce([binding, binding])
    expect(await handleChannelQuestionReply({ ...params, replyToMessageId: undefined })).toContain('ambiguous')
  })
})

describe('[COMP:workflow/channel-questions] deterministic response action', () => {
  const context: ToolContext = { userId: 'user', assistantId: 'assistant', sessionId: 'question:token',
    workspaceId: 'workspace', appId: 'Use Brian', channelType: 'telegram', channelId: '-100:topic:7', abortSignal: new AbortController().signal }
  function registry() {
    const execute = vi.fn(async () => ({ data: 'secret backend output' }))
    const submit = vi.fn(async () => ({ data: 'wrong' }))
    const tool = buildTool({ name: 'answer_action', description: '', inputSchema: z.object({ action_id: z.string(), version: z.number(), answer: z.string() }),
      isConcurrencySafe: false, isReadOnly: false, requiresConfirmation: false, execute })
    return { tool, execute, submit, tools: new Map([['answer_action', tool], ['submit_change', { ...tool, name: 'submit_change', execute: submit }]]) }
  }
  it('calls only the authored tool once with fixed action/version and literal custom answer; exposes no backend payload', async () => {
    const { tools, execute, submit } = registry()
    expect(await dispatchQuestionResponse(binding, 'test', tools, context, async () => true)).toBe('Your answer was sent.')
    expect(execute).toHaveBeenCalledExactlyOnceWith({ action_id: 'action-9', version: 3, answer: 'test' }, expect.objectContaining({ channelId: '-100:topic:7' }))
    expect(submit).not.toHaveBeenCalled()
  })
  it('does not consume Ask answers and permits an explicit retry after policy becomes Allow', async () => {
    const { tool, tools, execute } = registry()
    const { params, store } = fixture()
    tool.requiresConfirmation = true // remote adapter's default; live policy overrides it
    tool.resolveConfirmation = async () => true
    const dispatch = (row: ChannelQuestion, answer: string, claim: () => Promise<boolean>) => dispatchQuestionResponse(row, answer, tools, context, claim)
    expect(await handleChannelQuestionReply({ ...params, dispatch })).toContain('question remains open')
    expect(store.consume).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    tool.resolveConfirmation = async () => false
    expect(await handleChannelQuestionReply({ ...params, dispatch })).toBe('Your answer was sent.')
    expect(store.consume).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each(['ask', 'blocked', 'policy-error', 'invalid-input'] as const)('fails closed for %s; never calls submit_change', async (policy) => {
    const { tool, tools, execute, submit } = registry()
    if (policy === 'ask') tool.resolveConfirmation = async () => true
    if (policy === 'blocked') tools.delete('answer_action')
    if (policy === 'policy-error') tool.resolveConfirmation = async () => { throw new Error('secret') }
    const row = policy === 'invalid-input' ? { ...binding, response: { ...binding.response!, arguments: { version: 'bad' } } } : binding
    expect(await dispatchQuestionResponse(row, 'test', tools, context, async () => true)).not.toBe('Your answer was sent.')
    expect(execute).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})
