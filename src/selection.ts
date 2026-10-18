import { createHash, createHmac } from "node:crypto";

// Saved with every pick. A new method gets a new version; old code stays, so old picks can still be re-run.
export const METHOD_VERSION = "hmac-sha256-rank-v1";

export interface SelectionInput {
  vehicleIds: readonly string[]; // the company's active vehicles
  percent: number; // whole number, 1 to 100
  quarter: string; // e.g. "2026-Q4"
  seed: string; // random; saved so an auditor can re-run the pick
}

const QUARTER = /^\d{4}-Q[1-4]$/;

// How many to pick: percent of the fleet, rounded up (so any fleet with a vehicle gets at least 1).
export function pickCount(vehicleCount: number, percent: number): number {
  return Math.ceil((vehicleCount * percent) / 100);
}

// Random order that the same inputs always repeat.
// Each vehicle gets a score: HMAC-SHA256, keyed by the seed, over "quarter:vehicleId".
// Lowest score first. Scores behave like random numbers, so every order is equally likely,
// and the order of the input list does not matter.
export function rankVehicles(input: SelectionInput): string[] {
  validate(input);
  const scored = input.vehicleIds.map((id) => ({ id, score: score(input.seed, input.quarter, id) }));
  scored.sort(byScoreThenId);
  return scored.map((v) => v.id);
}

// The pick: the first k of the ranked list, so each vehicle has the same chance, k / n.
export function selectVehicles(input: SelectionInput): string[] {
  return rankVehicles(input).slice(0, pickCount(input.vehicleIds.length, input.percent));
}

// Fingerprint of the vehicle list. An auditor checks it to prove they re-run with the list we used.
export function inputHash(vehicleIds: readonly string[]): string {
  return createHash("sha256").update([...vehicleIds].sort().join("\n")).digest("hex");
}

function score(seed: string, quarter: string, vehicleId: string): string {
  return createHmac("sha256", seed).update(`${quarter}:${vehicleId}`).digest("hex");
}

// Hex strings of equal length sort like the numbers they encode. A tie (practically never)
// falls back to the id, so the order is always the same.
function byScoreThenId(a: { id: string; score: string }, b: { id: string; score: string }): number {
  if (a.score !== b.score) return a.score < b.score ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

function validate({ vehicleIds, percent, quarter, seed }: SelectionInput): void {
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new Error("percent must be a whole number from 1 to 100");
  }
  if (!QUARTER.test(quarter)) throw new Error("quarter must look like 2026-Q4");
  if (seed.length === 0) throw new Error("seed is required");
  if (new Set(vehicleIds).size !== vehicleIds.length) throw new Error("vehicle ids must be unique");
}
