import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { METHOD_VERSION, inputHash, pickCount, rankVehicles, selectVehicles } from "../src/selection";

const fleet = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
const base = { vehicleIds: fleet(20), percent: 25, quarter: "2026-Q4", seed: "seed-1" };

describe("selectVehicles", () => {
  it.each([
    [20, 25, 5],
    [3, 25, 1], // 0.75 rounds up to 1
    [1, 1, 1],
    [0, 25, 0],
    [7, 100, 7],
  ])("%i vehicles at %i percent picks %i", (n, percent, expected) => {
    expect(pickCount(n, percent)).toBe(expected);
    expect(selectVehicles({ ...base, vehicleIds: fleet(n), percent })).toHaveLength(expected);
  });

  it("picks every vehicle at 100 percent", () => {
    expect([...selectVehicles({ ...base, percent: 100 })].sort()).toEqual([...base.vehicleIds].sort());
  });

  it("picks the first k of the ranked list", () => {
    const ranked = rankVehicles(base);
    expect([...ranked].sort()).toEqual([...base.vehicleIds].sort());
    expect(selectVehicles(base)).toEqual(ranked.slice(0, 5));
  });

  it("gives every vehicle the same chance", () => {
    const counts = new Map<string, number>();
    const rounds = 4000;
    for (let i = 0; i < rounds; i++) {
      for (const id of selectVehicles({ ...base, seed: `seed-${i}` })) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const expected = (rounds * 5) / 20; // 5 of 20 picked each round → 1000 each
    for (const id of base.vehicleIds) {
      expect(Math.abs((counts.get(id) ?? 0) - expected)).toBeLessThan(expected * 0.1);
    }
  });

  it("gives the same pick for the same inputs, so an auditor can reproduce it", () => {
    // Fixed result for these inputs. If the method changes, this fails: give it a new METHOD_VERSION.
    expect(selectVehicles(base)).toEqual(["v0", "v7", "v10", "v16", "v4"]);
    expect(METHOD_VERSION).toBe("hmac-sha256-rank-v1");
  });

  it("matches an HMAC computed by hand, as an auditor would", () => {
    const score = (id: string) => createHmac("sha256", "seed-1").update(`2026-Q4:${id}`).digest("hex");
    expect(score("v0")).toBe("03aa88a32484da6129309cb16b22d365a69be998f34344d4826804de1422adfc"); // also checked in Python
    const byHand = [...base.vehicleIds].sort((a, b) => (score(a) < score(b) ? -1 : 1));
    expect(rankVehicles(base)).toEqual(byHand);
  });

  it("uses the seed's hex text as the HMAC key, not its bytes", () => {
    const seed = "ab".repeat(32); // decoded to bytes, this key gives the reverse order
    expect(rankVehicles({ ...base, vehicleIds: ["v1", "v2"], seed })).toEqual(["v2", "v1"]);
  });

  it("keeps the order of the others when one vehicle is removed", () => {
    const without = rankVehicles({ ...base, vehicleIds: base.vehicleIds.filter((id) => id !== "v7") });
    expect(without).toEqual(rankVehicles(base).filter((id) => id !== "v7"));
  });

  it("gives the same pick whatever the order of the vehicle list", () => {
    const reversed = [...base.vehicleIds].reverse();
    expect(selectVehicles({ ...base, vehicleIds: reversed })).toEqual(selectVehicles(base));
  });

  it("gives a different pick for a different seed or quarter", () => {
    const sorted = (ids: string[]) => [...ids].sort();
    const pick = sorted(selectVehicles(base));
    expect(sorted(selectVehicles({ ...base, seed: "seed-2" }))).not.toEqual(pick);
    expect(sorted(selectVehicles({ ...base, quarter: "2027-Q1" }))).not.toEqual(pick);
  });

  it("works for 200,000 vehicles", () => {
    const vehicleIds = fleet(200_000);
    const start = performance.now();
    const picked = selectVehicles({ ...base, vehicleIds });
    const ms = performance.now() - start;
    console.log(`200,000 vehicles: ${picked.length} picked in ${ms.toFixed(0)} ms`);

    expect(picked).toHaveLength(50_000);
    expect(new Set(picked).size).toBe(50_000);
    const all = new Set(vehicleIds);
    expect(picked.every((id) => all.has(id))).toBe(true);
  });

  it.each([
    ["percent 0", { percent: 0 }, /percent/],
    ["percent over 100", { percent: 101 }, /percent/],
    ["percent not whole", { percent: 12.5 }, /percent/],
    ["quarter Q5", { quarter: "2026-Q5" }, /quarter/],
    ["quarter Q0", { quarter: "2026-Q0" }, /quarter/],
    ["quarter with extra text after", { quarter: "2026-Q4x" }, /quarter/],
    ["quarter with extra text before", { quarter: "x2026-Q4" }, /quarter/],
    ["quarter in lower case", { quarter: "2026-q4" }, /quarter/], // else "2026-q4" could get a second pick
    ["empty seed", { seed: "" }, /seed/],
    ["duplicate vehicle", { vehicleIds: ["v1", "v2", "v1"] }, /unique/],
  ])("rejects %s", (_, bad, message) => {
    expect(() => selectVehicles({ ...base, ...bad })).toThrow(message);
    expect(() => rankVehicles({ ...base, ...bad })).toThrow(message);
  });
});

describe("inputHash", () => {
  it("is the same whatever the order, and changes when the list changes", () => {
    expect(inputHash(["a", "b"])).toBe(inputHash(["b", "a"]));
    expect(inputHash(["a", "b"])).not.toBe(inputHash(["a", "b", "c"]));
  });

  it("hashes the vehicle list as sorted ids joined by new lines", () => {
    expect(inputHash(["b", "a"])).toBe(createHash("sha256").update("a\nb").digest("hex"));
    expect(inputHash(["b", "a"])).toBe("7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78"); // also checked in Python
  });
});
