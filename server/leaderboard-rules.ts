export const MAX_VOXELS = 94_196;
export const MINIMUM_RUN_MS = 85_000;
export const RUN_TTL_SECONDS = 3_600;
export const MAX_BODY_BYTES = 2_048;

export interface BoardEntry {
  playerId: string;
  name: string;
  score: number;
  count: number;
  updatedAt: number;
}
export interface BoardSnapshot {
  entries: BoardEntry[];
  personal: BoardEntry | null;
  rank: number | null;
}
export interface FinishResult extends BoardSnapshot {
  score: number;
  bestScore: number;
}
export type BoardRequest =
  | { action: 'start'; playerId: string; playerToken: string; name: string }
  | { action: 'rename'; playerId: string; playerToken: string; name: string }
  | { action: 'finish'; runId: string; playerId: string; count: number };

export class BoardError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BoardError(400, 'INVALID_ID', '玩家信息失效，请刷新页面再试。');
  }
  return value.toLowerCase();
}

export function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new BoardError(400, 'INVALID_NAME', '请输入 1–16 个字的昵称。');
  const name = value.trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 16 || !/^[\p{Script=Han}A-Za-z0-9 _-]+$/u.test(value)) {
    throw new BoardError(400, 'INVALID_NAME', '昵称限 1–16 个字，可用中文、字母、数字、空格、下划线或短横线。');
  }
  return name;
}

export function validateCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_VOXELS) {
    throw new BoardError(400, 'INVALID_COUNT', '成绩数据无效，请重新挑战。');
  }
  return value;
}

export function validateRequest(body: unknown): BoardRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BoardError(400, 'INVALID_BODY', '请求格式不正确。');
  const data = body as Record<string, unknown>;
  const allowed = (data.action === 'start' || data.action === 'rename') ? ['action', 'playerId', 'playerToken', 'name'] : ['action', 'runId', 'playerId', 'count'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new BoardError(400, 'INVALID_BODY', '请求格式不正确。');
  if (data.action === 'start' || data.action === 'rename') return { action: data.action, playerId: validateId(data.playerId), playerToken: validateId(data.playerToken), name: validateName(data.name) };
  if (data.action === 'finish') return { action: 'finish', playerId: validateId(data.playerId), runId: validateId(data.runId), count: validateCount(data.count) };
  throw new BoardError(400, 'INVALID_ACTION', '暂不支持这个操作。');
}

export function assertRunReady(startedAt: number, now: number): void {
  if (now - startedAt < MINIMUM_RUN_MS) throw new BoardError(409, 'RUN_TOO_EARLY', '挑战还没结束，请完成 90 秒后再提交。');
}

// Redis reverses both score order and the member's byte order for tied scores.
export function compareEntries(a: BoardEntry, b: BoardEntry): number {
  return b.score - a.score || (a.playerId < b.playerId ? 1 : a.playerId > b.playerId ? -1 : 0);
}

export function selectPersonalBest(previous: BoardEntry | null, next: BoardEntry): BoardEntry | null {
  if (next.score === 0) return previous;
  return !previous || next.score > previous.score ? next : previous;
}
