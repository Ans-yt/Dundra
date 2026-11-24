import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
const data = await mkdtemp(join(tmpdir(), 'dundra-smoke-'));
let mode = 'normal';
let prompt;
let memoryPrompt;
let rejectSummary = false;
const provider = createServer(async (req, res) => {
  assert.equal(req.url, '/v1/chat/completions');
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  const instruction = payload.messages[0]?.content;
  if (typeof instruction === 'string' && /updated (cumulative )?summary/.test(instruction)) {
    memoryPrompt = payload;
    if (rejectSummary) { res.writeHead(429).end(); return; }
    const content = instruction.includes('JSON object') ? JSON.stringify({
      summary: 'Quinn opened the harbor with the silver key.',
      title: 'The silver key',
      memory: 'The silver key opens the reef gate at dawn.',
      keys: 'reef gate, silver key',
    }) : 'Quinn opened the harbor with the silver key.';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    return;
  }
  prompt = payload;
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
  const pixels = await Promise.all(['#ff0080', '#0080ff', '#00ff80'].map(color =>
    sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer()));
  const images = pixels.map(bytes => 'data:image/png;base64,' + bytes.toString('base64'));
  const guest = await post('/api/onboarding', { action: 'finish', personaName: 'Quinn', personaDescription: 'A sailor.', personaPortrait: images[0] });
  assert.equal(guest.status, 200);
  assert.equal(guest.headers.get('set-cookie'), null);
  assert.deepEqual(await guest.json(), { stage: 'ready' });
  const configured = await get('/api/library');
  assert.equal(configured.defaultPersonaId, configured.personas[0].id);
  const portrait = await fetch(base + '/api/media?kind=persona&id=' + configured.defaultPersonaId);
  assert.equal(portrait.status, 200);
  assert.deepEqual(Buffer.from(await portrait.arrayBuffer()), pixels[0]);
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
  const lore = {
    name: 'Harbor guide', scan_depth: 1, image_attachments: true,
    entries: [{ id: 'beacon', name: 'Harbor beacon', keys: ['beacon'], content: '', images }],
  };
  const tooMany = { ...lore, entries: [{ ...lore.entries[0], images: [...images, images[0]] }] };
  assert.equal((await post('/api/lorebooks', { action: 'save', book: tooMany })).status, 400);
  const createdBook = await post('/api/lorebooks', { action: 'save', book: lore });
  assert.equal(createdBook.status, 200);
  const savedBook = await createdBook.json();
  const link = await post('/api/lorebooks', { action: 'link', scope: 'chat', owner: withoutPersona.id, id: savedBook.id, enabled: true });
  assert.equal(link.status, 200);
  const postedImages = () => prompt.messages.flatMap(message =>
    Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url) : []);
  const say = async message => {
    const generated = await post('/api/reply', { chat: withoutPersona.id, message });
    assert.match(await generated.text(), /"done":true/);
  };
  await say('What is ahead?');
  assert.deepEqual(postedImages(), []);
  await say('I see the beacon.');
  assert.deepEqual(postedImages(), images);
  assert.match(JSON.stringify(prompt.messages), /Harbor beacon/);
  const prefs = (await get('/api/library?chat=' + withoutPersona.id)).preferences;
  await library('chat-options', { id: withoutPersona.id, bonus: { ...prefs.options.bonus, inlineMedia: false } });
  await say('I am near the beacon.');
  assert.deepEqual(postedImages(), []);
  await library('chat-options', { id: withoutPersona.id, bonus: prefs.options.bonus });
  const disabledBook = await post('/api/lorebooks', { action: 'save', id: savedBook.id, book: { ...savedBook, image_attachments: false } });
  assert.equal(disabledBook.status, 200);
  assert.deepEqual((await get('/api/lorebooks?book=' + savedBook.id)).entries[0].images, images);
  await say('At the beacon.');
  assert.deepEqual(postedImages(), []);

  const personaId = configured.defaultPersonaId;
  const createLore = async (name, entries, options = {}) => {
    const response = await post('/api/lorebooks', { action: 'save', book: { name, entries, scan_depth: 1, ...options } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const linkLore = async (scope, owner, id) => {
    assert.equal((await post('/api/lorebooks', { action: 'link', scope, owner, id, enabled: true })).status, 200);
  };
  const characterLore = await createLore('Harbor rules', [
    { id: 'primary', keys: ['/obsidian/i'], secondary_keys: ['inspection'], selective: true, content: 'Character fact: luminous keystone.' },
    { id: 'recursive', keys: ['luminous keystone'], delayUntilRecursion: 1, content: 'A recursive signal: seven pennants.' },
    { id: 'never', keys: ['obsidian'], probability: 0, content: 'Unexpected probability match.' },
    { id: 'budget', keys: ['obsidian'], content: 'Excessive budget use. '.repeat(100) },
  ], { token_budget: 55 });
  const personaLore = await createLore('Navigator notes', [{ id: 'private', keys: ['obsidian'], content: 'Persona fact: a copper feather.' }]);
  await linkLore('character', character.id, characterLore.id);
  await linkLore('persona', personaId, personaLore.id);
  await library('chat-persona', { id: withoutPersona.id, personaId });
  const loreLinks = await get('/api/lorebooks?scope=chat&owner=' + withoutPersona.id);
  assert.deepEqual(new Set(loreLinks.inherited), new Set([characterLore.id, personaLore.id]));
  assert.deepEqual(loreLinks.direct, [savedBook.id]);
  await say('An obsidian stone.');
  assert.doesNotMatch(JSON.stringify(prompt.messages), /luminous keystone|seven pennants|Unexpected probability|Excessive budget/);
  await say('OBSIDIAN inspection.');
  assert.match(JSON.stringify(prompt.messages), /luminous keystone/);
  assert.match(JSON.stringify(prompt.messages), /seven pennants/);
  assert.match(JSON.stringify(prompt.messages), /copper feather/);
  assert.doesNotMatch(JSON.stringify(prompt.messages), /Unexpected probability|Excessive budget/);

  const statusPath = '/api/library?memory=' + withoutPersona.id;
  async function waitForMemory() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const status = await get(statusPath);
      if (!status.running) return status;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The memory job did not finish');
  }
  const memorySettings = prefs.options.autoMemory;
  assert.equal(memorySettings.enabled, false);
  await library('chat-options', { id: withoutPersona.id, autoMemory: { ...memorySettings, model: 'fixture-summary' } });
  await library('summarize-chat', { id: withoutPersona.id });
  const manual = await waitForMemory();
  assert.match(manual.summary, /silver key/);
  assert.equal(manual.bookId, null);
  assert.equal(memoryPrompt.model, 'fixture-summary');
  assert.equal((await post('/api/library', { action: 'summarize-chat', id: withoutPersona.id })).status, 409);

  await library('chat-options', { id: withoutPersona.id, autoMemory: { ...memorySettings, every: 2, enabled: true, book: true } });
  rejectSummary = true;
  await say('I open the silver box.');
  const throttled = await waitForMemory();
  assert.match(throttled.error, /rate-limiting/);
  assert.equal(throttled.summary, manual.summary);
  assert.equal(throttled.bookId, null);
  rejectSummary = false;
  await library('summarize-chat', { id: withoutPersona.id });
  const recalled = await waitForMemory();
  assert.equal(recalled.error, '');
  assert.ok(recalled.bookId);
  assert.match(JSON.stringify(memoryPrompt.messages), /Previous summary[\s\S]*open the silver box/i);
  const memoryBook = await get('/api/lorebooks?book=' + recalled.bookId);
  assert.deepEqual(memoryBook.entries[0].keys, ['reef gate', 'silver key']);
  assert.ok((await get('/api/lorebooks?scope=chat&owner=' + withoutPersona.id)).inherited.includes(memoryBook.id));
  assert.ok(!(await get('/api/lorebooks?scope=chat&owner=' + chat)).books.some(book => book.id === memoryBook.id));
  assert.ok(!(await get('/api/lorebooks')).books.some(book => book.id === memoryBook.id));
  await library('chat-options', { id: withoutPersona.id, autoMemory: { ...memorySettings, book: true } });
  await say('At the reef gate.');
  assert.match(JSON.stringify(prompt.messages), /opens the reef gate at dawn/);
  await library('chat-options', { id: withoutPersona.id, autoMemory: memorySettings });
  await say('At the reef gate again.');
  assert.doesNotMatch(JSON.stringify(prompt.messages), /opens the reef gate at dawn/);
  assert.equal((await get(statusPath)).bookId, memoryBook.id);
  await library('delete-chat', { id: withoutPersona.id });
  assert.equal((await fetch(base + '/api/lorebooks?book=' + memoryBook.id)).status, 404);

  const portraitBytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#a95fba' } }).jpeg().toBuffer();
  const fields = { name: 'Fixture editor', instructions: 'Stay in character.', greeting: 'Welcome.',
    alternateGreetings: ['An alternate.'], portrait: 'data:image/jpeg;base64,' + portraitBytes.toString('base64'),
    lorebookIds: [personaLore.id, characterLore.id] };
  const { characters: edited } = await library('save-character', fields);
  const editedCharacter = edited.find(item => item.name === fields.name);
  const portraitUrl = '/api/cards?format=portrait&id=' + editedCharacter.id;
  const linksUrl = '/api/lorebooks?scope=character&owner=' + editedCharacter.id;
  const png = await fetch(base + portraitUrl);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await sharp(Buffer.from(await png.arrayBuffer())).metadata()).width, 3);
  assert.deepEqual((await get(linksUrl)).direct, fields.lorebookIds);
  const invalidEdit = await post('/api/library', { ...fields, action: 'save-character', id: editedCharacter.id,
    name: 'Rejected edit', portrait: null, lorebookIds: [characterLore.id, 'missing-book'] });
  assert.equal(invalidEdit.status, 409);
  assert.deepEqual((await get(linksUrl)).direct, fields.lorebookIds);
  assert.equal((await fetch(base + portraitUrl)).status, 200);
  assert.ok((await get('/api/library')).characters.some(item => item.name === fields.name));
  const updatedFields = { id: editedCharacter.id, name: fields.name, instructions: fields.instructions, greeting: fields.greeting };
  await library('save-character', updatedFields);
  assert.deepEqual((await get(linksUrl)).direct, fields.lorebookIds);
  assert.equal((await fetch(base + portraitUrl)).status, 200);
  await library('save-character', { ...updatedFields, portrait: null, lorebookIds: [] });
  assert.equal((await fetch(base + portraitUrl)).status, 404);
  assert.deepEqual((await get(linksUrl)).direct, []);

  await library('rename-chat', { id: chat, title: 'Signal' });
  assert.equal((await post('/api/library', { action: 'delete-chat', id: chat }, { Origin: 'https://example.com' })).status, 403);
  await stop();
  await start();
  assert.equal((await get(url)).chat.title, 'Signal');
  assert.deepEqual((await get(url)).messages, replaced);
  await library('delete-chat', { id: chat });
  assert.equal((await fetch(base + url)).status, 404);
  assert.deepEqual(await get('/api/onboarding'), { stage: 'ready' });

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
  const cookie = setCookie.split(';')[0];
  assert.deepEqual(await created.json(), { stage: 'ready' });
  assert.deepEqual(await get('/api/onboarding'), { stage: 'locked' });
  assert.equal((await get('/api/library', { Cookie: cookie })).personas.length, 1);
  for (const path of ['library', 'generation', 'settings', 'advanced', 'lorebooks', 'media', 'cards']) {
    assert.equal((await fetch(base + '/api/' + path)).status, 401, path);
  }
  assert.equal((await post('/api/reply', {})).status, 401);
  assert.deepEqual(await get('/api/onboarding', { Cookie: cookie }), { stage: 'ready' });
  await stop();
  await start(securedData);
  assert.deepEqual(await get('/api/onboarding', { Cookie: cookie }), { stage: 'locked' });
  assert.equal((await fetch(base + '/api/library', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await post('/api/onboarding', { action: 'login', name: account.accountName, password: 'wrong' })).status, 401);
  const login = await post('/api/onboarding', { action: 'login', name: account.accountName, password: account.password });
  assert.equal(login.status, 200);
  const newCookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await get('/api/onboarding', { Cookie: newCookie }), { stage: 'ready' });
  assert.equal((await get('/api/library', { Cookie: newCookie })).defaultPersonaId, account.personaId);
  console.log('Production smoke passed: avatar setup, persona defaults, character editor data and rollback, lorebook activation and images, manual and automatic memory, recovery, guarded routes, sign-in, restart, chat and streaming.');
} finally {
  await stop();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
  const { dirname, basename, resolve } = await import('node:path');
  if (dirname(resolve(data)) === resolve(tmpdir()) && basename(data).startsWith('dundra-smoke-')) {
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
