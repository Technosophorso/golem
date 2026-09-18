import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(new URL("../../../../scripts/desktop-keychain.sh", import.meta.url));
const identity = "A".repeat(40);
const directories: string[] = [];

function run({ fail = "", pathCertificate = false, exitAfterPrepare = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "desktop-keychain-test-"));
  directories.push(directory);
  const log = join(directory, "calls.jsonl");
  const password = "fixture-certificate-password";
  writeFileSync(join(directory, "security"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
const option = (flag) => args[args.indexOf(flag) + 1];
if (args[0] === 'create-keychain') fs.writeFileSync(process.env.TEST_STATE, option('-p'));
if (['unlock-keychain', 'set-key-partition-list'].includes(args[0])) {
  const flag = args[0] === 'unlock-keychain' ? '-p' : '-k';
  if (option(flag) !== fs.readFileSync(process.env.TEST_STATE, 'utf8')) process.exit(2);
}
if (args[0] === 'import') {
  if (option('-P') !== process.env.CSC_KEY_PASSWORD) process.exit(3);
  if (fs.readFileSync(args[1], 'utf8') !== 'fixture-certificate') process.exit(4);
}
if (args[0] === process.env.TEST_FAIL) {
  console.error('failed command including ' + process.env.CSC_KEY_PASSWORD);
  process.exit(5);
}
if (args[0] === 'find-identity') console.log(process.env.TEST_FAIL === 'identity' ? '0 valid identities found' : '1) ${identity} "Developer ID Application: Example"');
`, { mode: 0o755 });
  let link = Buffer.from("fixture-certificate").toString("base64");
  if (pathCertificate) {
    link = join(directory, "certificate with spaces.p12");
    writeFileSync(link, "fixture-certificate");
  }
  const result = spawnSync("bash", ["-c", `
set -euo pipefail
source "$TEST_HELPER"
trap desktop_keychain_cleanup EXIT
desktop_keychain_prepare
node -e 'console.log(JSON.stringify({ keychain: process.env.CSC_KEYCHAIN, identity: process.env.CSC_NAME, link: process.env.CSC_LINK, password: process.env.CSC_KEY_PASSWORD }))'
exit "$TEST_EXIT"
`], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TMPDIR: directory,
      CSC_LINK: link,
      CSC_KEY_PASSWORD: password,
      TEST_HELPER: helper,
      TEST_LOG: log,
      TEST_STATE: join(directory, "keychain-password"),
      TEST_FAIL: fail,
      TEST_EXIT: String(exitAfterPrepare),
    },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  return { ...result, calls, directory, password };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("[COMP:app-desktop/packaging] release signing keychain", () => {
  it.each([false, true])("uses the keychain password for access control (certificate path: %s)", (pathCertificate) => {
    const result = run({ pathCertificate });
    expect(result.status, result.stderr).toBe(0);
    const create = result.calls.find((args) => args[0] === "create-keychain")!;
    const partition = result.calls.find((args) => args[0] === "set-key-partition-list")!;
    expect(partition[partition.indexOf("-k") + 1]).toBe(create[create.indexOf("-p") + 1]);
    expect(partition).not.toContain(result.password);
    expect(JSON.parse(result.stdout)).toEqual({ keychain: create.at(-1), identity });
    expect(result.calls.at(-1)).toEqual(["delete-keychain", create.at(-1)]);
    expect(() => readFileSync(create.at(-1)!.replace("signing.keychain-db", "certificate.p12"))).toThrow();
  });

  it.each(["import", "set-key-partition-list", "identity"])("cleans up after %s failure without printing credentials", (fail) => {
    const result = run({ fail });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(result.password);
    expect(result.calls.at(-1)?.[0]).toBe("delete-keychain");
  });

  it("preserves a later build failure while cleaning up the keychain", () => {
    const result = run({ exitAfterPrepare: 7 });
    expect(result.status).toBe(7);
    expect(result.calls.at(-1)?.[0]).toBe("delete-keychain");
  });
});
