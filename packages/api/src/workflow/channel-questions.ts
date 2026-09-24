import { randomBytes } from 'node:crypto'
import type { AssistantQuestion, DeliverToChannel } from '@use-brian/core'
import { query } from '../db/client.js'

type ResponseBinding = NonNullable<Parameters<DeliverToChannel>[0]['questionResponse']>
export type ChannelQuestion = {
  token: string
  integrationId: string
  workspaceId: string
  assistantId: string
  userId: string
  channelId: string
  messageId: string | null
  available?: boolean
  question: AssistantQuestion
  response?: ResponseBinding
}
export type QuestionAddress = Pick<ChannelQuestion, 'integrationId' | 'workspaceId' | 'assistantId' | 'userId' | 'channelId'>

/** Topic-qualified channelId is part of every lookup, never just the physical chat. */
export function createChannelQuestionStore(runQuery: typeof query = query) {
  return {
    async create(input: Omit<ChannelQuestion, 'token' | 'messageId'>) {
      const token = randomBytes(18).toString('base64url')
      await runQuery(`INSERT INTO workflow_channel_questions
        (token, integration_id, workspace_id, assistant_id, user_id, channel_id, question, response)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [token, input.integrationId, input.workspaceId, input.assistantId, input.userId,
        input.channelId, JSON.stringify(input.question), input.response ? JSON.stringify(input.response) : null])
      return token
    },
    async attach(token: string, messageId: string) {
      await runQuery('UPDATE workflow_channel_questions SET message_id=$2 WHERE token=$1 AND message_id IS NULL', [token, messageId])
    },
    async find(address: QuestionAddress, selector: { token?: string; messageId?: string; answerMessageId?: string }) {
      // Explicit replies also return expired/consumed tombstones so they NEVER
      // become unrestricted chat. Unthreaded typing is accepted only unambiguously.
      const result = await runQuery<ChannelQuestion>(`SELECT token,
        integration_id AS "integrationId", workspace_id AS "workspaceId",
        assistant_id AS "assistantId", user_id AS "userId", channel_id AS "channelId",
        message_id AS "messageId", question, response,
        (consumed_at IS NULL AND expires_at > now()) AS available
        FROM workflow_channel_questions
        WHERE integration_id=$1 AND channel_id=$2 AND workspace_id=$3 AND assistant_id=$4 AND user_id=$5
        AND message_id IS NOT NULL
        AND CASE WHEN $6::text IS NOT NULL THEN token=$6
                 WHEN $7::text IS NOT NULL THEN message_id=$7
                 ELSE answer_message_id=$8 OR (consumed_at IS NULL AND expires_at > now()) END
        ORDER BY created_at DESC LIMIT 2`,
      [address.integrationId, address.channelId, address.workspaceId, address.assistantId, address.userId,
        selector.token ?? null, selector.messageId ?? null, selector.answerMessageId ?? null])
      return result.rows
    },
    async isQuestionMessage(integrationId: string, channelId: string, messageId: string) {
      const result = await runQuery(`SELECT 1 FROM workflow_channel_questions
        WHERE integration_id=$1 AND channel_id=$2 AND message_id=$3`, [integrationId, channelId, messageId])
      return result.rows.length > 0
    },
    async consume(binding: ChannelQuestion, answerMessageId?: string) {
      const result = await runQuery(`UPDATE workflow_channel_questions SET consumed_at=now(), answer_message_id=$8
        WHERE token=$1 AND integration_id=$2 AND channel_id=$3 AND message_id=$4
        AND workspace_id=$5 AND assistant_id=$6 AND user_id=$7
        AND consumed_at IS NULL AND expires_at > now() RETURNING token`,
      [binding.token, binding.integrationId, binding.channelId, binding.messageId,
        binding.workspaceId, binding.assistantId, binding.userId, answerMessageId ?? null])
      return result.rows.length === 1
    },
  }
}
export type ChannelQuestionStore = ReturnType<typeof createChannelQuestionStore>
export const workflowQuestionActions = (token: string, question: AssistantQuestion) =>
  question.options?.map((label, index) => ({ id: String(index), label, data: `wq:${token}:${index}` }))

/** No webhook tool names or LLM inference: only the immutable authored binding. */
export async function handleChannelQuestionReply(params: {
  store: ChannelQuestionStore
  address: QuestionAddress
  callback?: { data: string; messageId: string }
  replyToMessageId?: string
  referenceToken?: string
  answerMessageId?: string
  text: string
  authorized: () => Promise<boolean>
  dispatch: (binding: ChannelQuestion, answer: string, claim: () => Promise<boolean>) => Promise<string>
}): Promise<string | null> {
  const { store, address, callback } = params
  const match = callback && /^wq:([\w-]{24}):([0-7])$/.exec(callback.data)
  if (callback && !match) return 'This question is unavailable.'
  const rows = await store.find(address, { token: match?.[1] ?? params.referenceToken, messageId: params.replyToMessageId, answerMessageId: params.answerMessageId })
  if (rows.length !== 1) {
    if (callback || params.referenceToken || rows.length > 1 || (params.replyToMessageId
      && await store.isQuestionMessage(address.integrationId, address.channelId, params.replyToMessageId))) {
      return 'This question is unavailable or ambiguous. Reply to the original question from the authorized account.'
    }
    return null
  }
  const binding = rows[0]!
  if ((params.referenceToken && binding.messageId !== params.replyToMessageId)
    || (callback && binding.messageId !== callback.messageId)) return 'This question is unavailable.'
  if (!await params.authorized()) return 'You are not authorized to answer this question.'
  const answer = match ? binding.question.options?.[Number(match[2])] : params.text.trim()
  if (!answer || answer.length > 8000) return 'Please provide a valid answer.'
  if (binding.question.allowCustom === false && !binding.question.options?.includes(answer)) {
    return 'Please choose one of the listed options.'
  }
  if (binding.available === false) return 'This question has expired or was already answered.'
  if (!binding.response) return 'This workflow question has no response action configured. No action was run; ask the workflow author to configure it.'
  try { return await params.dispatch(binding, answer, () => store.consume(binding, params.answerMessageId)) }
  catch { return 'The answer could not be processed. No automatic retry will run; check the action status before requesting a new question.' }
}
