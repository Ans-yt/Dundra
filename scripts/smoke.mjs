import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const data = await mkdtemp(join(tmpdir(), 'dundra-smoke-'));
let mode = 'normal';
let prompt;
const provider = createServer(async (req, res) => {
  assert.equal(req.url, '/v1/chat/completions');
  let body = '';
  for await (const chunk of req) body += chunk;
  prompt = JSON.parse(body);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: {"choices":[{"delta":{"content":"Signal "}}]}\n\n');
  setTimeout(() => {
    if (mode === 'fail') return res.end();
    res.end('data: {"choices":[{"delta":{"content":"received."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }, 50);
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = 'http://127.0.0.1:' + port;
let app;
async function start() {
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    windowsHide: true, stdio: 'inherit',
    env: { ...process.env, DUNDRA_DATA_DIR: data, DUNDRA_MODEL_KEY: '', DUNDRA_MODEL: 'test-model', DUNDRA_MODEL_URL: 'http://127.0.0.1:' + provider.address().port + '/v1' },
  });
  for (let count = 0; count < 100; count++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    if (app.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Next.js failed to start');
}
async function stop() {
  if (app && app.exitCode === null && app.signalCode === null) {
    const closed = once(app, 'exit');
    app.kill();
    await closed;
  }
}
async function get(path) {
  const res = await fetch(base + path);
  assert.equal(res.status, 200);
  return res.json();
}
const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function library(action, fields) {
  const res = await post('/api/library', { action, ...fields });
  const payload = await res.json();
  assert.equal(res.status, 200, JSON.stringify(payload));
  return payload;
}
try {
  await start();
  assert.equal((await get('/api/library')).characters.length, 2);
  const { characters } = await library('save-character', {
    name: 'Harbor keeper', instructions: 'Roleplay as {{char}}.', greeting: 'Welcome, {{user}}.', tags: 'Mystery',
  });
  const character = characters.find(entry => entry.name === 'Harbor keeper');
  const { personas } = await library('save-persona', { name: 'Quinn', description: 'A sailor.' });
  const { id: chat } = await library('start-chat', { character: character.id, persona: personas[0].id });
  const url = '/api/library?chat=' + chat;
  assert.equal((await get(url)).messages[0].content, 'Welcome, Quinn.');
  const res = await post('/api/reply', { chat, message: 'Hello?' });
  assert.match(res.headers.get('content-type'), /ndjson/);
  assert.match(await res.text(), /"delta":"Signal "[\s\S]*"done":true/);
  assert.match(prompt.messages[0].content, /Harbor keeper\.[\s\S]*Quinn/);
  const saved = (await get(url)).messages;
  assert.deepEqual(saved.map(x => x.content), ['Welcome, Quinn.', 'Hello?', 'Signal received.']);
  mode = 'fail';
  assert.match(await (await post('/api/reply', { chat, regenerate: true })).text(), /"error"/);
  assert.deepEqual((await get(url)).messages, saved);
  mode = 'normal';
  assert.match(await (await post('/api/reply', { chat, regenerate: true })).text(), /"done":true/);
  const replaced = (await get(url)).messages;
  assert.equal(replaced.length, saved.length);
  assert.equal(replaced.at(-1).id, saved.at(-1).id);
  assert.equal(replaced.at(-1).variantCount, 2);
  await library('rename-chat', { id: chat, title: 'Signal' });
  assert.equal((await post('/api/library', { action: 'delete-chat', id: chat }, { Origin: 'https://example.com' })).status, 403);
  await stop();
  await start();
  assert.equal((await get(url)).chat.title, 'Signal');
  assert.deepEqual((await get(url)).messages, replaced);
  await library('delete-chat', { id: chat });
  assert.equal((await fetch(base + url)).status, 404);
  console.log('Production smoke passed: character, persona, greeting, stream, interrupted regeneration, successful regeneration, origin guard, restart, rename, deletion.');
} finally {
  await stop();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  const { dirname, basename, resolve } = await import('node:path');
  if (dirname(resolve(data)) === resolve(tmpdir()) && basename(data).startsWith('dundra-smoke-')) {
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
