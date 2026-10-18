import { describe, expect, it } from "vitest";
import { type Selection, InMemorySelectionStore } from "../src/store";

// The rule any store must keep (a Postgres store too): first pick saved wins.
const pick = (id: string, picked: string[]): Selection => ({
  id,
  companyId: "company-a",
  quarter: "2026-Q4",
  percent: 25,
  seed: `seed-${id}`,
  methodVersion: "test",
  vehicleIds: ["v1", "v2", "v3", "v4"],
  inputHash: "hash",
  picked,
  createdAt: new Date(0),
});

describe("InMemorySelectionStore", () => {
  it("keeps the first pick for a company and quarter, and returns it to later inserts", async () => {
    const store = new InMemorySelectionStore();
    const first = await store.insertIfAbsent(pick("first", ["v1"]));
    const second = await store.insertIfAbsent(pick("second", ["v2"]));
    expect(second).toEqual(first);
    expect(await store.find("company-a", "2026-Q4")).toEqual(first);
  });

  it("finds nothing for a company or quarter with no pick", async () => {
    const store = new InMemorySelectionStore();
    await store.insertIfAbsent(pick("first", ["v1"]));
    expect(await store.find("company-b", "2026-Q4")).toBeUndefined();
    expect(await store.find("company-a", "2027-Q1")).toBeUndefined();
  });

  it("keeps the saved pick unchanged when a caller changes what it was given or got back", async () => {
    const store = new InMemorySelectionStore();
    const given = pick("first", ["v1"]);
    const returned = await store.insertIfAbsent(given);
    given.picked.push("v2");
    returned.picked.push("v3");
    (await store.find("company-a", "2026-Q4"))!.picked.push("v4");
    expect((await store.find("company-a", "2026-Q4"))!.picked).toEqual(["v1"]);
  });
});
