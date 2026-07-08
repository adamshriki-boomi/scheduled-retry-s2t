/**
 * S2T wizard — mutable mock state.
 *
 * The "create new Source-to-Target data flow" wizard does several client-side
 * navigations (activation modal -> history.replace to the river summary page),
 * and the summary page can remount and re-fetch the river it just created. So
 * a created river must SURVIVE those navigations: we persist it in
 * sessionStorage (cleared when the tab closes, so the demo resets on reload).
 *
 * Poll counters (test-connection / activation / run progress) only need to live
 * for the duration of one flow, so a module-level Map is enough — they don't
 * need to survive a remount, and starting fresh on reload is the desired behavior.
 */

const STORAGE_KEY = 'bdi-mock-s2t-rivers';

/** A created river, stored in the V1 (source-to-target module) response shape. */
export interface StoredRiver {
  cross_id: string;
  name: string;
  group_id: string;
  group_name: string;
  river_status: 'disabled' | 'active';
  /** Full V1 river payload as submitted (properties/source/target/schemas...). */
  payload: any;
  /** Flat list of selected "schema.table" pairs, for run-progress counters. */
  selectedTables: string[];
  created_at: number;
}

const readStore = (): Record<string, StoredRiver> => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeStore = (store: Record<string, StoredRiver>) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* sessionStorage unavailable (e.g. SSR) — polls still work in-memory */
  }
};

/** Count selected tables across the client-side schemas object of a payload. */
const countSelectedTables = (payload: any): string[] => {
  const schemas = payload?.properties?.schemas ?? {};
  const pairs: string[] = [];
  // Client schemas are { [schemaName]: { [tableName]: ISelectedTable } }; on the
  // wire they may already be the array form [{ name, tables: [...] }].
  if (Array.isArray(schemas)) {
    schemas.forEach((s: any) =>
      (s?.tables ?? []).forEach((t: any) =>
        pairs.push(`${s.name}.${t?.details?.name ?? t?.name}`),
      ),
    );
  } else {
    Object.entries(schemas).forEach(([schemaName, tables]: [string, any]) =>
      Object.values(tables ?? {})
        .filter((t: any) => t && t.is_selected !== false)
        .forEach((t: any) => pairs.push(`${schemaName}.${t.name}`)),
    );
  }
  return pairs;
};

export const saveRiver = (crossId: string, name: string, payload: any) => {
  const store = readStore();
  const existing = store[crossId];
  store[crossId] = {
    cross_id: crossId,
    name,
    group_id: payload?.group_id ?? '',
    group_name: payload?.group_name ?? '',
    river_status: existing?.river_status ?? 'disabled',
    payload,
    selectedTables: countSelectedTables(payload),
    created_at: existing?.created_at ?? 1717200000000,
  };
  writeStore(store);
  return store[crossId];
};

export const getRiver = (crossId: string): StoredRiver | undefined =>
  readStore()[crossId];

export const activateRiver = (crossId: string) => {
  const store = readStore();
  if (store[crossId]) {
    store[crossId].river_status = 'active';
    writeStore(store);
  }
  return store[crossId];
};

/** Created rivers, newest first — merged into the Data Flows grid. */
export const listCreated = (): StoredRiver[] =>
  Object.values(readStore()).sort((a, b) => b.created_at - a.created_at);

// --- Poll counters (in-memory; reset on reload) --------------------------

const pollCounters = new Map<string, number>();

/** Increment and return the poll count for an operation/run id (1-based). */
export const bumpPoll = (id: string): number => {
  const next = (pollCounters.get(id) ?? 0) + 1;
  pollCounters.set(id, next);
  return next;
};
