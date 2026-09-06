# Working in this repo

## Commit in manageable chunks, whenever the build is stable

Do not accumulate a session's worth of work into one commit. As soon as a
coherent piece of work is finished and the build is stable, commit it, then
carry on with the next piece.

"Stable" means all three of these pass, not just the one related to the change:

```powershell
npm test          # currently 711 tests, none touching the network
npm run typecheck
npm run lint
```

A chunk is one reviewable idea: an engine fix, a feature, a batch of catalogue
corrections. If the commit message needs the word "and" to describe what it
did, it is probably two commits. Prefer several small commits over one large
one even when the work was done in a single pass — the history is what explains
a decision to whoever hits it next.

Do not run `npm run format` to fix a diff. `format:check` currently reports ~159
files across the whole repo (line endings on Windows), so a global rewrite would
bury the actual change.

Branch before committing when on `main`.

## Adapters: verify against the live site, never infer

Every adapter here was originally written against documented response shapes in
a sandbox where the proxy 403s every retailer host, so a catalogue entry being
present is not evidence that it works. `npm run health` from a Canadian IP is
the only thing that settles it.

Before changing a catalogue entry, check the real site: `/collections.json` for
Shopify, `Sites-<id>-Site` in the HTML for SFCC. Several entries name the wrong
engine outright, so "the selector drifted" is often really "this was never that
platform". Set `status` from what health actually printed.

## robots.txt is a constraint on the fix, not a detail

A fix that works but that robots.txt disallows is not a fix. Roots parses
cleanly and is still disabled, because its only entry point matches a
`Disallow: */Search` rule. When a probe hangs or times out, check whether it is
the robots fetch failing rather than the endpoint.

Check which `user-agent` group a rule belongs to before acting on it — Shopify's
stock robots.txt ends with `Disallow: /` under `User-agent: Nutch`, which does
not apply to us.

## Two invariants worth not breaking

- **Money is integer cents.** No float touches a price.
- **A deal's own current price is excluded from its own history**, or everything
  is trivially at its lowest recorded price.
