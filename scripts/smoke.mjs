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
async function start(directory = data) {
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
    windowsHide: true, stdio: 'inherit',
    env: { ...process.env, DUNDRA_DATA_DIR: directory, DUNDRA_MODEL_KEY: '', DUNDRA_MODEL: 'test-model', DUNDRA_MODEL_URL: 'http://127.0.0.1:' + provider.address().port + '/v1' },
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
async function get(path, headers = {}) {
  const res = await fetch(base + path, { headers });
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
  const empty = await get('/api/library');
  assert.deepEqual([empty.characters, empty.personas, empty.chats, empty.model], [[], [], [], 'test-model']);
  assert.deepEqual((await get('/api/lorebooks')).books, []);
  assert.deepEqual(await get('/api/onboarding'), { stage: 'setup', personas: [] });
  const guest = await post('/api/onboarding', { action: 'finish', personaName: 'Quinn', personaDescription: 'A sailor.' });
  assert.equal(guest.status, 200);
  assert.equal(guest.headers.get('set-cookie'), null);
  assert.deepEqual(await guest.json(), { stage: 'ready', accountName: null });
  const configured = await get('/api/library');
  assert.equal(configured.defaultPersonaId, configured.personas[0].id);
  assert.equal((await post('/api/onboarding', { action: 'finish', personaName: 'Duplicate' })).status, 409);
  const { characters } = await library('save-character', {
    name: 'Harbor keeper', instructions: 'Roleplay as {{char}}.', greeting: 'Welcome, {{user}}.', tags: 'Mystery',
  });
  const character = characters.find(entry => entry.name === 'Harbor keeper');
  const { id: chat } = await library('start-chat', { character: character.id });
  assert.equal((await get('/api/library?chat=' + chat)).chat.persona_id, configured.defaultPersonaId);
  await library('start-chat', { character: character.id, persona: '', rememberPersona: true });
  const withoutPersona = await library('start-chat', { character: character.id });
  assert.equal((await get('/api/library?chat=' + withoutPersona.id)).chat.persona_id, null);
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
  assert.deepEqual(await get('/api/onboarding'), { stage: 'ready', accountName: null });

  await stop();
  const securedData = join(data, 'secured');
  await start(securedData);
  const existing = await library('save-persona', { name: 'Morgan' });
  assert.equal((await get('/api/onboarding')).personas[0].id, existing.personas[0].id);
  const account = { action: 'finish', personaId: existing.personas[0].id, accountName: 'Fixture owner', password: 'fixture password only' };
  assert.equal((await post('/api/onboarding', { ...account, password: 'short' })).status, 400);
  assert.equal((await get('/api/onboarding')).stage, 'setup');
  const created = await post('/api/onboarding', account);
  assert.equal(created.status, 200);
  const setCookie = created.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  let cookie = setCookie.split(';')[0];
  assert.deepEqual(await created.json(), { stage: 'ready', accountName: account.accountName });
  assert.deepEqual(await get('/api/onboarding'), { stage: 'locked' });
  assert.equal((await get('/api/library', { Cookie: cookie })).personas.length, 1);
  for (const path of ['library', 'generation', 'settings', 'advanced', 'lorebooks', 'media', 'cards']) {
    assert.equal((await fetch(base + '/api/' + path)).status, 401, path);
  }
  assert.equal((await post('/api/reply', {})).status, 401);
  const lock = await post('/api/onboarding', { action: 'logout' }, { Cookie: cookie });
  assert.match(lock.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(base + '/api/library', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await post('/api/onboarding', { action: 'login', name: account.accountName, password: 'wrong' })).status, 401);
  const login = await post('/api/onboarding', { action: 'login', name: account.accountName, password: account.password });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  await stop();
  await start(securedData);
  assert.equal((await get('/api/onboarding', { Cookie: cookie })).stage, 'ready');
  assert.equal((await get('/api/library', { Cookie: cookie })).defaultPersonaId, account.personaId);
  console.log('Production smoke passed: first-run setup, skipped account, default persona, local account, guarded routes, sign-in, lock, restart, chat and streaming.');
} finally {
  await stop();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  const { dirname, basename, resolve } = await import('node:path');
  if (dirname(resolve(data)) === resolve(tmpdir()) && basename(data).startsWith('dundra-smoke-')) {
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
