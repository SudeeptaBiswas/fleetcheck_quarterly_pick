import { randomBytes, randomUUID } from "node:crypto";
import { METHOD_VERSION, inputHash, selectVehicles } from "./selection";
import type { Selection, SelectionStore } from "./store";

export interface RunRequest {
  companyId: string;
  quarter: string;
  percent: number;
  vehicleIds: readonly string[]; // active vehicles, read when the pick runs
}

export class QuarterlySelectionService {
  constructor(
    private readonly store: SelectionStore,
    // A new secret seed for each pick, so nobody can know the pick before it runs. Tests pass a fixed one.
    private readonly newSeed: () => string = () => randomBytes(32).toString("hex"),
    // The clock. Tests pass a fixed date.
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Runs a company's pick for a quarter once. Any later run returns the saved pick,
  // even if the fleet or the percent changed in between, or the quarter has ended.
  async run(req: RunRequest): Promise<Selection> {
    const existing = await this.store.find(req.companyId, req.quarter);
    if (existing) return existing;

    // A new pick only for the quarter we are in. A typo or a future quarter would lock that
    // quarter for good with today's fleet. Refuse and save nothing.
    const current = quarterOf(this.now());
    if (req.quarter !== current) throw new Error(`can only run the current quarter, ${current}`);

    // An empty pick would lock the quarter with nothing inspected (e.g. run before the fleet import).
    // Refuse and save nothing; ops runs again once vehicles exist.
    if (req.vehicleIds.length === 0) throw new Error("no active vehicles");

    // Saved sorted, so the snapshot is the same whatever order the database returned.
    const vehicleIds = [...req.vehicleIds].sort();
    const seed = this.newSeed();
    const picked = selectVehicles({ vehicleIds, percent: req.percent, quarter: req.quarter, seed });

    // Two runs at the same time: both get here, but the store keeps only the first.
    return this.store.insertIfAbsent({
      id: randomUUID(),
      companyId: req.companyId,
      quarter: req.quarter,
      percent: req.percent,
      seed,
      methodVersion: METHOD_VERSION,
      vehicleIds,
      inputHash: inputHash(vehicleIds),
      picked,
      createdAt: this.now(),
    });
  }
}

// The quarter a date falls in, e.g. "2026-Q4". UTC, so it does not depend on the server's time zone.
export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}
