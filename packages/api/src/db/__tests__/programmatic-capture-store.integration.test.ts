import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute the store's SQL on one connection with temporary relations. No
// application tables are changed; this tests SQL resolution, not RLS policy.
const db = vi.hoisted(() => ({ query: vi.fn(), queryWithRLS: vi.fn() }))
vi.mock('../client.js', () => db)
import { createProgrammaticCaptureStore } from '../programmatic-capture-store.js'

const connectionString = process.env.PROGRAMMATIC_CAPTURE_TEST_DATABASE_URL
const describeIf = connectionString ? describe : describe.skip
const client = connectionString ? new pg.Client({ connectionString }) : null
const userId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const otherWorkspaceId = '33333333-3333-4333-8333-333333333333'
const store = createProgrammaticCaptureStore()

describeIf('[COMP:api/programmatic-capture] PostgreSQL rule projections', () => {
  beforeAll(async () => {
    await client!.connect()
    await client!.query(`
      CREATE TEMP TABLE programmatic_capture_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
        name text NOT NULL, partition_by text NOT NULL, enabled boolean NOT NULL,
        created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TEMP TABLE ingest_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connector_instance_id uuid,
        capture_profile_id uuid, source text, rule_order integer, filter_type text,
        filter_params jsonb, routing_mode text, routing_schedule text,
        routing_timezone text, alert boolean, episode_sensitivity text,
        compartments text[], project_ids uuid[]
      );
      CREATE TEMP TABLE assistants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid,
        capture_profile_id uuid, created_at timestamptz DEFAULT now(),
        name text DEFAULT 'Capture assistant', clearance text DEFAULT 'internal',
        default_compartments text[] DEFAULT '{}', default_project_id uuid
      );
      CREATE TEMP TABLE workspaces (
        id uuid PRIMARY KEY, owner_user_id uuid
      );
    `)
    db.query.mockImplementation((sql, params) => client!.query(sql, params))
    db.queryWithRLS.mockImplementation((_userId, sql, params) => client!.query(sql, params))
  })

  beforeEach(async () => {
    await client!.query('TRUNCATE pg_temp.ingest_rules, pg_temp.assistants, pg_temp.programmatic_capture_profiles, pg_temp.workspaces')
  })

  afterAll(async () => { await client?.end() })

  async function createProfile(workspace = workspaceId) {
    return store.createProfile({
      actingUserId: userId, workspaceId: workspace, name: 'Capture test', partitionBy: 'session', enabled: true,
    })
  }

  it('lists an empty workspace without a SQL parse error', async () => {
    await expect(store.listProfiles(userId, workspaceId)).resolves.toEqual([])
  })

  it('lists each profile with its own ordered rules and assistant assignments', async () => {
    const profile = await createProfile()
    const secondProfile = await createProfile()
    const outside = await createProfile(otherWorkspaceId)
    const later = await store.addRule({
      actingUserId: userId, workspaceId, profileId: profile.id,
      rule: { filterType: 'always', routingMode: 'drop', ruleOrder: 2 },
    })
    const earlier = await store.addRule({
      actingUserId: userId, workspaceId, profileId: profile.id,
      rule: { filterType: 'role_match', filterParams: { values: ['user'] }, routingMode: 'realtime', ruleOrder: 1 },
    })
    await store.addRule({
      actingUserId: userId, workspaceId: otherWorkspaceId, profileId: outside.id,
      rule: { filterType: 'always', routingMode: 'drop' },
    })
    const assistant = (await client!.query(
      'INSERT INTO assistants (workspace_id, capture_profile_id) VALUES ($1, $2) RETURNING id',
      [workspaceId, profile.id],
    )).rows[0]!

    const profiles = await store.listProfiles(userId, workspaceId)
    expect(profiles).toHaveLength(2)
    expect(profiles.find((entry) => entry.id === profile.id)).toMatchObject({
      assistantIds: [assistant.id], rules: [earlier, later],
    })
    expect(profiles.find((entry) => entry.id === secondProfile.id)).toMatchObject({ assistantIds: [], rules: [] })
    expect(earlier!.id).not.toBe(profile.id)
    expect(earlier!.profileId).toBe(profile.id)

    await expect(store.updateProfile({
      actingUserId: userId, workspaceId, profileId: profile.id,
      name: 'Updated capture', partitionBy: 'connection', enabled: true,
    })).resolves.toMatchObject({ id: profile.id, name: 'Updated capture', rules: [earlier, later] })
    await client!.query('INSERT INTO workspaces (id, owner_user_id) VALUES ($1, $2)', [workspaceId, userId])
    await expect(store.resolveTargetSystem({
      workspaceId, assistantId: assistant.id, overrideProfileId: null,
    })).resolves.toMatchObject({ profileId: profile.id, partitionBy: 'connection', rules: [earlier, later] })
  })

  it('updates and returns the rule id while retaining workspace isolation', async () => {
    const profile = await createProfile()
    const rule = await store.addRule({
      actingUserId: userId, workspaceId, profileId: profile.id,
      rule: { filterType: 'always', routingMode: 'drop' },
    })
    const update = {
      actingUserId: userId, workspaceId, profileId: profile.id, ruleId: rule!.id,
      rule: { filterType: 'always', routingMode: 'realtime' as const, ruleOrder: 0 },
    }
    await expect(store.updateRule({ ...update, workspaceId: otherWorkspaceId })).resolves.toBeNull()
    await expect(store.updateRule(update)).resolves.toMatchObject({
      id: rule!.id, profileId: profile.id, routingMode: 'realtime', compartments: [], projectIds: [],
    })
    const profiles = await store.listProfiles(userId, workspaceId)
    expect(profiles[0]!.rules[0]!.routingMode).toBe('realtime')
  })
})
