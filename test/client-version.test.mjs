import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('右栏页脚的版本号和 package.json 保持一致', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const client = await readFile(join(root, 'client.js'), 'utf8')
  const match = /const PLUGIN_VERSION = '([^']+)'/.exec(client)
  assert.ok(match, 'client.js 必须声明 PLUGIN_VERSION（页脚显示用）')
  assert.equal(match[1], pkg.version, '改版本时两处要一起改')
})
