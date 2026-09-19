import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute the real store SQL on the fixture transaction, never mock its rows.
vi.mock('../client.js', () => ({ query: vi.fn(), queryWithRLS: vi.fn(), getPool: vi.fn() }))
import { query } from '../client.js'
import { createTeamspaceStore } from '../teamspace-store.js'

const connectionString = process.env.TEAMSPACE_TEST_DATABASE_URL
const describeIf = connectionString ? describe : describe.skip
const store = createTeamspaceStore()
let pool: pg.Pool
let client: pg.PoolClient

describeIf('[COMP:api/teamspace-store] roster SQL against the migrated schema', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString })
    client = await pool.connect()
    vi.mocked(query).mockImplementation((sql, params) => client.query(sql, params))
  })

  afterAll(async () => {
    client?.release()
    await pool?.end()
    vi.resetAllMocks()
  })

  beforeEach(async () => { await client.query('BEGIN') })
  afterEach(async () => { await client.query('ROLLBACK') })

  async function fixture() {
    const users = (await client.query<{ id: string }>(
      `INSERT INTO users (auth_provider, auth_provider_id)
       SELECT 'test', 'teamspace-roster-' || gen_random_uuid()
       FROM generate_series(1, 3) RETURNING id`,
    )).rows.map(row => row.id)
    const [owner, member, outsider] = users
    const workspace = (await client.query<{ id: string }>(
      `INSERT INTO workspaces (name, purpose, owner_user_id, is_personal)
       VALUES ('Roster test', 'test', $1, false) RETURNING id`, [owner],
    )).rows[0].id
    await client.query(
      `INSERT INTO workspace_members
         (workspace_id, user_id, role, team_scope_mode, joined_at)
       VALUES ($1, $2, 'owner', 'assigned', '2026-01-01T00:00:00Z'),
              ($1, $3, 'member', 'assigned', '2026-01-02T00:00:00Z'),
              ($1, $4, 'member', 'assigned', '2026-01-03T00:00:00Z')`,
      [workspace, ...users],
    )
    return { workspace, owner, member, outsider }
  }

  it('reads a direct roster after adding a member, even with the linked branch present', async () => {
    const { workspace, owner, member } = await fixture()
    const teamspace = (await client.query<{ id: string }>(
      `INSERT INTO teamspaces (workspace_id, name, created_by)
       VALUES ($1, 'Direct roster', $2) RETURNING id`, [workspace, owner],
    )).rows[0].id
    await client.query(
      `INSERT INTO teamspace_members (teamspace_id, user_id, added_at)
       VALUES ($1, $2, '2026-02-01T00:00:00Z')`, [teamspace, owner],
    )
    await store.addMemberSystem(teamspace, member)
    const roster = await store.listMembersSystem(teamspace)
    expect(roster.map(row => row.userId)).toEqual([owner, member])
    expect(roster[0].addedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(roster[1].addedAt).toBeInstanceOf(Date)

    await store.addMemberSystem(teamspace, member)
    expect(await store.listMembersSystem(teamspace)).toEqual(roster)
  })

  it('reads a Team-derived roster using workspace join dates and effective grants', async () => {
    const { workspace, owner, member, outsider } = await fixture()
    const group = randomUUID()
    const compartment = `team:${group}`
    await client.query(
      `INSERT INTO workspace_groups
         (id, workspace_id, name, created_by, kind, key, compartment_key)
       VALUES ($1, $2, 'Roster team', $3, 'team', 'roster', $4)`,
      [group, workspace, owner, compartment],
    )
    await client.query(
      `INSERT INTO workspace_compartments
         (workspace_id, key, label, created_by, managed_by, managed_ref_id)
       VALUES ($1, $2, 'Roster team', $3, 'team', $4)`,
      [workspace, compartment, owner, group],
    )
    await client.query(
      `INSERT INTO workspace_group_compartment_grants (group_id, compartment_key, granted_by_user_id)
       VALUES ($1, $2, $3)`, [group, compartment, owner],
    )
    await client.query(
      'INSERT INTO workspace_group_members (group_id, user_id) VALUES ($1, $2)',
      [group, member],
    )
    const teamspace = (await client.query<{ id: string }>(
      `INSERT INTO teamspaces (workspace_id, name, created_by, workspace_group_id)
       VALUES ($1, 'Linked roster', $2, $3) RETURNING id`, [workspace, owner, group],
    )).rows[0].id
    const roster = await store.listMembersSystem(teamspace)
    expect(roster.map(row => [row.userId, row.addedAt.toISOString()])).toEqual([
      [owner, '2026-01-01T00:00:00.000Z'],
      [member, '2026-01-02T00:00:00.000Z'],
    ])
    expect(roster.some(row => row.userId === outsider)).toBe(false)
  })
})
