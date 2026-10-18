import { describe, expect, it } from "vitest";
import { inputHash, selectVehicles } from "../src/selection";
import { QuarterlySelectionService, quarterOf } from "../src/service";
import { InMemorySelectionStore } from "../src/store";

const fleet = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
const inQ4 = new Date("2026-11-15T00:00:00Z");

// Each call gives a new seed, so a second run that drew again would show up as a different pick.
// The clock starts in 2026-Q4; setNow moves it.
function setup() {
  const store = new InMemorySelectionStore();
  let seeds = 0;
  let now = inQ4;
  const service = new QuarterlySelectionService(store, () => `seed-${++seeds}`, () => now);
  return { service, store, seedCount: () => seeds, setNow: (d: Date) => (now = d) };
}

const req = { companyId: "company-a", quarter: "2026-Q4", percent: 25, vehicleIds: fleet(20) };

// toEqual, not toBe: a Postgres store returns a new object each time, so these tests still hold.
describe("QuarterlySelectionService", () => {
  it("returns the saved pick when run twice for the same company and quarter", async () => {
    const { service } = setup();
    const first = await service.run(req);
    const second = await service.run(req);
    expect(second).toEqual(first);
    expect(second.picked).toHaveLength(5);
  });

  it("keeps the saved pick even if the fleet or percent changed since the first run", async () => {
    const { service } = setup();
    const first = await service.run(req);
    const second = await service.run({ ...req, percent: 50, vehicleIds: fleet(21).slice(1) });
    expect(second).toEqual(first);
  });

  it("does not draw a new seed on a repeat run", async () => {
    const { service, seedCount } = setup();
    await service.run(req);
    await service.run({ ...req, percent: 0 }); // not checked: the saved pick comes back first
    expect(seedCount()).toBe(1);
  });

  it("saves only one pick when two runs start at the same time", async () => {
    const { service, seedCount } = setup();
    const [a, b] = await Promise.all([service.run(req), service.run(req)]);
    expect(seedCount()).toBe(2); // both runs drew a seed, so both really ran at once
    expect(b).toEqual(a);
  });

  it("gives each company and each quarter its own pick", async () => {
    const { service, setNow } = setup();
    const a = await service.run(req);
    const b = await service.run({ ...req, companyId: "company-b" });
    setNow(new Date("2027-02-01T00:00:00Z"));
    const next = await service.run({ ...req, quarter: "2027-Q1" });
    expect(new Set([a.id, b.id, next.id]).size).toBe(3);
  });

  it("keeps last quarter's picks eligible, with the same chance as any vehicle", async () => {
    const { service, setNow } = setup();
    let repicked = 0;
    let picked = 0;
    for (let c = 0; c < 1000; c++) {
      setNow(new Date("2026-08-15T00:00:00Z"));
      const q3 = await service.run({ ...req, companyId: `c${c}`, quarter: "2026-Q3" });
      setNow(inQ4);
      const q4 = await service.run({ ...req, companyId: `c${c}`, quarter: "2026-Q4" });
      repicked += q3.picked.filter((id) => q4.picked.includes(id)).length;
      picked += q3.picked.length;
    }
    expect(repicked / picked).toBeCloseTo(0.25, 1); // 25% of vehicles are picked each quarter
  });

  it("saves a sorted copy of the vehicle list, so later changes by the caller do not touch it", async () => {
    const { service } = setup();
    const ids = fleet(20).reverse();
    const before = [...ids];
    const saved = await service.run({ ...req, vehicleIds: ids });
    expect(ids).toEqual(before); // the caller's list is not sorted in place
    ids.push("v99");
    expect(saved.vehicleIds).toEqual(fleet(20).sort());
  });

  it("rejects bad input on the first run and saves nothing", async () => {
    const { service, store } = setup();
    await expect(service.run({ ...req, percent: 0 })).rejects.toThrow(/percent/);
    expect(await store.find(req.companyId, req.quarter)).toBeUndefined();
    expect((await service.run(req)).picked).toHaveLength(5);
  });

  it("refuses an empty fleet, saves nothing, and runs once vehicles exist", async () => {
    const { service, store } = setup();
    await expect(service.run({ ...req, vehicleIds: [] })).rejects.toThrow(/no active vehicles/);
    expect(await store.find(req.companyId, req.quarter)).toBeUndefined();
    expect((await service.run(req)).picked).toHaveLength(5);
  });

  it("lets an auditor re-run the pick from the saved record alone", async () => {
    const { service } = setup();
    const record = JSON.parse(JSON.stringify(await service.run(req))); // as exported, no live objects
    expect(record.methodVersion).toBe("hmac-sha256-rank-v1");
    expect(inputHash(record.vehicleIds)).toBe(record.inputHash);
    expect(selectVehicles(record)).toEqual(record.picked);
  });

  it("uses a new random seed by default", async () => {
    const service = () => new QuarterlySelectionService(new InMemorySelectionStore(), undefined, () => inQ4);
    const a = await service().run(req);
    const b = await service().run(req);
    expect(a.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(b.seed).not.toBe(a.seed);
  });

  it("refuses a future or past quarter, and saves nothing", async () => {
    const { service, store } = setup();
    for (const quarter of ["2027-Q1", "2099-Q4", "2026-Q3"]) {
      await expect(service.run({ ...req, quarter })).rejects.toThrow(/current quarter, 2026-Q4/);
      expect(await store.find(req.companyId, quarter)).toBeUndefined();
    }
  });

  it("still returns the saved pick after its quarter has ended", async () => {
    const { service, setNow } = setup();
    const first = await service.run(req);
    setNow(new Date("2027-05-01T00:00:00Z"));
    expect(await service.run(req)).toEqual(first);
  });
});

describe("quarterOf", () => {
  it.each([
    ["2026-01-01T00:00:00Z", "2026-Q1"],
    ["2026-03-31T23:59:59.999Z", "2026-Q1"],
    ["2026-04-01T00:00:00Z", "2026-Q2"],
    ["2026-09-30T23:59:59.999Z", "2026-Q3"],
    ["2026-12-31T23:59:59.999Z", "2026-Q4"],
  ])("%s is in %s (UTC)", (iso, quarter) => {
    expect(quarterOf(new Date(iso))).toBe(quarter);
  });
});
