import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../client.js', () => ({
  query: vi.fn(),
}))

const templateMocks = vi.hoisted(() => ({ getById: vi.fn(), list: vi.fn() }))
vi.mock('../page-templates-store.js', () => ({ createDbPageTemplateStore: () => templateMocks }))

import {
  enqueueRecordingJob,
  claimNextRecordingJob,
  markRecordingJobFailed,
  markRecordingJobDone,
  RECORDING_JOB_MAX_ATTEMPTS,
} from '../recording-jobs-store.js'
import { query } from '../client.js'

const mockQuery = vi.mocked(query)

beforeEach(() => {
  vi.clearAllMocks()
  templateMocks.list.mockReset().mockResolvedValue([])
  templateMocks.getById.mockReset().mockResolvedValue(null)
})

describe('[COMP:recordings/recording-jobs-store] recording job queue', () => {
  it('enqueue returns the new job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'job-1' }] } as never)
    const res = await enqueueRecordingJob({ recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1' })
    expect(res).toEqual({ enqueued: true, jobId: 'job-1' })
  })

  it('enqueue is idempotent — ON CONFLICT DO NOTHING yields enqueued:false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = await enqueueRecordingJob({ recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1' })
    expect(res).toEqual({ enqueued: false, jobId: null })
  })

  it('resolves a starter name to the installed UUID before persisting a job', async () => {
    const id = '00000000-0000-4000-8000-000000000009'
    templateMocks.list.mockResolvedValue([{ id, workspaceId: 'ws-1', name: 'Meeting notes', extraction: { fields: [], capture: [] } }])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'job-1' }] } as never)
    await enqueueRecordingJob({ recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1', blueprintSlug: 'meeting-notes' })
    expect(templateMocks.list).toHaveBeenCalledWith('u-1', 'ws-1')
    expect(templateMocks.getById).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO recording_jobs'), ['rec-1', 'ws-1', 'u-1', id, null])
  })

  it('refuses a missing blueprint before any job insert', async () => {
    await expect(enqueueRecordingJob({ recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1', blueprintSlug: 'meeting-notes' })).rejects.toThrow(/listBlueprints/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('keeps ingest-only independent of blueprint lookups', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'job-1' }] } as never)
    await enqueueRecordingJob({ recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1', blueprintSlug: '   ' })
    expect(templateMocks.list).not.toHaveBeenCalled()
    expect(templateMocks.getById).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['rec-1', 'ws-1', 'u-1', null, null])
  })

  it('claim returns the mapped job or null when the queue is empty', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'job-1', recordingId: 'rec-1', workspaceId: 'ws-1', actingUserId: 'u-1', blueprintSlug: null, status: 'processing', attempts: 1, lastError: null },
      ],
    } as never)
    expect(await claimNextRecordingJob()).toMatchObject({ id: 'job-1', status: 'processing', attempts: 1 })

    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    expect(await claimNextRecordingJob()).toBeNull()
    expect(mockQuery.mock.calls[0]?.[0]).toContain("status = 'processing'")
    expect(mockQuery.mock.calls[0]?.[0]).toContain('worker lease expired after final attempt')
  })

  it('markFailed re-queues while attempts remain, parks at the cap', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ attempts: 1 }] } as never)
    expect(await markRecordingJobFailed('job-1', 'boom')).toEqual({ retrying: true })

    mockQuery.mockResolvedValueOnce({ rows: [{ attempts: RECORDING_JOB_MAX_ATTEMPTS }] } as never)
    expect(await markRecordingJobFailed('job-1', 'boom')).toEqual({ retrying: false })
  })

  it('markDone issues the update', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await markRecordingJobDone('job-1')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'done'"), ['job-1'])
  })
})
