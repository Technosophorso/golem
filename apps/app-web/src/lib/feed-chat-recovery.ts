/** Authenticated catch-up transport; never resends a chat POST. [COMP:app-web/feed-chat-stream] */
import { createSSEBuffer, parseSSEStream, type SSEEvent } from "@use-brian/chat-ui";

export class FeedRecoveryRefused extends Error {
  constructor(readonly status: number) { super(`Session stream refused (${status})`); }
}

export async function recoverFeedChat(options: {
  url: string;
  signal: AbortSignal;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  onEvent: (event: SSEEvent) => void;
  onRetry: () => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const wait = options.wait ?? ((ms, signal) => new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  }));
  let attempt = 0;
  while (!options.signal.aborted) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await options.fetch(options.url, { signal: options.signal });
      if ([400, 401, 403, 404].includes(response.status)) throw new FeedRecoveryRefused(response.status);
      if (!response.ok || !response.body) throw new Error("Session stream unavailable");
      reader = response.body.getReader();
      const buffer = createSSEBuffer(), decoder = new TextDecoder();
      while (!options.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done || options.signal.aborted) break;
        for (const event of parseSSEStream(decoder.decode(chunk.value, { stream: true }), buffer)) {
          if (options.signal.aborted) return;
          options.onEvent(event);
          if (event.event === "done" || event.event === "error") return;
        }
      }
    } catch (error) {
      if (error instanceof FeedRecoveryRefused) throw error;
      if (options.signal.aborted) return;
    } finally {
      await reader?.cancel().catch(() => {});
    }
    if (options.signal.aborted) return;
    options.onRetry();
    await wait(Math.min(1_000 * 2 ** attempt++, 10_000), options.signal);
  }
}
