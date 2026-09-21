import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bridgeEnv } from '../bridge-env.mjs'

describe('[COMP:platform/local-rig] launcher bridge environment', () => {
  test('a locally started bridge gets a loopback URL and the shared secret', () => {
    assert.deepEqual(
      bridgeEnv('BROWSER_RELAY', { useLocal: true, port: 8094, secret: 's3cret', env: {} }),
      { BROWSER_RELAY_URL: 'http://127.0.0.1:8094', BROWSER_RELAY_SECRET: 's3cret' },
    )
  })

  test('an externally deployed bridge wins over the local one', () => {
    assert.deepEqual(
      bridgeEnv('WA_CONNECTOR', {
        useLocal: true,
        port: 8091,
        secret: 's3cret',
        env: { WA_CONNECTOR_URL: 'https://wa.example/bridge' },
      }),
      { WA_CONNECTOR_URL: 'https://wa.example/bridge', WA_CONNECTOR_SECRET: 's3cret' },
    )
  })

  // The core-only case: nothing will answer, so the api must see "not
  // configured" rather than a loopback port that refuses every connection.
  test('a bridge that will not exist exports nothing at all', () => {
    assert.deepEqual(
      bridgeEnv('DISCORD_CONNECTOR', { useLocal: false, port: 8090, secret: 's3cret', env: {} }),
      {},
    )
  })

  // Under core-only the relay port is never reserved, so `useLocal` and a
  // missing port can meet. `http://127.0.0.1:undefined` must never be built.
  test('a local bridge without a port is not a bridge', () => {
    for (const port of [undefined, null, '']) {
      assert.deepEqual(
        bridgeEnv('BROWSER_RELAY', { useLocal: true, port, secret: 's3cret', env: {} }),
        {},
        `port=${String(port)}`,
      )
    }
  })

  test('the secret never travels without a URL to use it on', () => {
    const out = bridgeEnv('FEISHU_CONNECTOR', { useLocal: false, secret: 's3cret', env: {} })
    assert.equal(Object.keys(out).length, 0)
  })

  test('a URL with no secret is still exported', () => {
    assert.deepEqual(
      bridgeEnv('WECHAT_CONNECTOR', { useLocal: true, port: 8093, env: {} }),
      { WECHAT_CONNECTOR_URL: 'http://127.0.0.1:8093' },
    )
  })

  test('reads the ambient environment when none is injected', () => {
    const prev = process.env.RIG_TEST_BRIDGE_URL
    process.env.RIG_TEST_BRIDGE_URL = 'https://ambient.example'
    try {
      assert.deepEqual(bridgeEnv('RIG_TEST_BRIDGE', { useLocal: false }), {
        RIG_TEST_BRIDGE_URL: 'https://ambient.example',
      })
    } finally {
      if (prev === undefined) delete process.env.RIG_TEST_BRIDGE_URL
      else process.env.RIG_TEST_BRIDGE_URL = prev
    }
  })
})
