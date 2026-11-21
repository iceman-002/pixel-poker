// Cloudflare Worker: static files come from the assets binding; /ws goes to one Durable Object that runs all rooms.
// Types are kept loose on purpose (wrangler bundles this file; the Node build does not include it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hub } from '../server/hub.js';

declare const WebSocketPair: any;

export class HubDO {
  private hub = new Hub();
  private sweeper = 0;

  constructor(_state: unknown, _env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]] as any[];
    server.accept();
    if (!this.sweeper) this.sweeper = setInterval(() => this.hub.sweep(), 60000) as unknown as number;
    const h = this.hub.connect(server);
    server.addEventListener('message', (e: { data: unknown }) => {
      if (typeof e.data === 'string' && e.data.length <= 8192) h.message(e.data);
    });
    server.addEventListener('close', h.close);
    server.addEventListener('error', h.close);
    return new Response(null, { status: 101, webSocket: client } as any);
  }
}

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/ws') return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
    if (pathname === '/healthz') return new Response('ok');
    return env.ASSETS.fetch(req);
  },
};
