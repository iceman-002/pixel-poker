# Pixel Poker

Pixel-art multiplayer card games for iPhone (works in any browser). Private rooms with a 4-letter code, 2–8 players.
Modes: **Floor Deal** (house game), Hold'em, Omaha, 5-Card Draw, Short Deck.

## Run locally

```sh
npm install
npm run build
npm start            # http://localhost:8080
```

Play with friends from your PC: expose port 8080 with a tunnel, then share the https link.

```sh
npx cloudflared tunnel --url http://localhost:8080
# or: ngrok http 8080
```

Dev mode (hot reload): `npm run build:server && npm start` in one terminal, `npm run dev` in another, open the Vite URL.
Test with bots: `npm test`, `npm run bots -- 20 floor`, or add bots to a real room: `npm run botjoin -- ABCD 3`.

## Deploy (free tier)

**Render:** New → Web Service → connect the repo.
Build command: `npm install --include=dev && npm run build`. Start command: `npm start`. Health check path: `/healthz`.

**Fly.io:** `fly launch` (Node app, internal port 8080), set the build to run `npm run build`, then `fly deploy`.

Free instances sleep when idle; the first visit takes a few seconds to wake. Rooms live in memory, so a restart ends open games.

## Install on iPhone

Open the link in **Safari** → tap **Share** → **Add to Home Screen**. It then opens full screen like an app.

## Floor Deal rules

Each player gets 4 cards (A K Q J; one more rank per player beyond 4) and sees them before staking.
Stakes go around once from a rotating starter: beat the highest stake, go all in, or skip (max 2 skips in a row).
Hands, best to worst: **A-K-Q-J**, four of a kind, three of a kind, two pair, pair, high card.
The biggest stake is the **boss** (tied stakes: best hand). The boss offers to split the house money (equal to the boss's stake):
the boss keeps a share, the rest is split equally. Each player accepts or counters.
Counters are handled biggest stake first: the boss either **agrees** (that player is locked in at their price, and the boss re-splits
what's left for everyone else to answer again) or **duels** (best 4-card hand wins; ties go to the boss).
Boss loses a duel: the challenger takes the boss's stake and everyone else gets their stake back.
Challenger loses: their stake goes to the boss. First to the target wins; 0 money means you're out.
