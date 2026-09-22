/**
 * Pure policy for Electron's microphone and display-media handlers.
 *
 * The display handler grants a primary-display video stream only because
 * Chromium's getDisplayMedia contract requires one; app-web drops that track
 * immediately and keeps the loopback audio. Keeping trust + source selection
 * here makes both capture security boundaries unit-testable without booting
 * Electron.
 *
 * [COMP:app-desktop/system-audio]
 */

export type DisplaySource = {
  display_id: string;
};

function normalizedCaptureOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "file:" ? "file://" : url.origin;
  } catch {
    return null;
  }
}

export function isTrustedCaptureOrigin(
  requestOriginOrUrl: string,
  appOrigin: string,
  allowBundledFile: boolean,
): boolean {
  const requested = normalizedCaptureOrigin(requestOriginOrUrl);
  if (allowBundledFile && requested === "file://") return true;
  const expected = normalizedCaptureOrigin(appOrigin);
  return requested !== null && expected !== null && requested === expected;
}

export function selectPrimaryDisplaySource<T extends DisplaySource>(
  sources: readonly T[],
  primaryDisplayId: string | number,
): T | undefined {
  return sources.find((source) => source.display_id === String(primaryDisplayId)) ?? sources[0];
}
