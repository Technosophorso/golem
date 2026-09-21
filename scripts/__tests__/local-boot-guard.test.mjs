import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classifyCommand } from '../hooks/local-boot-guard.mjs'

const denied = (cmd) => classifyCommand(cmd).verdict === 'deny'

describe('[COMP:platform/local-rig] hand-rolled local boot guard', () => {
  test('denies a stack boot, foreground or backgrounded', () => {
    for (const cmd of [
      'pnpm dev',
      'cd use-brian && pnpm dev',
      'pnpm start',
      'pnpm run dev',
      'npx turbo run dev --concurrency=15',
      'pnpm exec turbo run dev',
      'node scripts/launch.mjs',
      'node /abs/path/use-brian/scripts/launch.mjs',
      'nohup pnpm dev > /tmp/out.log 2>&1 &',
      'cd use-brian && nohup node scripts/launch.mjs >/tmp/l.log 2>&1 &',
      'pnpm --dir use-brian exec next dev --port 3003',
    ]) {
      assert.equal(denied(cmd), true, `should deny: ${cmd}`)
    }
  })

  test('the reason names the rig and both commands', () => {
    const result = classifyCommand('pnpm dev')
    assert.equal(result.verdict, 'deny')
    assert.match(result.reason, /rig-up\.sh/)
    assert.match(result.reason, /rig-down\.sh/)
    assert.match(result.reason, /local-rig\.md/)
    // The model must be told how to proceed deliberately, not just refused.
    assert.match(result.reason, /BRIAN_ALLOW_DEV_BOOT=1/)
  })

  test('explains the failure mode that actually applies', () => {
    assert.match(classifyCommand('pnpm dev').reason, /never returns/)
    assert.match(classifyCommand('nohup pnpm dev &').reason, /invisible stdin prompt/)
  })

  test('allows the rig itself, and anything it runs', () => {
    for (const cmd of [
      './scripts/rig-up.sh',
      'use-brian/scripts/rig-up.sh --full',
      'pnpm rig:up',
      'scripts/rig-down.sh --wipe',
    ]) {
      assert.equal(denied(cmd), false, `should allow: ${cmd}`)
    }
  })

  test('allows an explicit human override', () => {
    assert.equal(denied('BRIAN_ALLOW_DEV_BOOT=1 pnpm dev'), false)
  })

  // A false deny is worse than no guard: it teaches a session to route around
  // the hook, and then the guard protects nothing.
  test('does not touch tests, builds, scoped scripts, or other repos', () => {
    for (const cmd of [
      'pnpm test',
      'pnpm test:scripts',
      'pnpm check',
      'pnpm smoke',
      'pnpm build',
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm dev:watch',
      'pnpm dev:mint-cookies --email a@b.example',
      'pnpm --filter app-web dev',
      'pnpm --filter @use-brian/core test',
      'pnpm exec vitest run src/foo.test.ts',
      'docker exec usebrian-brain psql -U brian -d usebrian -c "select 1"',
      'git status --short',
      'grep -rn "pnpm dev" docs/',
      'cat docs/workflow/local-rig.md',
      'node --test scripts/__tests__/*.test.mjs',
    ]) {
      assert.equal(denied(cmd), false, `should allow: ${cmd}`)
    }
  })

  test('an empty or absent command is allowed, never crashed on', () => {
    assert.equal(denied(''), false)
    assert.equal(denied(undefined), false)
    assert.equal(denied(null), false)
  })
})
