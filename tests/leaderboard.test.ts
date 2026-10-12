import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest, type ServerResponse } from 'node:http';
import { BoardError, MAX_VOXELS, MINIMUM_RUN_MS, assertRunReady, compareEntries, selectPersonalBest, validateCount, validateId, validateName, validateRequest, type BoardEntry, type BoardSnapshot, type FinishResult } from '../server/leaderboard-rules.ts';
import { createLeaderboardHandler, type LeaderboardRequest } from '../server/leaderboard-handler.ts';
import { FINISH_SCRIPT, READ_SCRIPT, RENAME_SCRIPT, START_SCRIPT, RedisBoardStore, type BoardStore } from '../server/leaderboard-store.ts';

const PLAYER_A = '00000000-0000-4000-8000-000000000001';
const PLAYER_B = '00000000-0000-4000-8000-000000000002';
const RUN_A = '00000000-0000-4000-8000-000000000003';
const TOKEN = '00000000-0000-4000-8000-000000000005';
const RUN_B = '00000000-0000-4000-8000-000000000004';
const entry = (playerId = PLAYER_A, score = 80, name = '拆楼小队'): BoardEntry => ({ playerId, score, count: score, name, updatedAt: 100_000 });

// An injectable storage double models the contract (not HTTP or Redis): server
// time, player/run ownership and immutable finish receipts across later runs.
class MemoryBoard implements BoardStore {
  now = 0;
  records = new Map<string, BoardEntry>();
  runs = new Map<string, { playerId: string; name: string; startedAt: number; count?: number; result?: FinishResult }>();
  ipHashes: string[] = [];
  names = new Map<string, string>();
  owners = new Map<string, string>();
  async read(playerId: string | null): Promise<BoardSnapshot> {
    const entries = [...this.records.values()].sort(compareEntries);
    const personal = playerId ? this.records.get(playerId) ?? null : null;
    return { entries: entries.slice(0, 20), personal, rank: personal ? entries.findIndex(row => row.playerId === playerId) + 1 : null };
  }
  async start(playerId: string, name: string, ipHash: string, runId: string, tokenHash = 'test-token-hash'): Promise<void> {
    const owner = this.owners.get(playerId);
    if (owner && owner !== tokenHash) throw new BoardError(403, 'PLAYER_OWNER_MISMATCH', '非本人');
    this.owners.set(playerId, tokenHash);
    this.names.set(playerId, name);
    const previous = this.records.get(playerId);
    if (previous) this.records.set(playerId, { ...previous, name });
    this.ipHashes.push(ipHash);
    this.runs.set(runId, { playerId, name, startedAt: this.now });
  }
  async rename(playerId: string, name: string, tokenHash: string, _ipHash: string): Promise<BoardSnapshot> {
    const owner = this.owners.get(playerId);
    if (owner && owner !== tokenHash) throw new BoardError(403, 'PLAYER_OWNER_MISMATCH', '非本人');
    this.owners.set(playerId, tokenHash);
    this.names.set(playerId, name);
    const previous = this.records.get(playerId);
    if (previous) this.records.set(playerId, { ...previous, name });
    return this.read(playerId);
  }
  async finish(playerId: string, runId: string, count: number): Promise<FinishResult> {
    const run = this.runs.get(runId);
    if (!run) throw new BoardError(410, 'RUN_EXPIRED', '过期');
    if (run.playerId !== playerId) throw new BoardError(403, 'RUN_OWNER_MISMATCH', '非本人');
    if (run.result) {
      if (run.count !== count) throw new BoardError(409, 'RUN_PAYLOAD_MISMATCH', '重复内容不同');
      return run.result;
    }
    assertRunReady(run.startedAt, this.now);
    const name = this.names.get(playerId) ?? run.name;
    const previous = this.records.get(playerId);
    if (previous) this.records.set(playerId, { ...previous, name });
    const best = selectPersonalBest(this.records.get(playerId) ?? null, { playerId, name, score: count, count, updatedAt: this.now });
    if (best) this.records.set(playerId, best);
    run.count = count;
    run.result = { score: count, bestScore: best?.score ?? 0, ...await this.read(playerId) };
    return run.result;
  }
}

async function call(store: BoardStore, method: string, body?: unknown, extraHeaders: Record<string, string> = {}, url = '/api/leaderboard') {
  const req = Readable.from([]) as unknown as LeaderboardRequest;
  req.method = method;
  req.url = url;
  req.headers = { host: 'demo.vercel.app', origin: 'https://demo.vercel.app', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1', ...extraHeaders };
  req.body = body;
  let result = '';
  const headers: Record<string, string> = {};
  const res = { statusCode: 200, setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; }, end(value: string) { result = value; } } as unknown as ServerResponse;
  const handler = createLeaderboardHandler({ store: () => store, ipSalt: () => 'test-salt', newRunId: () => RUN_A });
  await handler(req, res);
  return { status: res.statusCode, headers, body: JSON.parse(result) };
}

test('nickname and id boundaries reject markup, controls, invisible chars and invalid identities', () => {
  assert.equal(validateName(' 拆楼 工程师-1_ '), '拆楼 工程师-1_');
  assert.equal(validateName('𠀀'.repeat(16)), '𠀀'.repeat(16));
  for (const name of ['', ' '.repeat(3), '汉'.repeat(17), '<img>', 'bob\n', '\tbob', 'a\u200bb', 'abc😀', '\u00a0name']) assert.throws(() => validateName(name), BoardError);
  assert.equal(validateId(PLAYER_A.toUpperCase()), PLAYER_A);
  for (const id of [null, 'x', '../../../other', '00000000-0000-0000-0000-000000000000']) assert.throws(() => validateId(id), BoardError);
});

test('finish accepts bounded integer counts only and refuses arbitrary client score', () => {
  assert.equal(validateCount(0), 0);
  assert.equal(validateCount(MAX_VOXELS), MAX_VOXELS);
  for (const count of [-1, MAX_VOXELS + 1, 0.5, NaN, Infinity, '100']) assert.throws(() => validateCount(count), BoardError);
  assert.deepEqual(validateRequest({ action: 'finish', playerId: PLAYER_A, runId: RUN_A, count: 10 }), { action: 'finish', playerId: PLAYER_A, runId: RUN_A, count: 10 });
  assert.throws(() => validateRequest({ action: 'finish', playerId: PLAYER_A, runId: RUN_A, count: 10, score: 999999 }), BoardError);
  assert.throws(() => validateRequest({ action: 'start', playerId: PLAYER_A, name: '昵称' }), BoardError);
  assert.throws(() => validateRequest({ action: 'start', playerId: PLAYER_A, name: '昵称', playerToken: 'not-a-token' }), BoardError);
});

test('wall clock eligibility boundary and monotonic personal best', () => {
  assert.throws(() => assertRunReady(1000, 1000 + MINIMUM_RUN_MS - 1), BoardError);
  assert.throws(() => assertRunReady(1000, 999), BoardError);
  assert.doesNotThrow(() => assertRunReady(1000, 1000 + MINIMUM_RUN_MS));
  const best = entry();
  assert.equal(selectPersonalBest(best, entry(PLAYER_A, 70)), best);
  assert.equal(selectPersonalBest(best, entry(PLAYER_A, 80, 'changed')), best);
  assert.equal(selectPersonalBest(null, entry(PLAYER_A, 0)), null);
  assert.equal(selectPersonalBest(best, entry(PLAYER_A, 81))?.score, 81);
  assert.deepEqual([entry(PLAYER_A), entry(PLAYER_B), entry(RUN_A, 81)].sort(compareEntries).map(row => row.playerId), [RUN_A, PLAYER_B, PLAYER_A]);
});

test('HTTP challenge loop blocks early and wrong-owner finishes and preserves retry receipt', async () => {
  const store = new MemoryBoard();
  const start = await call(store, 'POST', { action: 'start', playerId: PLAYER_A, playerToken: TOKEN, name: '拆楼 小队' });
  assert.equal(start.status, 200);
  assert.deepEqual(start.body, { runId: RUN_A, minimumMs: MINIMUM_RUN_MS });
  assert.ok(!JSON.stringify(start.body).includes(TOKEN));
  const forged = await call(store, 'POST', { action: 'start', playerId: PLAYER_A, playerToken: PLAYER_B, name: '假冒' });
  assert.equal(forged.status, 403);
  assert.match(store.ipHashes[0]!, /^[a-f0-9]{64}$/);
  assert.ok(!store.ipHashes[0]!.includes('198.51.100.1'));
  const finish = { action: 'finish', playerId: PLAYER_A, runId: RUN_A, count: 85 };
  assert.equal((await call(store, 'POST', finish)).status, 409);
  store.now = 90_000;
  assert.equal((await call(store, 'POST', { ...finish, playerId: PLAYER_B })).status, 403);
  const first = await call(store, 'POST', finish);
  assert.equal(first.body.score, 85);
  assert.equal(first.body.bestScore, 85);
  assert.equal(first.body.rank, 1);
  store.records.set(PLAYER_B, entry(PLAYER_B, 100));
  assert.deepEqual((await call(store, 'POST', finish)).body, first.body);
  assert.equal((await call(store, 'POST', { ...finish, count: 90 })).status, 409);
  assert.equal(store.records.get(PLAYER_A)?.score, 85);
});

test('new lower results never replace best and a zero score stays off public board', async () => {
  const store = new MemoryBoard();
  await store.start(PLAYER_A, '高手', 'hash', RUN_A);
  store.now = 90_000;
  await store.finish(PLAYER_A, RUN_A, 500);
  await store.start(PLAYER_A, '新昵称', 'hash', RUN_B);
  store.now = 180_000;
  const lower = await store.finish(PLAYER_A, RUN_B, 100);
  assert.equal(lower.score, 100);
  assert.equal(lower.bestScore, 500);
  assert.equal(lower.personal?.name, '新昵称');
  const empty = new MemoryBoard();
  await empty.start(PLAYER_A, '零分', 'hash', RUN_A);
  empty.now = 90_000;
  assert.deepEqual(await empty.finish(PLAYER_A, RUN_A, 0), { score: 0, bestScore: 0, entries: [], personal: null, rank: null });
});

test('public read returns personal rank even outside top 20', async () => {
  const store = new MemoryBoard();
  for (let i = 0; i < 25; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    store.records.set(id, entry(id, 100 + i));
  }
  const read = await call(store, 'GET', undefined, {}, `/api/leaderboard?playerId=${PLAYER_A}`);
  assert.equal(read.body.entries.length, 20);
  assert.equal(read.body.rank, 24);
  assert.equal(read.headers['cache-control'], 'no-store');
});

test('HTTP guards reject cross-origin writes, wrong type, oversized bodies and unsupported methods before storage', async () => {
  const failStore = { read() { throw new Error('must not call'); }, start() { throw new Error('must not call'); }, finish() { throw new Error('must not call'); } } as unknown as BoardStore;
  const body = { action: 'start', playerId: PLAYER_A, playerToken: TOKEN, name: '玩家' };
  assert.equal((await call(failStore, 'POST', body, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(failStore, 'POST', body, { origin: '' })).status, 403);
  assert.equal((await call(failStore, 'POST', body, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call(failStore, 'POST', body, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call(failStore, 'POST', body, { 'content-length': '2049' })).status, 413);
  assert.equal((await call(failStore, 'POST', { ...body, name: 'a'.repeat(2200) })).status, 413);
  assert.equal((await call(failStore, 'POST', '{broken')).status, 400);
  const method = await call(failStore, 'PUT');
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, 'GET, POST');
  assert.equal((await call(failStore, 'GET', undefined, {}, '/api/leaderboard?playerId=not-an-id')).status, 400);
  const unavailable = await call(failStore, 'GET');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'SERVICE_UNAVAILABLE');
  assert.ok(!JSON.stringify(unavailable.body).includes('must not call'));
});

test('Redis adapter sends one atomic script per action and translates stable error codes', async () => {
  const calls: { script: string; keys: string[]; args: (string | number)[] }[] = [];
  let reply: unknown = 'OK';
  const store = new RedisBoardStore(async (script, keys, args) => { calls.push({ script, keys, args }); return reply; });
  await store.start(PLAYER_A, '玩家', 'hash', RUN_A, 'tokenhash');
  assert.equal(calls[0]?.script, START_SCRIPT);
  assert.equal(calls[0]?.keys.length, 6);
  assert.equal(calls[0]?.args[3], 'tokenhash');
  reply = JSON.stringify({ entries: [], personal: null, rank: null });
  assert.deepEqual(await store.read(null), { entries: [], personal: null, rank: null });
  assert.equal(calls[1]?.script, READ_SCRIPT);
  reply = 'RUN_TOO_EARLY';
  await assert.rejects(() => store.finish(PLAYER_A, RUN_A, 80), (error: unknown) => error instanceof BoardError && error.status === 409 && error.code === 'RUN_TOO_EARLY');
  assert.equal(calls[2]?.script, FINISH_SCRIPT);
  assert.equal(calls[2]?.args[2], MINIMUM_RUN_MS);
  reply = 'RATE_LIMITED';
  await assert.rejects(() => store.start(PLAYER_A, '玩家', 'hash', RUN_B, 'tokenhash'), (error: unknown) => error instanceof BoardError && error.status === 429);
});


test('chunked HTTP body limit returns JSON 413 without dropping the connection', async () => {
  const store = new MemoryBoard();
  const handler = createLeaderboardHandler({ store: () => store, ipSalt: () => 'test', newRunId: () => RUN_A });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  try {
    const result = await new Promise<{ status: number; body: { code: string } }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/leaderboard', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write('{"name":"');
      req.end('a'.repeat(3000) + '"}');
    });
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'BODY_TOO_LARGE');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});


test('nickname changes reach existing best without changing its score, time or old receipt', async () => {
  const store = new MemoryBoard();
  await store.start(PLAYER_A, '旧名', 'ip', RUN_A, 'proof');
  store.now = 90_000;
  const original = await store.finish(PLAYER_A, RUN_A, 500);
  const previousTime = original.personal!.updatedAt;
  const renamed = await store.rename(PLAYER_A, '新名', 'proof', 'ip');
  assert.equal(renamed.personal?.name, '新名');
  assert.equal(renamed.personal?.score, 500);
  assert.equal(renamed.personal?.updatedAt, previousTime);
  assert.equal(renamed.rank, 1);
  assert.deepEqual(await store.finish(PLAYER_A, RUN_A, 500), original);
  assert.equal(original.personal?.name, '旧名');
  await store.start(PLAYER_A, '开局名', 'ip', RUN_B, 'proof');
  await store.rename(PLAYER_A, '局中改名', 'proof', 'ip');
  store.now = 180_000;
  const improved = await store.finish(PLAYER_A, RUN_B, 800);
  assert.equal(improved.personal?.name, '局中改名');
  await assert.rejects(() => store.rename(PLAYER_A, '冒名', 'wrong', 'ip'), error => error instanceof BoardError && error.status === 403);
});

test('rename HTTP validates token and name and returns a fresh board without adding zero-score entries', async () => {
  const store = new MemoryBoard();
  const body = { action: 'rename', playerId: PLAYER_A, playerToken: TOKEN, name: '新玩家' };
  const renamed = await call(store, 'POST', body);
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.body, { entries: [], personal: null, rank: null });
  assert.equal(store.names.get(PLAYER_A), '新玩家');
  assert.equal((await call(store, 'POST', { ...body, name: '<script>' })).status, 400);
  assert.equal((await call(store, 'POST', { ...body, playerToken: PLAYER_B })).status, 403);
  const redis = new RedisBoardStore(async (script, keys, args) => {
    assert.equal(script, RENAME_SCRIPT);
    assert.equal(keys.length, 6);
    assert.deepEqual(args, [PLAYER_A, '新昵称', 'proof']);
    return { entries: [], personal: null, rank: null };
  });
  assert.deepEqual(await redis.rename(PLAYER_A, '新昵称', 'proof', 'ip'), { entries: [], personal: null, rank: null });
});
