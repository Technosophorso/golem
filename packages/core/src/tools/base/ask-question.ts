import { z } from 'zod'
import { buildTool } from '../types.js'

/**
 * askQuestion tool — used when the model needs to ask the user for clarification.
 * Returns the question text, which the query loop surfaces to the user.
 * The user's response comes as the next message in the conversation.
 */
export type AssistantQuestion = z.infer<typeof askQuestionSchema>

export const askQuestionSchema = z.object({
  question: z.string().trim().min(1).describe('The question to ask the user'),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(8)
    .refine((labels) => new Set(labels).size === labels.length, 'Options must be distinct')
    .optional().describe('Optional single-choice suggestions; the user can also type an answer'),
})

export const askQuestionTool = buildTool({
  name: 'askQuestion',
  description: 'Ask the user a question when you need clarification before proceeding. Only use when the answer genuinely changes what you would do.',
  inputSchema: askQuestionSchema,
  isConcurrencySafe: true,
  isReadOnly: true,

  async execute(input) {
    // The question text is returned as the tool result.
    // The query loop will recognize this and include it in the response.
    return { data: `[Question for user]: ${input.question}` }
  },
})

/** Every delivery surface can render this fallback; no interactive renderer is required. */
export function formatAssistantQuestion(question: AssistantQuestion): string {
  const options = question.options?.map((label, index) => `${index + 1}. ${label}`) ?? []
  return [question.question, ...options].join('\n')
}
