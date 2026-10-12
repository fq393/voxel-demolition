import { Redis } from '@upstash/redis';
import { createLeaderboardHandler } from '../server/leaderboard-handler.ts';
import { RedisBoardStore } from '../server/leaderboard-store.ts';

// Credentials remain in Vercel's server environment. Instantiate only on the
// first request, so missing local credentials cannot break the game build.
let store: RedisBoardStore | undefined;
export default createLeaderboardHandler({
  store: () => {
    if (!store) {
      const redis = Redis.fromEnv();
      store = new RedisBoardStore((script, keys, args) => redis.eval(script, keys, args));
    }
    return store;
  },
  ipSalt: () => process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? 'local-demolition',
});
