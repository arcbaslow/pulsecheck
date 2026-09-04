import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));

function pngSize(data) {
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG file');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

async function expectPng(path, width, height) {
  const actual = pngSize(await readFile(join(root, path)));
  assert.deepEqual(actual, [width, height], `${path} must be ${width}x${height}`);
}

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else out.push(path);
  }
  return out;
}

const manifest = await readJson('extension/manifest.json');
const pkg = await readJson('package.json');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version, 'manifest and package versions differ');
assert.ok(manifest.description.length <= 132, 'manifest description exceeds 132 characters');
assert.equal('permissions' in manifest, false, 'permissions must stay absent');
assert.equal('host_permissions' in manifest, false, 'host permissions must stay absent');

for (const size of [16, 32, 48, 128]) {
  await expectPng(`extension/icons/icon-${size}.png`, size, size);
}
await expectPng('store/icon-128.png', 128, 128);
for (const name of ['01-session', '02-event', '03-export']) {
  await expectPng(`store/${name}-1280x800.png`, 1280, 800);
}
await expectPng('store/promo-small-440x280.png', 440, 280);
await expectPng('store/promo-marquee-1400x560.png', 1400, 560);

for (const path of await files(join(root, 'extension'))) {
  if (!['.html', '.js'].includes(extname(path))) continue;
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(source, /<script[^>]+src=["']https?:/i, `remote script in ${path}`);
  assert.doesNotMatch(source, /import\s*\(\s*["']https?:/i, `remote import in ${path}`);
}

console.log(`store inputs valid for Pulsecheck ${manifest.version}`);
