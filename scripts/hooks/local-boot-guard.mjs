/**
 * PreToolUse guard: an agent session must not hand-roll a local boot.
 *
 * Prose in CLAUDE.md is persuasion; this is a mechanism. The launcher
 * (`pnpm dev` / `pnpm start` / `turbo run dev`) is the wrong tool for a coding
 * session in two different ways, and both cost real time:
 *
 *   - in the FOREGROUND it never returns — it is a long-lived dev server, so the
 *     session's own command timeout is the only thing that ends it, and the
 *     session usually concludes the boot failed and tries again;
 *   - in the BACKGROUND it can block on an invisible stdin prompt (no model
 *     credential) and, with an external DATABASE_URL, it does not migrate.
 *
 * `scripts/rig-up.sh` is the supported path: idempotent, non-interactive,
 * returns when the stack answers. The guard denies the hand-rolled boot and puts
 * the alternative in front of the model, which is what makes the next call the
 * right one.
 *
 * Deliberately narrow: it only ever matches a boot of THIS product, never a test
 * run, a build, a one-off script, or another repo's dev server. When in doubt it
 * allows — a false deny trains a session to work around the guard.
 *
 * Escape hatch: put `BRIAN_ALLOW_DEV_BOOT=1` in the command. A human who wants
 * the interactive launcher keeps it, and the intent is then explicit and visible
 * in the transcript.
 *
 * Spec: docs/workflow/local-rig.md (platform tree). [COMP:platform/local-rig]
 */

/** Boots of this product's full stack, as they actually get typed. */
const BOOT_PATTERNS = [
  // pnpm dev / pnpm start / pnpm run dev, with any --filter-free prefix
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:dev|start)\b/,
  // turbo run dev (the hosted tree's boot), with or without npx/pnpm exec
  /\bturbo\s+run\s+dev\b/,
  // the launcher invoked directly
  /\bnode\s+\S*scripts\/launch\.mjs\b/,
  // next dev, which is app-web on its own
  /\bnext\s+dev\b/,
]

/**
 * Commands that contain a boot-looking substring but are not a boot of the
 * stack. Checked first, so they can never be denied.
 */
const NEVER_BLOCK = [
  // The rig itself, and anything it runs.
  /rig-up\.sh|rig-down\.sh/,
  // Explicit human override.
  /\bBRIAN_ALLOW_DEV_BOOT=1\b/,
  // Scoped package scripts are not a stack boot: `pnpm --filter X dev`,
  // `pnpm dev:watch`, `pnpm test`, `pnpm dev:mint-cookies`, ...
  /\bpnpm\s+(?:-r\s+|--recursive\s+)?--filter\b/,
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:dev|start)[:\-][\w:-]+/,
  // Reading about it is fine.
  /^\s*(?:grep|rg|cat|less|head|tail|bat|ls|find)\b/,
]

/**
 * @param {string} command
 * @returns {{ verdict: 'allow' } | { verdict: 'deny', reason: string }}
 */
export function classifyCommand(command) {
  const cmd = String(command ?? '')
  if (!cmd.trim()) return { verdict: 'allow' }
  if (NEVER_BLOCK.some((re) => re.test(cmd))) return { verdict: 'allow' }
  if (!BOOT_PATTERNS.some((re) => re.test(cmd))) return { verdict: 'allow' }

  const backgrounded = /(^|\s)nohup\s|&\s*$|>\s*\S+\s*2>&1\s*&/.test(cmd)
  return {
    verdict: 'deny',
    reason:
      'Do not boot the stack by hand - run the rig instead:\n'
      + '  use-brian/scripts/rig-up.sh            # PostgreSQL 18 in Docker + the whole stack\n'
      + '  use-brian/scripts/rig-down.sh          # teardown (--wipe deletes the database)\n'
      + 'It is idempotent, prompts for nothing, returns when the stack answers, and writes an\n'
      + 'owner bearer token to use-brian/.rig/session.json for authenticated calls.\n'
      + (backgrounded
        ? 'Backgrounded, the launcher can block on an invisible stdin prompt, and with an\n'
          + 'external DATABASE_URL it does not migrate at all.\n'
        : 'In the foreground the launcher never returns - it is a dev server, so this call can\n'
          + 'only end at your command timeout.\n')
      + 'Spec: docs/workflow/local-rig.md in the platform tree. Procedure: the /start-local skill.\n'
      + 'If you truly need the interactive launcher, prefix the command with BRIAN_ALLOW_DEV_BOOT=1.',
  }
}

// ── PreToolUse hook entry point ────────────────────────────────────────────
// Reads the hook payload on stdin and decides. Configured as a `Bash` matcher in
// the platform checkout's `.claude/settings.json`; a standalone OSS clone never
// invokes it, which is deliberate - there, `pnpm dev` is the documented front
// door (README) and denying it would contradict the product's own instructions.
//
// Deny is signalled BOTH ways on purpose: the JSON decision on stdout is the
// documented structured form, and exit 2 is the exit-code form. Either alone is
// a bet on which one this Claude Code build honors, and the failure mode of
// guessing wrong is a guard that silently allows. Belt and braces: the reason
// also goes to stderr, which exit 2 surfaces to the model.
//
// Allow is silent (exit 0, no output) so the guard costs nothing on the
// thousands of Bash calls it does not care about.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      process.exit(0) // Unparseable payload is not the developer's problem: never block.
    }
    if (payload.tool_name && payload.tool_name !== 'Bash') process.exit(0)
    const result = classifyCommand(payload?.tool_input?.command)
    if (result.verdict === 'allow') process.exit(0)
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      })}\n`,
    )
    process.stderr.write(`${result.reason}\n`)
    process.exit(2)
  })
}
