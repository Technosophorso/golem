import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from '@use-brian/channels'

export type QuestionBinding = {
  integrationId: string
  assistantId: string
  userId: string
  incoming: IncomingMessage
}

/** Process-local convenience UI. Missing state always falls back to typed answers. */
export class TelegramQuestions {
  private readonly pending = new Map<string, QuestionBinding & { options: string[]; expires: number }>()
  constructor(private readonly now = Date.now) {}

  invalidate(integrationId: string, incoming: IncomingMessage): void {
    for (const [token, item] of this.pending) {
      if (item.expires <= this.now() || (item.integrationId === integrationId
        && item.incoming.channelId === incoming.channelId && item.incoming.userId === incoming.userId)) {
        this.pending.delete(token)
      }
    }
  }

  create(binding: QuestionBinding, options: string[]) {
    this.invalidate(binding.integrationId, binding.incoming)
    while (this.pending.size >= 1000) this.pending.delete(this.pending.keys().next().value!)
    const token = randomBytes(12).toString('base64url')
    this.pending.set(token, { ...binding, options: [...options], expires: this.now() + 24 * 60 * 60 * 1000 })
    return options.map((label, index) => ({ id: String(index), label, data: `ask:${token}:${index}` }))
  }

  take(data: string, integrationId: string, chatId: string, senderId: string) {
    const match = /^ask:([\w-]{16}):([0-7])$/.exec(data)
    if (!match) return null
    const item = this.pending.get(match[1])
    if (!item) return null
    if (item.expires <= this.now()) {
      this.pending.delete(match[1])
      return null
    }
    if (item.integrationId !== integrationId || item.incoming.channelId !== chatId
      || item.incoming.userId !== senderId || item.options[Number(match[2])] === undefined) return null
    this.pending.delete(match[1]) // consume before any async authorization or delivery
    return { ...item, answer: item.options[Number(match[2])]! }
  }
}
