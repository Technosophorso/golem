// [COMP:platform/local-rig] Shared API port contract for the launcher and rig.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const reserved = new Set([3003, 8080, 54329, 8090, 8091, 8092, 8093, 8094, 8095, 8096])

export function resolveApiPort(value = '4000') {
  const text = String(value).trim()
  const port = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || reserved.has(port)) {
    throw new Error('USEBRIAN_API_PORT must be an integer from 1024 to 65535, excluding other local stack ports')
  }
  return port
}

export function resolveRigApiPort(statePath, env = process.env, preferSaved = false) {
  const saved = existsSync(statePath) ? readFileSync(statePath, 'utf8').trim() : undefined
  // Validate even when overridden: corrupt state must not hide the old listener.
  if (saved !== undefined) resolveApiPort(saved)
  return resolveApiPort(preferSaved ? saved : (env.USEBRIAN_API_PORT ?? saved))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(resolveRigApiPort(process.argv[2], process.env, process.argv[3] === '--recorded'))
  } catch (error) {
    console.error(`[rig] ${error.message}`)
    process.exitCode = 1
  }
}
