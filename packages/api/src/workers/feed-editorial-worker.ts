/** Shared leased editorial worker; no edition-specific store or process. [COMP:feed/draft-review] */
import { claimFeedRun, failFeedRun, renewFeedLease, type FeedEditorialKind, type FeedEditorialRun } from '../db/feed-editorial-runs-store.js'
import { FeedCollaborationError } from '../db/feed-collaboration-store.js'
import { notifyWorkspaceChange } from '../brain-stream/notify.js'
export function createFeedEditorialWorker(options: {
  handlers: Partial<Record<FeedEditorialKind, (run: FeedEditorialRun, signal: AbortSignal) => Promise<void>>>;
  intervalMs?: number;
}) {
  let timer: ReturnType<typeof setInterval> | null = null; let busy = false; let controller: AbortController | null = null
  async function tick() {
    if (busy) return
    busy = true; let run: FeedEditorialRun | null = null; let renewal: ReturnType<typeof setInterval> | null = null
    try {
      run = await claimFeedRun(Object.keys(options.handlers) as FeedEditorialKind[]); if (!run) return
      const active = run; controller = new AbortController(); const abort = controller
      renewal = setInterval(() => { void renewFeedLease(active).then(alive => { if (!alive) abort.abort() }).catch(() => abort.abort()) }, 20_000)
      await options.handlers[run.kind]!(run, controller.signal)
    } catch (error) {
      if (run) await failFeedRun(run, error instanceof FeedCollaborationError ? error.code : 'editorial_run_failed').catch(() => undefined)
    } finally {
      if (renewal) clearInterval(renewal)
      if (run) notifyWorkspaceChange(run.workspaceId, 'session', 'update', run.sessionId)
      busy = false; controller = null
    }
  }
  return {
    tick,
    start() { if (timer) return; timer = setInterval(() => { void tick() }, options.intervalMs ?? 1_000) },
    stop() { if (timer) clearInterval(timer); timer = null; controller?.abort() },
  }
}
