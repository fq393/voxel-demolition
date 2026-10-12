import { createServer } from 'node:http';
import handler from '../api/leaderboard.ts';

createServer((req, res) => {
  if (req.url?.split('?')[0] !== '/api/leaderboard') { res.writeHead(404); res.end(); return; }
  void handler(req, res);
}).listen(5190, '127.0.0.1', () => console.log('Leaderboard API: http://127.0.0.1:5190'));
