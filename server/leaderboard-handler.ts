import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BoardError, MAX_BODY_BYTES, MINIMUM_RUN_MS, validateId, validateRequest } from './leaderboard-rules.ts';
import type { BoardStore } from './leaderboard-store.ts';

export type LeaderboardRequest = IncomingMessage & { body?: unknown };
export interface HandlerOptions {
  store: () => BoardStore;
  ipSalt: () => string;
  newRunId?: () => string;
}
function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === 'string' ? value : '';
}

function guardOrigin(req: IncomingMessage, required: boolean): void {
  const origin = header(req, 'origin');
  const fetchSite = header(req, 'sec-fetch-site');
  if (fetchSite === 'cross-site' || (required && !origin)) throw new BoardError(403, 'ORIGIN_REJECTED', '请从游戏页面提交成绩。');
  if (!origin) return;
  const host = header(req, 'host');
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const protocol = header(req, 'x-forwarded-proto').split(',')[0]?.trim() || (local ? 'http' : 'https');
  try {
    const parsed = new URL(origin);
    if (!host || !['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== `${protocol}://${host}` || origin !== parsed.origin) throw new Error('origin');
  } catch {
    throw new BoardError(403, 'ORIGIN_REJECTED', '请从游戏页面提交成绩。');
  }
}

async function parseBody(req: LeaderboardRequest): Promise<unknown> {
  const contentType = header(req, 'content-type').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new BoardError(415, 'JSON_REQUIRED', '请使用游戏页面提交成绩。');
  const length = header(req, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new BoardError(413, 'BODY_TOO_LARGE', '提交内容过长。');
  let value = req.body;
  if (value === undefined) {
    value = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const cleanup = () => {
        req.off('data', data);
        req.off('end', end);
        req.off('error', error);
        req.off('aborted', aborted);
      };
      const error = () => { cleanup(); reject(new BoardError(400, 'INVALID_BODY', '请求未完成，请再试一次。')); };
      const aborted = () => error();
      const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
      const data = (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_BODY_BYTES) {
          cleanup();
          // Drain without buffering; do not destroy the socket before sending 413.
          req.resume();
          reject(new BoardError(413, 'BODY_TOO_LARGE', '提交内容过长。'));
        } else chunks.push(bytes);
      };
      req.on('data', data);
      req.once('end', end);
      req.once('error', error);
      req.once('aborted', aborted);
    });
  }
  const serialized = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_BODY_BYTES) throw new BoardError(413, 'BODY_TOO_LARGE', '提交内容过长。');
  try { return JSON.parse(serialized); }
  catch { throw new BoardError(400, 'INVALID_JSON', '请求格式不正确。'); }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createLeaderboardHandler(options: HandlerOptions) {
  return async function handler(req: LeaderboardRequest, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new BoardError(405, 'METHOD_NOT_ALLOWED', '暂不支持这个操作。');
      }
      guardOrigin(req, req.method === 'POST');
      if (req.method === 'GET') {
        const url = new URL(req.url ?? '/api/leaderboard', 'https://localhost');
        const ids = url.searchParams.getAll('playerId');
        if (ids.length > 1) throw new BoardError(400, 'INVALID_ID', '玩家信息失效，请刷新页面再试。');
        const playerId = ids.length ? validateId(ids[0]) : null;
        send(res, 200, await options.store().read(playerId));
        return;
      }
      const body = validateRequest(await parseBody(req));
      const store = options.store();
      if (body.action === 'start' || body.action === 'rename') {
        // Vercel supplies x-forwarded-for; the address is never stored verbatim.
        const ip = header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for').split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const ipHash = createHmac('sha256', options.ipSalt()).update(ip).digest('hex');
        const tokenHash = createHash('sha256').update(body.playerToken).digest('hex');
        if (body.action === 'rename') {
          send(res, 200, await store.rename(body.playerId, body.name, tokenHash, ipHash));
          return;
        }
        const runId = options.newRunId?.() ?? randomUUID();
        await store.start(body.playerId, body.name, ipHash, runId, tokenHash);
        send(res, 200, { runId, minimumMs: MINIMUM_RUN_MS });
      } else {
        send(res, 200, await store.finish(body.playerId, body.runId, body.count));
      }
    } catch (error) {
      if (error instanceof BoardError) send(res, error.status, { error: error.message, code: error.code });
      else send(res, 503, { error: '排行榜暂时连接不上，稍后再试。', code: 'SERVICE_UNAVAILABLE' });
    }
  };
}
