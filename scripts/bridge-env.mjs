/**
 * Resolve one connector/relay bridge's environment for the launcher's children.
 *
 * A bridge's URL must reach the api only when something will actually answer on
 * it: either an external deployment named it, or this launcher is about to start
 * the local one. Exporting a loopback URL nothing listens on turns an honest
 * "not configured" into a connect timeout on first use, which is what
 * USEBRIAN_CORE_ONLY would otherwise produce for all five bridges.
 *
 * The secret travels with the URL and never without it: a shared secret for a
 * bridge that is not reachable is not configuration, it is noise.
 *
 * Extracted from `scripts/launch.mjs` for the same reason
 * `message-store-launch.mjs` was - the launcher boots the product on import, so
 * anything that needs a test has to live beside it rather than inside it. A
 * source-text assertion is not a substitute: on 2026-09-21 a composition test
 * grepping the launcher for `BROWSER_RELAY_URL:` went red on a refactor that
 * changed nothing about the wiring, while no test anywhere covered the rule.
 *
 * [COMP:platform/local-rig]
 */

/**
 * @param {string} name Bridge env prefix, e.g. `BROWSER_RELAY`, `WA_CONNECTOR`.
 * @param {{ useLocal: boolean, port?: number|string, secret?: string, env?: Record<string,string|undefined> }} opts
 * @returns {Record<string, string>} `{}`, or `{ <name>_URL, <name>_SECRET }`.
 */
export function bridgeEnv(name, { useLocal, port, secret, env = process.env } = {}) {
  const external = env[`${name}_URL`]?.trim()
  // A local URL needs a port. Under core-only the port is never reserved, so
  // `useLocal` and a missing port must not compose into `http://127.0.0.1:undefined`.
  const url = external || (useLocal && port != null && port !== '' ? `http://127.0.0.1:${port}` : null)
  if (!url) return {}
  return { [`${name}_URL`]: url, ...(secret ? { [`${name}_SECRET`]: secret } : {}) }
}
