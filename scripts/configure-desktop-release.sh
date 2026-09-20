#!/usr/bin/env bash
# One-time operator setup. Transfers only the five signing values to GitHub's
# main-only desktop-release environment; never prints values or uploads GH_TOKEN.
# Spec: docs/architecture/features/app-desktop.md -> Automatic macOS releases.
set -euo pipefail
set +x
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
if [[ -f .env.desktop ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.desktop
  set +a
fi
required=(CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "error: missing signing value: $name" >&2
    exit 1
  fi
done

# Prefer the already-authenticated operator, matching package-desktop.sh. Do not
# store this local GH_TOKEN in Actions: publication gets its own scoped job token.
repo="use-brian/use-brian"
if [[ "$(env -u GH_TOKEN gh api "repos/$repo" --jq '.permissions.admin' 2>/dev/null)" == true ]]; then
  GH=(env -u GH_TOKEN gh)
elif [[ "$(gh api "repos/$repo" --jq '.permissions.admin' 2>/dev/null)" == true ]]; then
  GH=(gh)
else
  echo "error: GitHub repository administrator access is required for release setup" >&2
  exit 1
fi

# A path is meaningful only on this Mac. Convert to base64 without returning the
# certificate to the terminal; validate before changing GitHub settings.
CSC_LINK="$(node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
try {
  const value = process.env.CSC_LINK.trim();
  const path = value.startsWith('file:') ? fileURLToPath(value)
    : value.startsWith('~/') ? `${homedir()}/${value.slice(2)}` : value;
  const encoded = existsSync(path) ? readFileSync(path).toString('base64') : value.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || Buffer.byteLength(encoded) > 48 * 1024) throw new Error();
  process.stdout.write(encoded);
} catch {
  console.error('error: CSC_LINK must be a readable certificate path or base64 certificate within the GitHub secret size limit');
  process.exitCode = 1;
}
NODE
)"
export CSC_LINK

# Preserve existing reviewer/wait policies. Create only when it does not exist.
environments="$("${GH[@]}" api "repos/$repo/environments" --paginate --jq '.environments[].name')"
if ! printf '%s\n' "$environments" | awk '$0 == "desktop-release" { found=1 } END { exit !found }'; then
  "${GH[@]}" api --method PUT "repos/$repo/environments/desktop-release" \
    --input - >/dev/null <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
fi
custom="$("${GH[@]}" api "repos/$repo/environments/desktop-release" --jq '.deployment_branch_policy.custom_branch_policies')"
if [[ "$custom" != true ]]; then
  echo "error: desktop-release must use custom branch policies restricted to main" >&2
  exit 1
fi
policies="$("${GH[@]}" api "repos/$repo/environments/desktop-release/deployment-branch-policies" --jq '.branch_policies[] | [.name,.type] | @tsv')"
if [[ -n "$policies" && "$policies" != $'main\tbranch' ]]; then
  echo "error: desktop-release has unexpected branch policies; restrict it to the main branch before setup" >&2
  exit 1
fi
if [[ -z "$policies" ]]; then
  "${GH[@]}" api --method POST "repos/$repo/environments/desktop-release/deployment-branch-policies" \
    -f name=main -f type=branch >/dev/null
fi
for name in "${required[@]}"; do
  printf '%s' "${!name}" | "${GH[@]}" secret set "$name" --repo "$repo" --env desktop-release
done
"${GH[@]}" variable set DESKTOP_RELEASE_ENABLED --repo "$repo" --body true
echo "Desktop release credentials configured; automatic releases enabled after the workflow reaches main."
