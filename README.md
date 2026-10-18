# FleetCheck: quarterly random pick

Each quarter, a set share of a company's active vehicles gets a surprise inspection, chosen at random.
This code makes that pick: fair, repeatable by an auditor, and made only once per company and quarter.

## Run

Needs Node.js 22.12 or later (tested on 24.20.0).

```
npm ci
npm test            # 48 tests
npm run typecheck
```

## How it works

- **Score:** each vehicle gets `HMAC-SHA256(key = seed, message = "quarter:vehicleId")`, as hex.
  The key is the seed's 64 hex characters, used as text (not decoded to bytes).
- **Pick:** sort by score, lowest first (the hex compared as text), then take the first `ceil(n × percent / 100)`.
  `rankVehicles` gives the full order; `selectVehicles` takes the first k.
- **Fair:** the scores act like independent random numbers, so every order of the fleet is equally likely,
  and each vehicle ends up in the first k with the same chance, k / n. A test checks this over 4,000 seeds.
- **Seed:** 32 random bytes, made when the pick first runs and saved with it.
  Nobody can know the pick before it runs; anyone with the saved seed can repeat it afterwards.
- **Once per quarter:** the store keeps one pick per company and quarter; a second run returns it.
  In Postgres: unique key on `(company_id, quarter)`, `INSERT ... ON CONFLICT DO NOTHING`, then read the saved row.
- **Audit:** saved with each pick: the vehicle list (sorted by character code, JavaScript's default sort),
  its SHA-256 hash (ids joined by new lines, UTF-8, no new line at the end),
  percent, quarter, seed, method version and result (in rank order). An auditor checks the hash, then calls `selectVehicles(saved)`
  (or any HMAC tool) and gets the same vehicles.
- **Last quarter:** the pick has no memory. Every active vehicle is in every draw.

| File | Holds |
|---|---|
| `src/selection.ts` | Pure core: score, rank, pick, list hash, input checks |
| `src/store.ts` | Saved pick type, store interface, in-memory store (keeps and returns copies) |
| `src/service.ts` | Runs the pick once per company and quarter, only in the current quarter; makes the seed |
| `test/` | 48 tests, named after the rule each one checks |

## Complexity

n = active vehicles, k = vehicles picked.

- **Time:** O(n log n). One HMAC per vehicle is O(n); the sort is O(n log n).
- **Space:** O(n). One score per vehicle, plus the saved list.
- **Measured:** 200,000 vehicles, 50,000 picked, in 876–962 ms (6 runs, Node 24, my Windows PC). Most of it is HMAC.
  To see the time: `npx vitest run --silent=false`.
- A heap of size k would make it O(n log k). Not needed at this size.

## Edge case: the fleet changes after the pick

Fleets change: vehicles are added and sold. If an auditor re-ran a pick next year with the company's
*current* vehicles, they would get a different result, and a fair pick would look changed.

- Fix: save the exact list used (sorted) and its hash with the pick. A later run for the same quarter returns
  the saved pick, even if the fleet or the percent changed since. The auditor re-runs from the saved list.
- Test: "keeps the saved pick even if the fleet or percent changed since the first run".

Also handled:
- Small fleets round up: 3 vehicles at 25% → 1.
- Percent must be a whole number, 1 to 100. With decimals, floating point goes wrong:
  1.1% of 200,000 computes as 2200.0000000000005, which rounds up to 2,201.
- A duplicate vehicle id is rejected; it would get the same score twice.
- 0 active vehicles is refused and nothing is saved. Otherwise an early run (before the fleet import)
  would lock the quarter with no inspections.
- A new pick runs only for the current quarter (UTC clock, passed in so tests can set it).
  A typo or a future quarter is refused and nothing is saved; otherwise it would lock that quarter for good.

## Assumptions and limits

- The caller passes only active vehicles; the database query does the filtering.
- The seed and the pick stay hidden from the company until ops releases them.
- The store here is in memory. The Postgres version is described above.
- A missed quarter cannot be picked late; ops runs each pick within its quarter.
- A repeat run returns the saved pick, even after its quarter ends, without checking its input.
- A change to the method gets a new `METHOD_VERSION`; the old code stays, so old picks can still be re-run.
- Not built: proof that nobody deleted a pick and ran it again with a new seed. The design covers it with an
  append-only audit log and write-once storage for the saved picks. A public random beacon as the seed would close it,
  if the beacon round is fixed and logged before its value is published.

## AI use

Built with Claude Code (Claude Opus 5.5). I chose the design: a random seed with HMAC ranking, Vitest,
and a thin store for run-once. Claude drafted the code, tests and this README; I reviewed every line.
