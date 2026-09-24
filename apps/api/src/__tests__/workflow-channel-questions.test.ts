import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { createChannelQuestionStore } from '../../../../packages/api/src/workflow/channel-questions.js'
import type { query } from '../../../../packages/api/src/db/client.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const address = { integrationId: id(1), workspaceId: id(2), assistantId: id(3), userId: id(4), channelId: '-100:topic:7' }
const question = { question: 'Which?', options: ['dev', 'prod'], actionId: 'external-action', version: 3, allowCustom: true, context: 'Authored context' }
const db = new PGlite()
const sql = ((text: string, params?: unknown[]) => db.query(text, params)) as typeof query
const store = createChannelQuestionStore(sql)

// Run the real migration + production SQL, not a simulated Map implementation.
describe('[COMP:workflow/channel-questions] durable SQL bindings', () => {
  before(async () => {
    for (const [table, n] of [['channel_integrations', 1], ['workspaces', 2], ['assistants', 3], ['users', 4]] as const) {
      await db.exec(`CREATE TABLE ${table} (id uuid PRIMARY KEY); INSERT INTO ${table} VALUES ('${id(n)}')`)
    }
    await db.exec(await readFile(new URL('../../../../packages/api/migrations/561_workflow_channel_questions.sql', import.meta.url), 'utf8'))
  })
  after(async () => { await db.close() })
  it('persists across store recreation, isolates every scope dimension and atomically consumes once', async () => {
    const token = await store.create({ ...address, question })
    assert.equal(token.length, 24)
    await store.attach(token, '42')
    const restored = createChannelQuestionStore(sql)
    const [row] = await restored.find(address, { messageId: '42' })
    assert.deepEqual(row.question, question)
    for (const field of ['integrationId', 'workspaceId', 'assistantId', 'userId', 'channelId'] as const) {
      assert.deepEqual(await restored.find({ ...address, [field]: field === 'channelId' ? '-100:topic:8' : id(9) }, { token }), [])
    }
    assert.deepEqual((await Promise.all([restored.consume(row, 'answer-1'), store.consume(row, 'answer-1')])).sort(), [false, true])
    assert.equal((await restored.find(address, { messageId: '42' })).length, 1, 'consumed explicit reply remains a tombstone')
    assert.equal((await restored.find(address, { answerMessageId: 'answer-1' })).length, 1, 'unthreaded webhook replay remains bound')
    assert.equal((await restored.find(address, {})).length, 0)
  })
  it('rejects expired and unattached rows without losing their explicit reply tombstone', async () => {
    const token = await store.create({ ...address, question })
    assert.deepEqual(await store.find(address, { token }), [])
    await store.attach(token, '43')
    await db.query("UPDATE workflow_channel_questions SET expires_at=now()-interval '1 second' WHERE token=$1", [token])
    const [row] = await store.find(address, { messageId: '43' })
    assert.equal(await store.consume(row), false)
    assert.deepEqual(await store.find(address, {}), [])
    assert.equal(await store.isQuestionMessage(address.integrationId, address.channelId, '43'), true)
    assert.equal(await store.isQuestionMessage(address.integrationId, '-100:topic:8', '43'), false)
  })
})
