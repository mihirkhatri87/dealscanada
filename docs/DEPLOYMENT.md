# Deployment

The whole thing runs for about **$2 a month**, on two services:

| Piece | Where | Cost |
|---|---|---|
| Next.js server, scrape worker, SQLite database | one Fly.io machine in Toronto | ~$1.94 machine + ~$0.15 volume |
| CI, deploys, scrape schedule | GitHub Actions | free |

Fly is not a database host — it boots the repo's existing `Dockerfile` as a real
VM, so the app and its data live together and there is no second service to
provision, expire, or pay for.

---

## Two decisions worth understanding

**The machine is in Toronto (`yyz`), and that is not a preference.** Every
retailer in the catalogue is Canadian. Several geo-redirect a US visitor to a
`.com` storefront, price in USD, or refuse outright — it is exactly why
`npm run health` has to be run from a Canadian IP. A machine in a US region
would quietly collect the wrong catalogue and report it as a success.

**GitHub schedules the scrape; Fly runs it.** GitHub-hosted runners are
US-based, so a scrape executing on the runner would hit that same problem. The
workflow is a scheduler and nothing else: it calls `POST /api/cron/scrape`, and
the machine does the work from a Canadian IP against the volume it already owns.
That also sidesteps hosted-cron frequency caps entirely.

---

## Why not Vercel

`vercel.json` is still in the repo and still correct **for a Vercel Pro
account**. It is not an option on the free Hobby plan, for two independent
reasons:

- Hobby is **non-commercial only**, and Vercel's fair-use policy names affiliate
  linking specifically. Once an affiliate feed is wired in (see
  [AFFILIATE-PROGRAMS.md](./AFFILIATE-PROGRAMS.md)), this site is commercial.
- Hobby caps cron at **once per day** and functions at **10 seconds**. The
  committed `vercel.json` asks for every six hours and `maxDuration: 300`, so it
  fails at deploy time rather than degrading.

Vercel Pro is $20/month, which is ten times the Fly setup for this workload.

---

## First deploy

You need a Fly account with a card on file — there is no longer a free
allowance, and the bill for this shape is a couple of dollars.

```powershell
# 1. Install and sign in
iwr https://fly.io/install.ps1 -useb | iex
fly auth login

# 2. Create the app WITHOUT deploying, so the volume exists before first boot
fly apps create dealscanada
fly volumes create dealscanada_data --region yyz --size 1 --app dealscanada

# 3. Secrets. CRON_SECRET is required or the scrape endpoint refuses everyone.
fly secrets set CRON_SECRET="$([guid]::NewGuid().ToString('N'))" --app dealscanada
# Optional, and only if you want the shopping assistant:
# fly secrets set ANTHROPIC_API_KEY="sk-ant-..." --app dealscanada
# Optional, once an affiliate application is approved:
# fly secrets set AFFILIATE_FEEDS='{"mec":"https://..."}' --app dealscanada

# 4. First deploy from your machine
fly deploy

# 5. Populate it. The machine is in Canada, so this is the real catalogue.
fly ssh console --app dealscanada -C "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)\""
```

Then seed the first scrape by running the **Scrape** workflow manually from the
Actions tab, or:

```powershell
curl -X POST https://dealscanada.fly.dev/api/cron/scrape -H "Authorization: Bearer <CRON_SECRET>"
```

---

## Handing the pipeline over to GitHub

Two repository secrets, one optional variable:

| Name | Kind | Value |
|---|---|---|
| `FLY_API_TOKEN` | secret | `fly tokens create deploy --app dealscanada` |
| `CRON_SECRET` | secret | the same value you set with `fly secrets set` |
| `APP_URL` | variable | only if not `https://dealscanada.fly.dev` |

`Settings → Secrets and variables → Actions`. The deploy job also targets a
`production` environment, so you can add a required reviewer there if you ever
want deploys to pause for approval.

After that:

- **push to `main`** → CI runs → on green, Deploy runs → the app is verified
  serving `/api/health` before the job passes.
- **every six hours** → Scrape runs, and the per-source outcome is written to the
  workflow summary.

A red CI never deploys: the deploy job gates on
`workflow_run.conclusion == 'success'` and checks out the exact commit CI
tested, not whatever `main` has drifted to since.

---

## The one thing to be careful about

SQLite is a file, and a file has one writer. **Do not scale this app past one
machine.** Two would mount the same volume and write the same database.

Scaling means a bigger machine, or moving to Postgres — which is one
environment variable (`DATABASE_URL`), needs no code change, and is already
covered by the `postgres` job in CI. Neon's free tier is a reasonable landing
spot if you outgrow the volume.

Losing the volume is worse than it looks: the price history is what
`verified-low` is measured against, so an empty database does not just lose
data, it makes every deal *look* like the lowest price ever recorded until
history rebuilds. `fly volumes snapshots list dealscanada_data` is worth
knowing.
