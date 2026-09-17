import { describe, it, expect, vi } from "vitest";
import { recoverFeedChat, FeedRecoveryRefused } from "../feed-chat-recovery";
const frame = (event: string, data = {}) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const response = (text: string) => new Response(text, { headers: { "Content-Type": "text/event-stream" } });
describe("[COMP:app-web/feed-chat-stream] catch-up transport", () => {
  it("reconnects bare closes, parses fragmented UTF-8 frames, and ends only on done", async () => {
    const bytes = new TextEncoder().encode(frame("snapshot", { text: "終わり" }) + frame("done"));
    const fetch = vi.fn().mockResolvedValueOnce(response(frame("status", { status: "running" }))).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } })));
    const onEvent = vi.fn(), onRetry = vi.fn(), wait = vi.fn().mockResolvedValue(undefined);
    await recoverFeedChat({ url: "/session/stream", signal: new AbortController().signal, fetch, onEvent, onRetry, wait });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls.map(([event]) => event.event)).toEqual(["status", "snapshot", "done"]);
    expect(onEvent.mock.calls[1][0].data).toEqual({ text: "終わり" });
    expect(fetch.mock.calls.every(([, init]) => !init.method && !init.body)).toBe(true);
  });
  it.each([401, 403, 404])("does not retry access refusal %s", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status })), onRetry = vi.fn();
    await expect(recoverFeedChat({ url: "/stream", signal: new AbortController().signal, fetch, onEvent: vi.fn(), onRetry })).rejects.toBeInstanceOf(FeedRecoveryRefused);
    expect(fetch).toHaveBeenCalledOnce(); expect(onRetry).not.toHaveBeenCalled();
  });
  it("retries network and service failures with capped delays, cancelling on navigation", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(new Response(null, { status: 503 }));
    const wait = vi.fn().mockImplementation(async () => { if (wait.mock.calls.length === 6) controller.abort(); });
    await recoverFeedChat({ url: "/stream", signal: controller.signal, fetch, onEvent: vi.fn(), onRetry: vi.fn(), wait });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it("ignores a late response belonging to a cancelled session", async () => {
    const controller = new AbortController(), onEvent = vi.fn();
    await recoverFeedChat({ url: "/stream", signal: controller.signal, fetch: async () => { controller.abort(); return response(frame("snapshot", { text: "Old draft" }) + frame("done")); }, onEvent, onRetry: vi.fn() });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
