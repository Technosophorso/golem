/**
 * [COMP:files/azure-client] Azure Blob GcsFilesClient implementation.
 *
 * The container surface is injected, so this asserts the GcsFilesClient
 * contract (bytes + mime round-trip, 404 → null, idempotent delete, append,
 * stat without download, SAS URLs, streaming writes, the Put Blob header) and
 * the env parsing against an in-memory fake — no storage account, no network.
 */

import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  AZURE_BLOB_WRITE_HEADERS,
  azureBlobOptionsFromEnv,
  createAzureBlobFilesClient,
  type AzureBlobContainer,
} from '../azure-blob-client.js'
import { buildStorageUri, parseStorageBucket, parseStorageKey } from '../gcs-client.js'

type Stored = { bytes: Buffer; mime: string; metadata: Record<string, string>; updatedAt: Date }

function fakeContainer(): AzureBlobContainer & { blobs: Map<string, Stored>; sasCalls: Array<{ key: string; permissions: string }> } {
  const blobs = new Map<string, Stored>()
  const sasCalls: Array<{ key: string; permissions: string }> = []
  return {
    blobs,
    sasCalls,
    async upload(key, bytes, o) {
      blobs.set(key, { bytes: Buffer.from(bytes), mime: o.mime, metadata: { ...o.metadata }, updatedAt: new Date('2026-09-24T00:00:00Z') })
    },
    async download(key) {
      const b = blobs.get(key)
      // The SDK hands metadata names back lower-cased; mirror that.
      return b ? { bytes: b.bytes, mime: b.mime, metadata: Object.fromEntries(Object.entries(b.metadata).map(([k, v]) => [k.toLowerCase(), v])) } : null
    },
    async head(key) {
      const b = blobs.get(key)
      return b ? { sizeBytes: b.bytes.byteLength, mime: b.mime, metadata: b.metadata, updatedAt: b.updatedAt } : null
    },
    async delete(key) {
      blobs.delete(key)
    },
    async sasUrl(key, o) {
      sasCalls.push({ key, permissions: o.permissions })
      return `https://acct.blob.core.windows.net/files/${key}?sp=${o.permissions}&se=${o.expiresOn.toISOString()}&sig=fake`
    },
    async uploadStream(key, stream, o) {
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      blobs.set(key, { bytes: Buffer.concat(chunks), mime: o.mime, metadata: { ...o.metadata }, updatedAt: new Date() })
    },
  }
}

const opts = { container: 'files', account: 'acct', accountKey: 'a2V5' }

function client(container = fakeContainer()) {
  return { c: createAzureBlobFilesClient(opts, { createContainer: async () => container }), container }
}

describe('[COMP:files/azure-client] createAzureBlobFilesClient', () => {
  it('round-trips raw binary bytes + mime + workspace metadata verbatim', async () => {
    const { c, container } = client()
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    await c.writeBlob('ws1/file-a', bytes, { workspaceId: 'ws1', createdByUserId: 'u1', mime: 'image/jpeg' })

    // Azure metadata names must be C# identifiers — no hyphens.
    expect(container.blobs.get('ws1/file-a')?.metadata).toEqual({ workspace_id: 'ws1', created_by_user_id: 'u1', mime: 'image/jpeg' })

    const blob = await c.readBlob('ws1/file-a')
    expect(blob).not.toBeNull()
    expect([...blob!.bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(blob!.mime).toBe('image/jpeg')
    expect(blob!.metadata).toEqual({ workspaceId: 'ws1', createdByUserId: 'u1', createdByAssistantId: undefined, mime: 'image/jpeg' })
  })

  it('returns null for a missing key (404 contract) on read and stat', async () => {
    const { c } = client()
    expect(await c.readBlob('ws1/missing')).toBeNull()
    expect(await c.statBlob('ws1/missing')).toBeNull()
  })

  it('stats size + mime without downloading', async () => {
    const { c } = client()
    await c.writeBlob('ws1/rec', Buffer.alloc(1234, 1), { workspaceId: 'ws1', mime: 'audio/webm' })
    expect(await c.statBlob('ws1/rec')).toEqual({ sizeBytes: 1234, mime: 'audio/webm', updatedAt: new Date('2026-09-24T00:00:00Z') })
  })

  it('appends by read-modify-write and keeps the original mime', async () => {
    const { c } = client()
    await c.writeBlob('ws1/log', Buffer.from('hello '), { workspaceId: 'ws1', mime: 'text/plain' })
    await c.appendBlob('ws1/log', Buffer.from('world'))
    const blob = await c.readBlob('ws1/log')
    expect(blob!.bytes.toString()).toBe('hello world')
    expect(blob!.mime).toBe('text/plain')
    expect(blob!.metadata.workspaceId).toBe('ws1')
    await expect(c.appendBlob('ws1/nope', Buffer.from('x'))).rejects.toThrow(/cannot append/)
  })

  it('deletes idempotently', async () => {
    const { c } = client()
    await c.writeBlob('ws1/gone', Buffer.from('x'), { workspaceId: 'ws1', mime: 'text/plain' })
    await c.deleteBlob('ws1/gone')
    await c.deleteBlob('ws1/gone')
    expect(await c.readBlob('ws1/gone')).toBeNull()
  })

  it('swallows a not-found error from the SDK on delete', async () => {
    const container = fakeContainer()
    container.delete = async () => {
      throw Object.assign(new Error('nope'), { statusCode: 404, code: 'BlobNotFound' })
    }
    const { c } = client(container)
    await expect(c.deleteBlob('ws1/x')).resolves.toBeUndefined()
  })

  it('mints read and create+write SAS URLs with the requested TTL', async () => {
    const { c, container } = client()
    const before = Date.now()
    const read = await c.signedReadUrl('ws1/f', 120)
    const write = await c.signedWriteUrl('ws1/f', { contentType: 'video/webm', ttlSec: 60 })
    expect(read).toMatch(/^https:\/\/acct\.blob\.core\.windows\.net\/files\/ws1\/f\?sp=r&/)
    expect(write).toMatch(/\?sp=cw&/)
    expect(container.sasCalls.map((s) => s.permissions)).toEqual(['r', 'cw'])
    const se = new Date(new URL(read).searchParams.get('se')!).getTime()
    expect(se - before).toBeGreaterThanOrEqual(120_000 - 50)
    expect(se - before).toBeLessThan(120_000 + 5_000)
  })

  it('exposes the Put Blob header a direct PUT to the write SAS needs', () => {
    const { c } = client()
    expect(c.signedWriteHeaders).toEqual({ 'x-ms-blob-type': 'BlockBlob' })
    expect(AZURE_BLOB_WRITE_HEADERS).toEqual({ 'x-ms-blob-type': 'BlockBlob' })
  })

  it('streams a writable straight into the container', async () => {
    const { c, container } = client()
    const dest = c.writeStream('ws1/stream', { mime: 'video/mp4', metadata: { workspaceId: 'ws1', mime: 'video/mp4' } })
    await pipeline(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), dest)
    // uploadStream resolves after the pipeline; give the fake a tick to settle.
    await new Promise((r) => setTimeout(r, 0))
    const stored = container.blobs.get('ws1/stream')
    expect(stored?.bytes.toString()).toBe('abcd')
    expect(stored?.mime).toBe('video/mp4')
    expect(stored?.metadata).toEqual({ workspace_id: 'ws1', mime: 'video/mp4' })
  })

  it('surfaces a container failure on the writable so pipeline() rejects', async () => {
    const { c } = client(Object.assign(fakeContainer(), { uploadStream: async () => { throw new Error('boom') } }))
    const dest = c.writeStream('ws1/bad', { mime: 'video/mp4' })
    await expect(pipeline(Readable.from([Buffer.from('x')]), dest)).rejects.toThrow(/boom/)
  })

  it('builds the container once across operations', async () => {
    let builds = 0
    const container = fakeContainer()
    const c = createAzureBlobFilesClient(opts, {
      createContainer: async () => {
        builds += 1
        return container
      },
    })
    await c.writeBlob('ws1/a', Buffer.from('a'), { workspaceId: 'ws1', mime: 'text/plain' })
    await c.readBlob('ws1/a')
    await c.statBlob('ws1/a')
    expect(builds).toBe(1)
  })
})

describe('[COMP:files/azure-client] azureBlobOptionsFromEnv', () => {
  it('is null when no container is named', () => {
    expect(azureBlobOptionsFromEnv({})).toBeNull()
    expect(azureBlobOptionsFromEnv({ AZURE_BLOB_CONTAINER: '  ', AZURE_STORAGE_ACCOUNT: 'a' })).toBeNull()
  })

  it('prefers a connection string', () => {
    expect(
      azureBlobOptionsFromEnv({
        AZURE_BLOB_CONTAINER: 'brian-files',
        AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net',
        AZURE_STORAGE_ACCOUNT: 'ignored',
      }),
    ).toEqual({
      container: 'brian-files',
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net',
    })
  })

  it('accepts account + key with an optional endpoint', () => {
    expect(
      azureBlobOptionsFromEnv({
        AZURE_BLOB_CONTAINER: 'files',
        AZURE_STORAGE_ACCOUNT: 'devstoreaccount1',
        AZURE_STORAGE_ACCOUNT_KEY: 'key==',
        AZURE_BLOB_ENDPOINT: 'http://127.0.0.1:10000/devstoreaccount1',
      }),
    ).toEqual({ container: 'files', account: 'devstoreaccount1', accountKey: 'key==', endpoint: 'http://127.0.0.1:10000/devstoreaccount1' })
  })

  it('fails closed on a half-configured deployment', () => {
    expect(() => azureBlobOptionsFromEnv({ AZURE_BLOB_CONTAINER: 'files' })).toThrow(/AZURE_STORAGE_ACCOUNT/)
    expect(() => azureBlobOptionsFromEnv({ AZURE_BLOB_CONTAINER: 'files', AZURE_STORAGE_ACCOUNT: 'a' })).toThrow(/AZURE_STORAGE_ACCOUNT/)
    expect(() => azureBlobOptionsFromEnv({ AZURE_BLOB_CONTAINER: 'Bad_Name', AZURE_STORAGE_ACCOUNT: 'a', AZURE_STORAGE_ACCOUNT_KEY: 'k' })).toThrow(/valid container name/)
  })
})

describe('[COMP:files/azure-client] az:// storage URIs', () => {
  it('composes and parses the az scheme like gs/s3', () => {
    const uri = buildStorageUri('brian-files', 'ws1', 'file-1', 'az')
    expect(uri).toBe('az://brian-files/ws1/file-1')
    expect(parseStorageBucket(uri)).toBe('brian-files')
    expect(parseStorageKey(uri)).toBe('ws1/file-1')
  })
})
