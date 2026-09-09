# Hosting / 24×7 deployment

The architecture (engine writes JSON/JSONL to `data/`, Next.js reads the same folder)
means hosting = **one always-on machine running both processes**. No database, no
separate API server, no shared hosting — you need a small Linux VPS.

## Option 1 — keep it on this PC (free, not 24×7)
It only runs while your PC is awake. Fine for watching; it will stop on sleep/shutdown.

## Option 2 — cheap VPS (recommended, ~$4–6/month)
Hetzner, DigitalOcean, Vultr, AWS Lightsail, Oracle Cloud free tier — any Ubuntu
box with 1 vCPU / 1 GB RAM is plenty (the engine is a single Node loop + Next.js).

```bash
# on your PC: copy the project up
git clone https://gitlab.com/team-phoenix2471436/trading-bot.git
cd trading-bot
bash deploy/setup.sh
```

That script: installs Node 22 + PM2, builds the web app, runs the idempotent init,
starts both processes, and enables reboot survival.

Everyday commands:
```bash
pm2 status                # both processes running?
pm2 logs fabinvests-engine --lines 50
pm2 restart fabinvests-engine
node tests/live-smoke.mjs # provider health check
```

## Reliability contract (added 2026-09-09)

- Engine is an independent process: refresh/reconnect/close never restarts a run.
- Each cycle stamps snapshotId into state+signals; API reports
  snapshot.consistent; UI keeps last good frame on torn reads.
- heartbeat.v2.json each cycle; API liveness, sidebar LIVE/RECONNECTING/STALE.
- POST accepts clientToken + 30s deep-equal dedupe (no duplicate restarts).
- Poison commands move to capped errors after 5 failures.
- Validated: 58/58 tests, tsc clean, next build clean, live --once + live-smoke green.

## Security rules (do not skip)
- **Never expose port 3000 publicly.** The dashboard is read-only, but it also
  advertises "my bot runs here". Keep it firewalled and view it via SSH tunnel:
  `ssh -L 3000:localhost:3000 user@vps` → http://localhost:3000,
  or via Tailscale/Cloudflare Access if you want zero-config private access.
- API keys (e.g. `GOOGLE_API_KEY`) belong strictly in your machine-local `.env` file,
  which is gitignored. Never commit `.env` or paste secrets into public repositories.
- `data/` is machine-local runtime state. Do not commit or sync it between hosts;
  each host starts its own Episode 1. Copying it around risks double-counting trades.

## What 24×7 buys you (and what it doesn't)
- ✅ Episodes actually complete (goal / blowup / 24h timeout), lessons bank, generations evolve.
- ✅ Funding at 00/08/16 UTC is charged — impossible to see if the bot sleeps overnight.
- ✅ Strategy statistics accumulate toward the 30-trade promotion gate.
- ❌ It does NOT make the bot profitable. It's still a paper simulator with unproven
  strategies. Uptime is for honest data, not for earnings.

## Migrating an existing run from this PC
Optional: `tar` the `data/` folder and untar it in the VPS project root *before* first
init. State, journals, lessons and learned stats carry over. Keep `data/` off git
(it's already gitignored).
