/** Public, non-identifying readiness check for the internal-link rollout. */
import { query } from './db/client.js'

export type InternalLinkCapabilityReadiness = Readonly<{
  internalLinkAliasesVersion?: 1
}>

type ReadinessRow = { workspace: string | null; page: string | null }
type ReadinessQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: ReadinessRow[] }>

/**
 * Advertise aliases only when both migration tables exist. The result carries
 * no workspace data and is safe to expose before authentication.
 */
export async function detectInternalLinkAliasReadiness(
  run: ReadinessQuery = (text, params) => query<ReadinessRow>(text, params),
): Promise<InternalLinkCapabilityReadiness> {
  try {
    const result = await run(
      `SELECT to_regclass('public.workspace_link_aliases')::text AS workspace,
              to_regclass('public.page_link_aliases')::text AS page`,
    )
    return result.rows[0]?.workspace && result.rows[0]?.page
      ? { internalLinkAliasesVersion: 1 }
      : {}
  } catch {
    return {}
  }
}
