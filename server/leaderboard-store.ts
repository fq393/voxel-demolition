import { BoardError, MINIMUM_RUN_MS, RUN_TTL_SECONDS, type BoardSnapshot, type FinishResult } from './leaderboard-rules.ts';

const PREFIX = 'demolition:v1';
const SCORES = `${PREFIX}:scores`;
const RECORDS = `${PREFIX}:records`;
export interface BoardStore {
  read(playerId: string | null): Promise<BoardSnapshot>;
  start(playerId: string, name: string, ipHash: string, runId: string, tokenHash: string): Promise<void>;
  rename(playerId: string, name: string, tokenHash: string, ipHash: string): Promise<BoardSnapshot>;
  finish(playerId: string, runId: string, count: number): Promise<FinishResult>;
}
export type RedisEvaluator = (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>;

// Produce an actual JSON array even for an empty leaderboard (Lua cjson treats
// an empty table as an object). The result is also the immutable retry receipt.
const SNAPSHOT_LUA = `
local function snapshot(playerId)
  local rows = {}
  local ids = redis.call('ZREVRANGE', KEYS[1], 0, 19)
  for _, id in ipairs(ids) do
    local row = redis.call('HGET', KEYS[2], id)
    if row then table.insert(rows, row) end
  end
  local personal = 'null'
  local rank = 'null'
  if playerId ~= '' then
    personal = redis.call('HGET', KEYS[2], playerId) or 'null'
    local index = redis.call('ZREVRANK', KEYS[1], playerId)
    if index then rank = tostring(index + 1) end
  end
  return '"entries":[' .. table.concat(rows, ',') .. '],"personal":' .. personal .. ',"rank":' .. rank
end
`;
export const READ_SCRIPT = SNAPSHOT_LUA + `return '{' .. snapshot(ARGV[1]) .. '}'`;
export const START_SCRIPT = `
local token = redis.call('GET', KEYS[4])
if token and token ~= ARGV[4] then return 'PLAYER_OWNER_MISMATCH' end
local playerCount = redis.call('INCR', KEYS[2])
if playerCount == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
local ipCount = redis.call('INCR', KEYS[3])
if ipCount == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
if playerCount > 20 or ipCount > 60 then return 'RATE_LIMITED' end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local run = cjson.encode({playerId=ARGV[1],name=ARGV[2],startedAt=now})
local created = redis.call('SET', KEYS[1], run, 'EX', ARGV[3], 'NX')
if not created then return 'RUN_CONFLICT' end
if not token then redis.call('SET', KEYS[4], ARGV[4], 'NX') end
redis.call('SET', KEYS[5], ARGV[2])
local previousRaw = redis.call('HGET', KEYS[6], ARGV[1])
if previousRaw then
  local previous = cjson.decode(previousRaw)
  previous.name = ARGV[2]
  redis.call('HSET', KEYS[6], ARGV[1], cjson.encode(previous))
end
return 'OK'
`;
export const RENAME_SCRIPT = SNAPSHOT_LUA + `
local token = redis.call('GET', KEYS[3])
if token and token ~= ARGV[3] then return 'PLAYER_OWNER_MISMATCH' end
local playerCount = redis.call('INCR', KEYS[5])
if playerCount == 1 then redis.call('EXPIRE', KEYS[5], 3600) end
local ipCount = redis.call('INCR', KEYS[6])
if ipCount == 1 then redis.call('EXPIRE', KEYS[6], 3600) end
if playerCount > 30 or ipCount > 60 then return 'RENAME_RATE_LIMITED' end
if not token then redis.call('SET', KEYS[3], ARGV[3], 'NX') end
redis.call('SET', KEYS[4], ARGV[2])
local previousRaw = redis.call('HGET', KEYS[2], ARGV[1])
if previousRaw then
  local previous = cjson.decode(previousRaw)
  previous.name = ARGV[2]
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(previous))
end
return '{' .. snapshot(ARGV[1]) .. '}'
`;
export const FINISH_SCRIPT = SNAPSHOT_LUA + `
local raw = redis.call('GET', KEYS[3])
if not raw then return 'RUN_EXPIRED' end
local run = cjson.decode(raw)
if run.playerId ~= ARGV[1] then return 'RUN_OWNER_MISMATCH' end
local count = tonumber(ARGV[2])
if run.result then
  if run.count ~= count then return 'RUN_PAYLOAD_MISMATCH' end
  return run.result
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if now - run.startedAt < tonumber(ARGV[3]) then return 'RUN_TOO_EARLY' end
local previousRaw = redis.call('HGET', KEYS[2], ARGV[1])
local name = redis.call('GET', KEYS[4]) or run.name
local bestScore = 0
if previousRaw then bestScore = cjson.decode(previousRaw).score end
if count > bestScore then
  local row = cjson.encode({playerId=ARGV[1],name=name,score=count,count=count,updatedAt=now})
  redis.call('HSET', KEYS[2], ARGV[1], row)
  redis.call('ZADD', KEYS[1], count, ARGV[1])
  bestScore = count
elseif previousRaw then
  local previous = cjson.decode(previousRaw)
  previous.name = name
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(previous))
end
local result = '{"score":' .. tostring(count) .. ',"bestScore":' .. tostring(bestScore) .. ',' .. snapshot(ARGV[1]) .. '}'
run.count = count
run.result = result
redis.call('SET', KEYS[3], cjson.encode(run), 'EX', ARGV[4])
return result
`;

const ERROR_MAP: Record<string, [number, string]> = {
  PLAYER_OWNER_MISMATCH: [403, '玩家信息不匹配，请刷新页面或换一个新身份。'],
  RENAME_RATE_LIMITED: [429, '昵称修改较频繁，休息一会儿再试。'],
  RATE_LIMITED: [429, '挑战次数较多，休息一会儿再来。'],
  RUN_CONFLICT: [409, '挑战创建失败，请再试一次。'],
  RUN_EXPIRED: [410, '这局挑战已过期，请重新开一局。'],
  RUN_OWNER_MISMATCH: [403, '这局挑战不属于当前玩家，请重新开局。'],
  RUN_PAYLOAD_MISMATCH: [409, '这局已经提交过，请刷新排行榜。'],
  RUN_TOO_EARLY: [409, '挑战还没结束，请完成 90 秒后再提交。'],
};

function decodeResult<T>(value: unknown): T {
  if (typeof value === 'string') {
    const error = ERROR_MAP[value];
    if (error) throw new BoardError(error[0], value, error[1]);
    return JSON.parse(value) as T;
  }
  return value as T;
}

export class RedisBoardStore implements BoardStore {
  private readonly evaluate: RedisEvaluator;
  constructor(evaluate: RedisEvaluator) { this.evaluate = evaluate; }
  async read(playerId: string | null): Promise<BoardSnapshot> {
    return decodeResult<BoardSnapshot>(await this.evaluate(READ_SCRIPT, [SCORES, RECORDS], [playerId ?? '']));
  }
  async start(playerId: string, name: string, ipHash: string, runId: string, tokenHash: string): Promise<void> {
    const response = await this.evaluate(START_SCRIPT, [`${PREFIX}:run:${runId}`, `${PREFIX}:rate:player:${playerId}`, `${PREFIX}:rate:ip:${ipHash}`, `${PREFIX}:owner:${playerId}`, `${PREFIX}:name:${playerId}`, RECORDS], [playerId, name, RUN_TTL_SECONDS, tokenHash]);
    if (response !== 'OK') decodeResult(response);
  }
  async rename(playerId: string, name: string, tokenHash: string, ipHash: string): Promise<BoardSnapshot> {
    return decodeResult<BoardSnapshot>(await this.evaluate(RENAME_SCRIPT, [SCORES, RECORDS, `${PREFIX}:owner:${playerId}`, `${PREFIX}:name:${playerId}`, `${PREFIX}:rate:rename-player:${playerId}`, `${PREFIX}:rate:rename-ip:${ipHash}`], [playerId, name, tokenHash]));
  }
  async finish(playerId: string, runId: string, count: number): Promise<FinishResult> {
    return decodeResult<FinishResult>(await this.evaluate(FINISH_SCRIPT, [SCORES, RECORDS, `${PREFIX}:run:${runId}`, `${PREFIX}:name:${playerId}`], [playerId, count, MINIMUM_RUN_MS, RUN_TTL_SECONDS]));
  }
}
