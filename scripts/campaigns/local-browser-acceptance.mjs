/**
 * Disposable native-campaign browser acceptance.
 *
 * Boots the real OSS API and app-web plus the platform marketing and Studio
 * Next.js apps against an isolated PostgreSQL 18 fixture. Chromium maps the
 * synthetic *.campaign.test hosts to loopback, so a first-party cookie can be
 * checked across sibling sites without editing /etc/hosts.
 * [COMP:campaigns/browser-acceptance]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createLocalFixture } from '../crm/local-fixture.mjs'

const ossRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const platformRoot = resolve(ossRoot, '..')
const evidenceDir = join(ossRoot, 'docs/plans/native-campaigns-and-attribution-evidence')
const ports = { api: 4100, marketing: 3100, studio: 3102, feed: 3103 }
const hosts = {
  api: `http://api.campaign.test:${ports.api}`,
  marketing: `http://marketing.campaign.test:${ports.marketing}`,
  studio: `http://studio.campaign.test:${ports.studio}`,
  feed: `http://feed.campaign.test:${ports.feed}`,
}
const children = []
const session = 'campaign-native-acceptance'
const browserArgs = '--host-resolver-rules=MAP *.campaign.test 127.0.0.1,EXCLUDE localhost'

function fail(message) { throw new Error(message) }
function assert(value, message) { if (!value) fail(message) }

function start(label, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const collect = (chunk) => { output = `${output}${chunk}`.slice(-80_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once('exit', (code) => { if (code && !child.killed) console.error(`[${label}] exited ${code}\n${output}`) })
  children.push({ label, child, output: () => output })
  return child
}

async function stopChildren() {
  for (const { child } of children.reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 500))
  for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL')
}

async function waitFor(url, label, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(url, { redirect: 'manual' })).status < 500) return }
    catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
  }
  const logs = children.find(child => child.label === label)?.output() ?? ''
  fail(`${label} did not become ready at ${url}\n${logs}`)
}

async function browser(args, json = false) {
  return await new Promise((accept, reject) => {
    const common = ['--session', session]
    const child = spawn('agent-browser', [...common, ...(json ? ['--json'] : []), ...args], {
      cwd: platformRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.once('close', code => code === 0 ? accept(output.trim()) : reject(new Error(`agent-browser ${args.join(' ')} failed: ${error || output}`)))
    child.once('error', reject)
  })
}

async function openBrowser(url) {
  await runOnce('agent-browser', ['close', '--all'], platformRoot).catch(() => undefined)
  return await new Promise((accept, reject) => {
    const child = spawn('agent-browser', [
      '--session', session,
      '--args', browserArgs,
      '--proxy-bypass', 'localhost,127.0.0.1,*.campaign.test',
      'open', url,
    ], { cwd: platformRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.once('close', code => code === 0 ? accept(output.trim()) : reject(new Error(`agent-browser open ${url} failed: ${error || output}`)))
    child.once('error', reject)
  })
}

async function runOnce(command, args, cwd, env = process.env) {
  return await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-80_000) })
    child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-80_000) })
    child.once('close', code => code === 0 ? accept(output) : reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${output}`)))
    child.once('error', reject)
  })
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const apiLogs = children.find(child => child.label === 'api')?.output().slice(-4_000) ?? ''
    fail(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}\napi logs=${apiLogs}`)
  }
  return body
}

async function waitForRow(client, sql, params, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await client.query(sql, params)
    if (result.rows[0]) return result.rows[0]
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  fail(`Timed out waiting for ${label}`)
}

async function main() {
  const pgBinIndex = process.argv.indexOf('--pg-bin')
  const pgBin = pgBinIndex >= 0 ? process.argv[pgBinIndex + 1] : undefined
  // Workspace package exports point at dist, so build the open API graph before
  // starting the source entrypoint. This also prevents stale local dist from
  // invalidating the browser proof.
  await runOnce('pnpm', ['--filter', '@use-brian/api...', 'build'], ossRoot)
  const fixture = await createLocalFixture({ pgBin })
  const admin = new pg.Client({ connectionString: fixture.adminUrl })
  const runEnv = {
    ...fixture.env,
    NODE_ENV: 'development',
    USEBRIAN_EDITION: 'oss',
    NEXT_PUBLIC_USEBRIAN_EDITION: 'oss',
    JWT_SECRET: 'campaign-browser-acceptance-jwt-secret-32-characters',
    API_URL: hosts.api,
    APP_URL: hosts.feed,
      NEXT_PUBLIC_API_URL: hosts.api,
      INTERNAL_API_URL: `http://127.0.0.1:${ports.api}`,
      NEXT_PUBLIC_APP_URL: hosts.feed,
      PUBLIC_API_URL: hosts.api,
      PUBLIC_APP_URL: hosts.feed,
      APP_HOSTS: 'feed.campaign.test',
      AUTHED_APP_URL: hosts.feed,
    PORT: String(ports.api),
    PG_POOL_MAX: '3',
    SKILLS_AUTO_GEN_ENABLED: 'false',
    VOICE_TRANSCRIPTION_ENABLED: 'false',
    MANAGED_FEED_CLOUD_URL: '',
  }
  try {
    await mkdir(evidenceDir, { recursive: true })
    await admin.connect()
    start('api', 'pnpm', ['--filter', '@use-brian/api-open', 'exec', 'tsx', 'src/index.ts'], ossRoot, runEnv)
    await waitFor(`http://127.0.0.1:${ports.api}/health`, 'api')

    const auth = await jsonRequest(`http://127.0.0.1:${ports.api}/auth/local-session`, { method: 'POST' })
    const authorization = { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' }
    const owner = await admin.query(`SELECT u.id AS "userId",w.id AS "workspaceId",a.id AS "assistantId"
      FROM users u JOIN workspaces w ON w.owner_user_id=u.id JOIN assistants a ON a.workspace_id=w.id AND a.kind='primary'
      WHERE u.auth_provider='local' LIMIT 1`)
    const { userId, workspaceId, assistantId } = owner.rows[0] ?? fail('Local owner workspace was not created')
    const sessionRow = await admin.query(`INSERT INTO sessions(user_id,assistant_id,workspace_id,channel_type,channel_id,title,mode,visibility)
      VALUES($1,$2,$3,'web','campaign-browser-acceptance','[linkedin] Synthetic campaign draft','draft','workspace') RETURNING id`,
    [userId, assistantId, workspaceId])
    const feedSessionId = sessionRow.rows[0].id

    const command = async (idempotencyKey, value) => jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/commands`, {
      method: 'POST', headers: authorization, body: JSON.stringify({ workspaceId, idempotencyKey, command: value }),
    })
    const campaignReceipt = await command('browser-campaign-create', {
      kind: 'save_campaign', name: 'Synthetic first-party launch', objective: 'Verify local attribution and CRM linkage',
      timezone: 'UTC', primaryConversion: 'enquiry_submitted',
    })
    const campaignId = campaignReceipt.result.campaign.id
    const bodyPlacement = (await command('browser-placement-body', {
      kind: 'attach_content', campaignId, sessionId: feedSessionId, channel: 'linkedin', placementKind: 'body', placementKey: 'linkedin_body',
    })).result.placement
    const commentPlacement = (await command('browser-placement-comment', {
      kind: 'attach_content', campaignId, sessionId: feedSessionId, channel: 'linkedin', placementKind: 'first_comment', placementKey: 'linkedin_comment',
    })).result.placement
    const emailPlacement = (await command('browser-placement-email', {
      kind: 'attach_content', campaignId, sessionId: feedSessionId, channel: 'email', placementKind: 'email_body', placementKey: 'email_body',
    })).result.placement
    const bodyLink = (await command('browser-link-body', {
      kind: 'create_link', campaignId, placementId: bodyPlacement.id,
      destination: `${hosts.marketing}/plans?existing=kept#pricing`,
      utm: { source: 'linkedin', medium: 'organic_social', campaign: 'synthetic_launch', content: 'body' }, existingAttribution: 'reject',
    })).result.link
    await command('browser-link-comment', {
      kind: 'create_link', campaignId, placementId: commentPlacement.id,
      destination: `${hosts.marketing}/plans#pricing`,
      utm: { source: 'linkedin', medium: 'organic_social', campaign: 'synthetic_launch', content: 'comment' }, existingAttribution: 'reject',
    })
    const emailLink = (await command('browser-link-email', {
      kind: 'create_link', campaignId, placementId: emailPlacement.id,
      destination: `${hosts.marketing}/plans?existing=kept#pricing`,
      utm: { source: 'newsletter', medium: 'email', campaign: 'synthetic_launch', content: 'email_body' }, existingAttribution: 'reject',
    })).result.link
    await command('browser-publication', {
      kind: 'record_manual_publication', placementId: bodyPlacement.id,
      permalink: 'https://social.example/posts/synthetic-launch', publishedAt: '2026-09-20T08:00:00.000Z', approvedRevision: 0,
    })
    const siteReceipt = await command('browser-site-create', {
      kind: 'save_site', name: 'Synthetic sibling sites',
      allowedOrigins: [hosts.marketing, hosts.studio],
      conversionDefinitions: [
        { key: 'signup_completed', label: 'Signup completed', enabled: true },
        { key: 'enquiry_submitted', label: 'Enquiry submitted', enabled: true },
      ],
      storageMode: 'first_party', cookieDomain: 'campaign.test', siteGroupKey: 'synthetic_sites',
      rawRetentionDays: 90, aggregateRetentionMonths: 13,
    })
    const site = siteReceipt.result.site
    const credential = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/sites/${site.id}/credentials`, {
      method: 'POST', headers: authorization, body: JSON.stringify({ workspaceId }),
    })
    const siteSecret = credential.credential.oneTimeSecret

    const definition = await jsonRequest(`http://127.0.0.1:${ports.api}/api/crm/${workspaceId}/operations/intake-definitions`, {
      method: 'POST', headers: authorization, body: JSON.stringify({
        definitionKey: 'synthetic_enquiry', label: 'Synthetic enquiry', active: true,
        definition: { identityPolicy: 'new_or_review', queueKey: 'general', consentMappings: [], maxPayloadBytes: 65_536, fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, mapping: { kind: 'base_field', field: 'name' } },
          { key: 'email', label: 'Email', type: 'email', required: true, mapping: { kind: 'base_field', field: 'email' } },
        ] },
      }),
    })
    const definitionId = definition.record.id
    const intakeCredential = await jsonRequest(`http://127.0.0.1:${ports.api}/api/crm/${workspaceId}/operations/intake-credentials`, {
      method: 'POST', headers: authorization, body: JSON.stringify({ label: 'Synthetic browser fixture', definitionIds: [definitionId] }),
    })

    const clientEnv = {
      ...runEnv,
      // This URL is consumed by the Next.js server-side rewrite and by the
      // server conversion adapter. The browser itself stays on the realistic
      // first-party hostname.
      NEXT_PUBLIC_CAMPAIGN_API_URL: `http://127.0.0.1:${ports.api}`,
      NEXT_PUBLIC_CAMPAIGN_SITE_ID: site.publicId,
      NEXT_PUBLIC_STUDIO_CAMPAIGN_SITE_ID: site.publicId,
      NEXT_PUBLIC_CAMPAIGN_STORAGE_ALLOWED: 'true',
      NEXT_PUBLIC_CAMPAIGN_COOKIE_DOMAIN: 'campaign.test',
      NEXT_PUBLIC_CAMPAIGN_TEST_TRAFFIC: 'true',
      CAMPAIGN_MARKETING_SITE_CREDENTIAL: siteSecret,
      STUDIO_CAMPAIGN_SITE_CREDENTIAL: siteSecret,
    }
    start('marketing', 'pnpm', ['--filter', 'web', 'exec', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(ports.marketing)], platformRoot, clientEnv)
    start('studio', 'pnpm', ['--filter', 'studio', 'exec', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(ports.studio)], platformRoot, clientEnv)
    start('feed', 'pnpm', ['--filter', 'app-web', 'exec', 'next', 'dev', '--hostname', '0.0.0.0', '--port', String(ports.feed)], ossRoot, clientEnv)
    await Promise.all([
      waitFor(`http://127.0.0.1:${ports.marketing}`, 'marketing'),
      waitFor(`http://127.0.0.1:${ports.studio}`, 'studio'),
      waitFor(`http://127.0.0.1:${ports.feed}`, 'feed'),
    ])

    await openBrowser(bodyLink.destination)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = await browser(['eval', 'typeof window.BrianCampaign === "object"'], true)
      if (ready.includes('"result":true')) break
      await browser(['wait', '500'])
    }
    const trackerDiagnostic = await browser(['eval', `({tracker:typeof window.BrianCampaign,script:document.querySelector('script[data-brian-campaign-tracker]')?.src??null,cookie:document.cookie})`], true)
    const routeDiagnostic = await browser(['eval', `(async()=>{const response=await fetch('/campaign-tracking/tracker.js');const body=await response.text();return {status:response.status,contentType:response.headers.get('content-type'),body:body.slice(0,120)}})()`], true)
    const hydrationDiagnostic = await browser(['eval', `({readyState:document.readyState,nextScripts:document.querySelectorAll('script[src*="_next"]').length,siteConfigured:document.documentElement.innerHTML.includes(${JSON.stringify(site.publicId)})})`], true)
    const errorDiagnostic = await browser(['errors'], true)
    if (!trackerDiagnostic.includes('"tracker":"object"')) {
      fail(`Marketing tracker did not initialize: ${trackerDiagnostic}\nroute=${routeDiagnostic}\nhydration=${hydrationDiagnostic}\nerrors=${errorDiagnostic.slice(0, 2_000)}`)
    }
    await browser(['network', 'requests', '--clear'])
    await browser(['eval', `history.pushState({},'', '/plans?view=all'); 'spa-navigation-recorded'`])
    await browser(['wait', '800'])
    await browser(['eval', `(()=>{const target=[...document.querySelectorAll('a,button')].find(el=>el.getAttribute('href')?.startsWith('/login')||el.hasAttribute('data-campaign-cta'));if(target){target.addEventListener('click',event=>event.preventDefault(),{once:true});target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))}return Boolean(target)})()`])
    await browser(['wait', '500'])
    const marketingCookie = await browser(['eval', 'document.cookie'], true)
    await browser(['set', 'viewport', '1440', '1000'])
    await browser(['wait', '300'])
    await browser(['screenshot', join(evidenceDir, 'marketing-desktop.png')])
    const marketingNetwork = await browser(['network', 'requests'], true)

    await browser(['open', hosts.studio])
    await browser(['wait', '1500'])
    const studioContextRaw = await browser(['eval', 'window.BrianCampaign?.context()'], true)
    await browser(['eval', `document.querySelector('input,textarea')?.focus(); 'studio-form-started'`])
    await browser(['wait', '500'])
    const studioCookie = await browser(['eval', 'document.cookie'], true)
    await browser(['set', 'viewport', '390', '844'])
    await browser(['wait', '300'])
    await browser(['screenshot', join(evidenceDir, 'studio-phone.png')])

    const studioContextMatch = studioContextRaw.match(/\{[\s\S]*\}/)
    const studioContextEnvelope = studioContextMatch ? JSON.parse(studioContextMatch[0]) : null
    const studioContext = studioContextEnvelope?.data?.result
      ?? studioContextEnvelope?.result
      ?? studioContextEnvelope?.data
      ?? studioContextEnvelope
    assert(studioContext?.linkId === bodyLink.publicId, 'Sibling site lost the acquisition link')
    assert(studioContext?.utm?.source === 'linkedin', 'Sibling site lost the acquisition UTM')
    assert(marketingCookie.includes('brian_campaign_v1'), 'Marketing did not create first-party continuity')
    assert(studioCookie.includes('brian_campaign_v1'), 'Studio did not receive first-party continuity')

    const conversionOccurredAt = new Date().toISOString()
    const testConversion = {
      version: 1, siteId: site.publicId, conversionKind: 'signup_completed', externalOutcomeId: 'synthetic-browser-signup-001',
      occurredAt: conversionOccurredAt, attribution: studioContext, test: true, metadata: {},
    }
    const firstConversion = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaign-tracking/conversions`, {
      method: 'POST', headers: { Authorization: `Bearer ${siteSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(testConversion),
    })
    const replayConversion = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaign-tracking/conversions`, {
      method: 'POST', headers: { Authorization: `Bearer ${siteSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(testConversion),
    })
    assert(firstConversion.duplicate === false && replayConversion.duplicate === true, 'Trusted conversion did not deduplicate exact replay')

    const intake = await jsonRequest(`http://127.0.0.1:${ports.api}/api/crm/intake/synthetic_enquiry/submissions`, {
      method: 'POST', headers: { Authorization: `Bearer ${intakeCredential.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-browser-enquiry-001' },
      body: JSON.stringify({ fields: { name: 'Avery Example', email: 'avery@example.com' }, campaignAttribution: studioContext }),
    })
    await waitForRow(admin, `SELECT id FROM campaign_conversions WHERE workspace_id=$1 AND contact_id=$2`, [workspaceId, intake.contactId], 'CRM campaign conversion projection')
    const subjectAttribution = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/contacts/${intake.contactId}/attribution?workspaceId=${workspaceId}`, { headers: authorization })
    assert(subjectAttribution.conversions?.some(conversion => conversion.campaignName === 'Synthetic first-party launch'), 'Campaign subject-attribution API did not resolve the CRM conversion')
    await jsonRequest(`http://127.0.0.1:${ports.api}/api/crm/${workspaceId}/records/${intake.contactId}`, { headers: authorization })
    const emailClickToken = 'email_click_fixture_0123456789abcdef0123456789'
    const dispatchRow = await admin.query(`INSERT INTO campaign_email_dispatches
      (workspace_id,campaign_id,placement_id,approved_revision,sender_ref,purpose_key,segment_id,segment_version,
       audience_snapshot,content_snapshot,tracking_options,authority_snapshot,request_fingerprint,state,approved_by)
      VALUES($1,$2,$3,0,gen_random_uuid(),'updates',gen_random_uuid(),1,'{}','{}',$4::jsonb,'{}',repeat('b',64),'completed',$5) RETURNING id`,
    [workspaceId, campaignId, emailPlacement.id, JSON.stringify({ publicOrigin: hosts.api }), userId])
    const recipientRow = await admin.query(`INSERT INTO campaign_email_recipients
      (workspace_id,dispatch_id,contact_id,email_address,address_hash,personalization_snapshot,eligibility_snapshot,delivery_id,state)
      VALUES($1,$2,$3,'avery@example.com',repeat('c',64),'{}','{}',gen_random_uuid(),'accepted') RETURNING id`,
    [workspaceId, dispatchRow.rows[0].id, intake.contactId])
    await admin.query(`INSERT INTO campaign_email_link_tokens(workspace_id,recipient_id,link_id,token_hash,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 day')`,
    [workspaceId, recipientRow.rows[0].id, emailLink.id, createHash('sha256').update(emailClickToken).digest('hex')])
    const reportDefault = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/${campaignId}/results?workspaceId=${workspaceId}`, { headers: authorization })
    const reportWithTests = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/${campaignId}/results?workspaceId=${workspaceId}&include_test=true`, { headers: authorization })
    assert(reportWithTests.verifiedConversions === reportDefault.verifiedConversions + 1, 'Test conversion entered production totals or was not reported')

    await browser(['set', 'viewport', '1440', '1000'])
    await browser(['wait', '300'])
    await browser(['open', `${hosts.feed}/api/auth/local-session?next=${encodeURIComponent(`/w/${workspaceId}/feed/campaigns`)}`])
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const rendered = await browser(['eval', `document.body.innerText.includes('Synthetic first-party launch')`], true)
      if (rendered.includes('"result":true')) break
      await browser(['wait', '500'])
    }
    const feedText = await browser(['eval', 'document.body.innerText'], true)
    const feedLocation = await browser(['eval', 'location.href'], true)
    if (!feedText.includes('Synthetic first-party launch')) {
      const feedErrors = await browser(['errors'], true)
      const feedDom = await browser(['eval', `({title:document.title,children:[...document.body.children].map(element=>({tag:element.tagName,id:element.id,text:(element.innerText||'').slice(0,160)})),html:document.body.innerHTML.slice(-1200)})`], true)
      const feedLogs = children.find(child => child.label === 'feed')?.output().slice(-4_000) ?? ''
      fail(`Feed campaign page did not show the seeded campaign: ${feedLocation}\n${feedText.slice(0, 600)}\nerrors=${feedErrors.slice(0, 2_000)}\ndom=${feedDom.slice(0, 2_000)}\nlogs=${feedLogs}`)
    }
    await browser(['screenshot', join(evidenceDir, 'feed-desktop.png')])
    await browser(['set', 'viewport', '390', '844'])
    await browser(['wait', '500'])
    await browser(['screenshot', join(evidenceDir, 'feed-phone.png')])

    await browser(['open', `${hosts.feed}/w/${workspaceId}/crm/contact/${intake.contactId}`])
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const rendered = await browser(['eval', `document.body.innerText.includes('Synthetic first-party launch')`], true)
      if (rendered.includes('"result":true')) break
      await browser(['wait', '500'])
    }
    const crmText = await browser(['eval', 'document.body.innerText'], true)
    if (!crmText.includes('Synthetic first-party launch')) {
      const crmErrors = await browser(['errors'], true)
      const crmNetwork = await browser(['network', 'requests'], true)
      const crmDom = await browser(['eval', `({title:document.title,text:document.body.innerText.slice(0,1200),html:document.body.innerHTML.slice(-1200)})`], true)
      const feedLogs = children.find(child => child.label === 'feed')?.output().slice(-4_000) ?? ''
      fail(`CRM detail did not show campaign attribution: ${crmText.slice(0, 1_000)}\nerrors=${crmErrors.slice(0, 2_000)}\nnetwork=${crmNetwork.slice(-4_000)}\ndom=${crmDom.slice(0, 2_000)}\nlogs=${feedLogs}`)
    }
    await browser(['screenshot', join(evidenceDir, 'crm-phone.png')])
    await browser(['set', 'viewport', '1440', '1000'])
    await browser(['wait', '300'])
    await browser(['screenshot', join(evidenceDir, 'crm-desktop.png')])

    await browser(['open', `${hosts.api}/e/${emailClickToken}?brian_test=1`])
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = await browser(['eval', 'typeof window.BrianCampaign === "object"'], true)
      if (ready.includes('"result":true')) break
      await browser(['wait', '500'])
    }
    const emailContextRaw = await browser(['eval', 'window.BrianCampaign?.context()'], true)
    const emailContextMatch = emailContextRaw.match(/\{[\s\S]*\}/)
    const emailContextEnvelope = emailContextMatch ? JSON.parse(emailContextMatch[0]) : null
    const emailContext = emailContextEnvelope?.data?.result ?? emailContextEnvelope?.result ?? emailContextEnvelope?.data ?? emailContextEnvelope
    assert(emailContext?.linkId === emailLink.publicId && emailContext?.utm?.source === 'newsletter', 'SMTP click did not preserve email acquisition context')
    await waitForRow(admin, `SELECT e.id FROM campaign_events e JOIN campaign_links l ON l.id=e.link_id
      WHERE e.workspace_id=$1 AND l.public_id=$2 AND e.event_type='redirect_request'`,
    [workspaceId, emailLink.publicId], 'SMTP email click observation')
    await browser(['set', 'viewport', '1440', '1000'])
    await browser(['wait', '300'])
    await browser(['screenshot', join(evidenceDir, 'email-click-desktop.png')])
    await browser(['set', 'viewport', '390', '844'])
    await browser(['wait', '300'])
    await browser(['screenshot', join(evidenceDir, 'email-click-phone.png')])
    const emailConversion = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaign-tracking/conversions`, {
      method: 'POST', headers: { Authorization: `Bearer ${siteSecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
        version: 1, siteId: site.publicId, conversionKind: 'enquiry_submitted', externalOutcomeId: 'synthetic-email-click-conversion',
        occurredAt: new Date().toISOString(), attribution: emailContext, test: true, metadata: {},
      }),
    })
    assert(emailConversion.duplicate === false, `SMTP click conversion was not accepted exactly once: ${JSON.stringify(emailConversion)}`)
    const emailStoredConversion = await waitForRow(admin, `SELECT attribution_snapshot AS attribution FROM campaign_conversions
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, emailConversion.conversionId], 'SMTP attributed conversion')
    assert(emailStoredConversion.attribution?.state === 'attributed', `SMTP click did not produce an attributed verified conversion: ${JSON.stringify(emailStoredConversion)}`)
    const reportAfterEmailDefault = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/${campaignId}/results?workspaceId=${workspaceId}`, { headers: authorization })
    const reportAfterEmailTests = await jsonRequest(`http://127.0.0.1:${ports.api}/api/campaigns/${campaignId}/results?workspaceId=${workspaceId}&include_test=true`, { headers: authorization })
    assert(reportAfterEmailDefault.verifiedConversions === reportDefault.verifiedConversions
      && reportAfterEmailTests.verifiedConversions === reportWithTests.verifiedConversions + 1,
    'SMTP test conversion entered production totals or was not reported')

    const requests = marketingNetwork.toLowerCase()
    const forbiddenAnalytics = ['google-analytics.com', 'googletagmanager.com', 'segment.io', 'mixpanel.com', 'amplitude.com', 'plausible.io']
    assert(forbiddenAnalytics.every(host => !requests.includes(host)), 'Analytics SaaS request appeared in the marketing network log')
    const stored = await admin.query(`SELECT
      count(*) FILTER (WHERE is_test)::int AS "testEvents",
      count(*) FILTER (WHERE NOT is_test)::int AS "productionEvents"
      FROM campaign_events WHERE workspace_id=$1`, [workspaceId])
    assert(stored.rows[0].testEvents >= 3, 'Expected tagged browser events were not stored as test traffic')

    const evidence = {
      status: 'passed',
      hosts,
      hostnameSetup: `Chromium --host-resolver-rules=MAP *.campaign.test 127.0.0.1,EXCLUDE localhost`,
      assertions: {
        actualMarketingPage: true, actualStudioPage: true, actualFeedPage: true, actualCrmPage: true,
        spaPageView: true, siblingCookieContinuity: true, acquisitionPreserved: true,
        exactConversionReplayDeduplicated: true, crmProjectionLinked: true, testTrafficExcludedFromDefaultReport: true,
        smtpClickToConversion: true, analyticsSaasRequests: 0, desktopAndPhone: true,
      },
      counts: {
        testEvents: stored.rows[0].testEvents,
        productionEvents: stored.rows[0].productionEvents,
        defaultVerifiedConversions: reportAfterEmailDefault.verifiedConversions,
        withTestVerifiedConversions: reportAfterEmailTests.verifiedConversions,
      },
      screenshots: ['marketing-desktop.png', 'studio-phone.png', 'feed-desktop.png', 'feed-phone.png', 'crm-desktop.png', 'crm-phone.png', 'email-click-desktop.png', 'email-click-phone.png'],
    }
    await writeFile(join(evidenceDir, 'browser-acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`)
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await browser(['close']).catch(() => undefined)
    await stopChildren()
    await admin.end().catch(() => undefined)
    await fixture.dispose()
  }
}

main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1 })
