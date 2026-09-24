/**
 * [COMP:api/association-media] Website media library routes.
 *
 * Staff list/upload/delete behind workspace role; the integration read serves
 * one file by id as a redirect to the storage backend's signed URL, or the
 * bytes when the backend has no HTTP URL. Stores, files API and blob clients
 * are in-memory fakes.
 */

import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { Writable } from 'node:stream'
import { createTestApp } from './helpers.js'
import { sendWebsiteMedia, websiteMediaMemberRoutes, type WebsiteMediaDeps } from '../association-media.js'
import type { WebsiteMediaFile, WebsiteMediaStore } from '../../db/website-media-store.js'
import { createWebsiteMediaStore, WEBSITE_MEDIA_PREFIX } from '../../db/website-media-store.js'
import type { GcsFilesClient } from '../../files/gcs-client.js'
import type { FilesClientResolver } from '../../files/files-api.js'

const WS = '11111111-1111-4111-8111-111111111111'
const FILE = '22222222-2222-4222-8222-222222222222'

function blobClient(signed: string, bytes = Buffer.from([0xff, 0xd8])): GcsFilesClient {
  return {
    async writeBlob() {}, async appendBlob() {},
    async readBlob() { return { bytes, mime: 'image/jpeg', metadata: { workspaceId: WS, mime: 'image/jpeg' } } },
    async statBlob() { return null }, async deleteBlob() {},
    signedReadUrl: vi.fn(async () => signed),
    async signedWriteUrl() { return signed },
    writeStream() { return new Writable({ write(_c, _e, cb) { cb() } }) },
  }
}

function fixture(role = 'owner', signed = 'https://acct.blob.core.windows.net/files/x?sig=1') {
  const files = new Map<string, WebsiteMediaFile>()
  const store: WebsiteMediaStore = {
    async list() { return [...files.values()] },
    async get(_ws, id) { return files.get(id) ?? null },
  }
  const client = blobClient(signed)
  const resolver: FilesClientResolver = {
    async forWorkspace() { return { gcs: client, bucket: 'files', uriScheme: 'az' } },
    forUri: vi.fn(async () => client),
  }
  const writeBytes = vi.fn(async (_ctx: unknown, params: { path: string; mime: string; bytes: Uint8Array; title?: string }) => {
    const file: WebsiteMediaFile = { id: FILE, name: params.path.split('/').pop()!, title: params.title ?? null, mime: params.mime,
      sizeBytes: params.bytes.length, storageUri: `az://files/${WS}/${FILE}`, updatedAt: '2026-09-24T00:00:00.000Z' }
    files.set(FILE, file)
    return { ok: true as const, value: { id: FILE } }
  })
  const del = vi.fn(async () => { files.delete(FILE); return { ok: true as const, value: { id: FILE, path: '' } } })
  const deps = {
    store, resolver,
    filesApi: { writeBytes, delete: del } as unknown as WebsiteMediaDeps['filesApi'],
    membership: async () => ({ role, clearance: 'internal' as const }),
  } satisfies WebsiteMediaDeps
  const app = createTestApp('/api/crm/:workspaceId/association/media', websiteMediaMemberRoutes(deps), { userId: 'u1' })
  return { app, deps, files, writeBytes, del, client, resolver }
}

describe('[COMP:api/association-media] staff routes', () => {
  it('uploads an image under the website media prefix and lists it without the storage URI', async () => {
    const { app, writeBytes } = fixture()
    const up = await request(app).post(`/api/crm/${WS}/association/media`)
      .attach('files', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'hero photo.jpg', contentType: 'image/jpeg' })
    expect(up.status).toBe(201)
    expect(up.body.results[0].media).toMatchObject({ id: FILE, name: 'hero photo.jpg', mime: 'image/jpeg', sizeBytes: 3 })
    expect(writeBytes.mock.calls[0][1].path).toMatch(new RegExp(`^${WEBSITE_MEDIA_PREFIX}[0-9a-f-]{36}-hero photo\\.jpg$`))
    const list = await request(app).get(`/api/crm/${WS}/association/media`)
    expect(list.status).toBe(200)
    expect(list.body.media).toHaveLength(1)
    expect(JSON.stringify(list.body)).not.toContain('az://')
  })

  it('refuses types a website must not serve, including SVG', async () => {
    const { app, writeBytes } = fixture()
    const res = await request(app).post(`/api/crm/${WS}/association/media`)
      .attach('files', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' })
    expect(res.status).toBe(400)
    expect(res.body.results[0].error).toBe('unsupported_type')
    expect(writeBytes).not.toHaveBeenCalled()
  })

  it('lets members list but only owners and admins upload or delete', async () => {
    const { app } = fixture('member')
    expect((await request(app).get(`/api/crm/${WS}/association/media`)).status).toBe(200)
    const up = await request(app).post(`/api/crm/${WS}/association/media`)
      .attach('files', Buffer.from([1]), { filename: 'a.png', contentType: 'image/png' })
    expect(up.status).toBe(403)
    expect((await request(app).delete(`/api/crm/${WS}/association/media/${FILE}`)).status).toBe(403)
  })

  it('deletes a library file and 404s an unknown one', async () => {
    const { app, del } = fixture()
    await request(app).post(`/api/crm/${WS}/association/media`)
      .attach('files', Buffer.from([1]), { filename: 'a.png', contentType: 'image/png' })
    expect((await request(app).delete(`/api/crm/${WS}/association/media/${FILE}`)).status).toBe(200)
    expect(del).toHaveBeenCalledOnce()
    expect((await request(app).delete(`/api/crm/${WS}/association/media/${FILE}`)).status).toBe(404)
  })

  it('returns a signed preview URL for staff', async () => {
    const { app } = fixture('member') // its own empty store
    const owner = fixture()
    await request(owner.app).post(`/api/crm/${WS}/association/media`)
      .attach('files', Buffer.from([1]), { filename: 'a.png', contentType: 'image/png' })
    const res = await request(owner.app).get(`/api/crm/${WS}/association/media/${FILE}/url`)
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^https:\/\//)
    expect(res.headers['cache-control']).toBe('no-store')
    expect((await request(app).get(`/api/crm/${WS}/association/media/${FILE}/url`)).status).toBe(404)
  })

  it('404s a non-member', async () => {
    const { deps } = fixture()
    const app = createTestApp('/api/crm/:workspaceId/association/media',
      websiteMediaMemberRoutes({ ...deps, membership: async () => null }), { userId: 'u1' })
    expect((await request(app).get(`/api/crm/${WS}/association/media`)).status).toBe(404)
  })
})

describe('[COMP:api/association-media] sendWebsiteMedia', () => {
  const file: WebsiteMediaFile = { id: FILE, name: 'a.jpg', title: 'a.jpg', mime: 'image/jpeg', sizeBytes: 2,
    storageUri: `az://files/${WS}/${FILE}`, updatedAt: '2026-09-24T00:00:00.000Z' }
  const serve = (deps: Parameters<typeof sendWebsiteMedia>[1]) => {
    const app = express()
    app.get('/m/:id', (req, res) => { void sendWebsiteMedia(res, deps, WS, req.params.id) })
    return app
  }

  it('redirects to the signed URL of the recorded backend, keyed from storage_uri', async () => {
    const { resolver, client } = fixture()
    const res = await request(serve({ store: { list: async () => [file], get: async () => file }, resolver })).get(`/m/${FILE}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/blob\.core\.windows\.net/)
    expect(res.headers['cache-control']).toBe('private, max-age=600')
    expect(resolver.forUri).toHaveBeenCalledWith(WS, file.storageUri)
    expect(client.signedReadUrl).toHaveBeenCalledWith(`${WS}/${FILE}`, 3600)
  })

  it('streams bytes when the backend has no HTTP signed URL', async () => {
    const { resolver } = fixture('owner', `file:///var/lib/brian/files/${WS}/${FILE}`)
    const res = await request(serve({ store: { list: async () => [file], get: async () => file }, resolver })).get(`/m/${FILE}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect([...res.body]).toEqual([0xff, 0xd8])
  })

  it('404s anything the store does not return', async () => {
    const { resolver } = fixture()
    const res = await request(serve({ store: { list: async () => [], get: async () => null }, resolver })).get(`/m/${FILE}`)
    expect(res.status).toBe(404)
  })
})

describe('[COMP:api/association-media] createWebsiteMediaStore', () => {
  it('pins reads to the prefix, the MIME allow-list, the workspace and live rows', async () => {
    const run = vi.fn(async () => ({ rows: [] })) as unknown as Parameters<typeof createWebsiteMediaStore>[0]
    const store = createWebsiteMediaStore(run)
    expect(await store.get(WS, 'not-a-uuid')).toBeNull()
    expect(run).not.toHaveBeenCalled()
    await store.get(WS, FILE)
    const [sql, params] = (run as unknown as { mock: { calls: [string, unknown[]][] } }).mock.calls[0]
    expect(sql).toMatch(/workspace_id = \$1/)
    expect(sql).toMatch(/valid_to IS NULL AND retracted_at IS NULL AND path LIKE \$2 AND mime = ANY/)
    expect(params).toEqual([WS, `${WEBSITE_MEDIA_PREFIX}%`, expect.not.arrayContaining(['image/svg+xml']), FILE])
  })
})
