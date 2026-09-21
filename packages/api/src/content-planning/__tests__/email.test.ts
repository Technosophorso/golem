import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { feedCommandRequestSchema, type CampaignEmailMetadata } from '@use-brian/shared'
import { feedParagraph } from '@use-brian/doc-model'
import type { StructuredFeedContent } from '../../db/feed-collaboration-store.js'
import {
  campaignEmailApprovalCurrent,
  freezeCampaignAudienceSnapshot,
  renderCampaignEmail,
} from '../email.js'

const metadata: CampaignEmailMetadata = {
  subject: 'Hello {{first_name}}',
  preheader: 'A useful update for {{company_name}}',
  senderId: randomUUID(),
  audience: { segmentId: randomUUID(), segmentVersion: 3 },
  purposeKey: 'newsletter',
  personalization: [
    { field: 'first_name', required: true },
    { field: 'company_name', required: false, fallback: 'your team' },
  ],
  tracking: { links: true, website: true },
}

function content(): StructuredFeedContent {
  return {
    schemaVersion: 2,
    title: 'Fixture newsletter', privateBrief: '', text: '', postFormat: 'post',
    threadSegments: [], article: { sourceUrl: '', title: '', description: '' }, media: [], email: metadata,
    composition: { version: 1, segments: [{ id: randomUUID(), content: [feedParagraph('Welcome {{first_name}} to <the update>.')] }] },
  }
}

describe('[COMP:campaigns/email] native Feed email', () => {
  it('keeps subject, preheader and body metadata in one strict Feed revision command', () => {
    const command = feedCommandRequestSchema.parse({
      mutationId: randomUUID(), expectedRevision: 7, commands: [{ kind: 'email', metadata }],
    })
    expect(command.commands[0]).toEqual({ kind: 'email', metadata })
    expect(() => feedCommandRequestSchema.parse({
      mutationId: randomUUID(), expectedRevision: 7,
      commands: [{ kind: 'email', metadata: { ...metadata, subject: 'Injected\r\nBcc: victim@example.com' } }],
    })).toThrow()
  })

  it('derives corresponding safe text and HTML with typed fallback personalization', () => {
    const rendered = renderCampaignEmail(content(), metadata, { first_name: '<Ari>' })
    expect(rendered.subject).toBe('Hello <Ari>')
    expect(rendered.preheader).toBe('A useful update for your team')
    expect(rendered.text).toContain('Welcome <Ari> to <the update>.')
    expect(rendered.html).toContain('Welcome &lt;Ari&gt; to &lt;the update&gt;.')
    expect(rendered.html).toContain('data-brian-preheader')
    expect(() => renderCampaignEmail(content(), { ...metadata, subject: '{{last_name}}' }, { first_name: 'Ari' }))
      .toThrow(/Unknown personalization field/)
    expect(() => renderCampaignEmail(content(), metadata, {})).toThrow(/Required personalization/)
  })

  it('freezes a deduplicated audience revision and does not add later matches', () => {
    const contactId = randomUUID()
    const input = {
      segmentId: metadata.audience.segmentId,
      segmentVersion: 3,
      recipients: [
        { contactId, address: 'Person@Example.com', personalization: { first_name: 'Ari' }, eligibility: { verdict: 'allowed' } },
        { contactId: randomUUID(), address: 'person@example.com', personalization: { first_name: 'Duplicate' }, eligibility: { verdict: 'allowed' } },
      ],
      excluded: [{ contactId: randomUUID(), reasons: ['consent_not_recorded'] }],
    }
    const frozen = freezeCampaignAudienceSnapshot(input)
    input.recipients.push({ contactId: randomUUID(), address: 'later@example.com', personalization: { first_name: 'Later' }, eligibility: { verdict: 'allowed' } })
    input.recipients[0]!.personalization.first_name = 'Changed'
    expect(frozen.recipients).toEqual([{ contactId, address: 'person@example.com', personalization: { first_name: 'Ari' }, eligibility: { verdict: 'allowed' } }])
    expect(frozen.segmentVersion).toBe(3)
  })

  it('invalidates a pending approval whenever the canonical revision changes', () => {
    expect(campaignEmailApprovalCurrent(8, 8, 'ready')).toBe(true)
    expect(campaignEmailApprovalCurrent(8, 9, 'ready')).toBe(false)
    expect(campaignEmailApprovalCurrent(8, 8, 'cancelled')).toBe(false)
  })
})
