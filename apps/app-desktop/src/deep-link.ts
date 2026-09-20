/**
 * Deep-link resolution — map a `usebrian://` URL to a canvas URL to load.
 *
 * Pure: `resolveDeepLink` takes the raw URL + config and returns an absolute
 * URL string, or `null` when the link does not parse, is not our scheme, or
 * fails the same-origin path guard. Unit-tests with no Electron.
 *
 * Supported links:
 *   usebrian://open?path=/w/<ws>/p/<page>  -> ${appUrl}/w/<ws>/p/<page>
 *   usebrian://open-url?v=1&url=<url>       -> typed remote destination
 *   usebrian://capture                      -> quickCaptureUrl(appUrl)
 *   usebrian://record                       -> recordTargetUrl(appUrl)
 *   usebrian://use?prompt=<text>            -> handled by the Siri bridge
 *
 * Spec: docs/architecture/features/app-desktop.md → "deep-link.ts"
 * [COMP:app-desktop/deep-link]
 */

import { quickCaptureUrl, recordTargetUrl } from "./quick-capture.js";
import {
  parseNativeOpenUrl,
  type InternalLinkDestination,
} from "@use-brian/shared/desktop-links";

interface DeepLinkConfig {
  readonly appUrl: string;
  readonly protocolScheme: string;
}

export const MAX_SIRI_PROMPT_LENGTH = 8_000;

export type NavigationDeepLink =
  | Readonly<{ kind: "active-target-url"; url: string }>
  | Readonly<{ kind: "deployment-destination"; destination: InternalLinkDestination }>;

/** Return a bounded Siri prompt only from the dedicated `use` deep link. */
export function parseUseBrianDeepLink(
  rawUrl: string,
  protocolScheme: string,
): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${protocolScheme}:` || url.hostname !== "use")
    return null;
  const prompt = url.searchParams.get("prompt")?.trim();
  if (!prompt || prompt.length > MAX_SIRI_PROMPT_LENGTH) return null;
  return prompt;
}

/**
 * Resolve a `usebrian://` deep link to an absolute canvas URL.
 *
 * Returns `null` for anything that does not parse, is not our scheme, or whose
 * `path` would leave the canvas origin. The `path` query param **must start
 * with `/`** — this refuses protocol-relative (`//evil.com`) and absolute
 * external targets, so a crafted link can never navigate the app off-origin.
 */
export function parseNavigationDeepLink(
  rawUrl: string,
  cfg: DeepLinkConfig,
): NavigationDeepLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${cfg.protocolScheme}:`) return null;

  const command = url.hostname;

  if (command === "open-url") {
    const destination = parseNativeOpenUrl(rawUrl, cfg.protocolScheme);
    return destination ? { kind: "deployment-destination", destination } : null;
  }

  if (command === "capture") {
    return { kind: "active-target-url", url: quickCaptureUrl(cfg.appUrl) };
  }

  if (command === "record") {
    return { kind: "active-target-url", url: recordTargetUrl(cfg.appUrl) };
  }

  if (command === "open") {
    const path = url.searchParams.get("path") ?? "/";
    // Same-origin guard: must be an absolute in-app path, never `//host` or a
    // full external URL.
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return { kind: "active-target-url", url: `${cfg.appUrl}${path}` };
  }

  return null;
}

/**
 * Legacy convenience for active-target links. Deployment-bearing `open-url`
 * deliberately returns null so call sites must opt into account selection.
 */
export function resolveDeepLink(rawUrl: string, cfg: DeepLinkConfig): string | null {
  const parsed = parseNavigationDeepLink(rawUrl, cfg);
  return parsed?.kind === "active-target-url" ? parsed.url : null;
}
