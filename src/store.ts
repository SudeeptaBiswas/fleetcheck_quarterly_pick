import type { SelectionInput } from "./selection";

// One saved pick: its inputs (so it can be re-run) plus the result.
export interface Selection extends SelectionInput {
  id: string;
  companyId: string;
  methodVersion: string;
  inputHash: string;
  picked: string[];
  createdAt: Date;
}

// Thin store, so the service can run each pick only once.
// Postgres version: unique (company_id, quarter); INSERT ... ON CONFLICT DO NOTHING, then read the saved row.
export interface SelectionStore {
  find(companyId: string, quarter: string): Promise<Selection | undefined>;
  // Saves the pick unless one exists for its company and quarter. Returns the saved one.
  insertIfAbsent(selection: Selection): Promise<Selection>;
}

// Keeps and hands out copies, like a database does, so a caller that changes a returned pick
// cannot change the saved one.
export class InMemorySelectionStore implements SelectionStore {
  private readonly rows = new Map<string, Selection>();

  async find(companyId: string, quarter: string): Promise<Selection | undefined> {
    const row = this.rows.get(key(companyId, quarter));
    return row && structuredClone(row);
  }

  async insertIfAbsent(selection: Selection): Promise<Selection> {
    const k = key(selection.companyId, selection.quarter);
    if (!this.rows.has(k)) this.rows.set(k, structuredClone(selection));
    return structuredClone(this.rows.get(k)!);
  }
}

function key(companyId: string, quarter: string): string {
  return `${companyId}|${quarter}`;
}
