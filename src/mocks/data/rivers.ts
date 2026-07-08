/**
 * Data Flows list responses.
 *
 * Primary (account has use_new_river_list=true): the V1 grid
 *   GET .../environments/:env/rivers_search  → IRiversData { items: IRiverItem[], ... }
 * Safety net (legacy list):
 *   GET /api/rivers                          → { data: IRiver[], total_rivers, ... }
 * Plus the two gates the Rivers/Dashboard pages call:
 *   GET .../has_rivers                       → { has_rivers: true }
 *   GET .../sources_list                     → { sources: [...] }
 */
import { ACCOUNT_ID, ENV_PROD_ID } from '../fixtures';
import { connectorById, groupByKey, oid } from './_shared';
import { Flow, FLOWS } from './seed';
import { listCreated, StoredRiver } from './s2t.state';

const describe = (f: Flow): string => {
  if (f.index % 5 === 4) return ''; // some flows have no description
  return f.type === 'logic'
    ? 'Scheduled transformation logic.'
    : `Ingests ${connectorById(f.source)?.name} objects into the warehouse.`;
};

/** Derive the target warehouse id from the flow name ("→ Snowflake" etc.). */
const targetTypeFromName = (name: string): string => {
  if (name.includes('BigQuery')) return 'bigquery';
  if (name.includes('Redshift')) return 'redshift';
  if (name.includes('Snowflake')) return 'snowflake';
  return '';
};

const toRiverItem = (f: Flow) => ({
  name: f.name,
  river_status: 'active',
  group_name: groupByKey(f.group).name,
  group_id: f.groupCross,
  river_schedulers: f.scheduled ? [`sch_${f.cross}`] : [],
  datasource_id: f.source,
  last_user_name_modified: f.modifiedBy,
  river_cross_id: f.cross,
  last_updated_at: f.lastModified,
  description: describe(f),
  is_api_v2: true,
  river_type: f.type,
  target_type: targetTypeFromName(f.name),
});

// Rivers created via the S2T wizard, projected into a grid row so they show up
// alongside the seed flows (newest first) and the Data Flows grid stays consistent.
const createdToRiverItem = (r: StoredRiver) => ({
  name: r.name,
  river_status: r.river_status,
  group_name: r.group_name,
  group_id: r.group_id,
  river_schedulers: [`sch_${r.cross_id}`],
  datasource_id: r.payload?.properties?.source?.datasource_id ?? 'mysql',
  last_user_name_modified: 'Adam Shriki',
  river_cross_id: r.cross_id,
  last_updated_at: r.created_at,
  description: 'Created with the Source-to-Target wizard.',
  is_api_v2: true,
  river_type: 'src_to_trgt',
  target_type: r.payload?.properties?.target?.name ?? '',
});

const paginate = <T>(items: T[], page: number, size: number) =>
  items.slice((page - 1) * size, (page - 1) * size + size);

export function riversSearchPage(page = 1, itemsPerPage = 20) {
  const all = [
    ...listCreated().map(createdToRiverItem),
    ...FLOWS.map(toRiverItem),
  ];
  const items = paginate(all, page, itemsPerPage);
  return {
    next_page: page * itemsPerPage < all.length ? String(page + 1) : '',
    previous_page: page > 1 ? String(page - 1) : null,
    page,
    current_page_size: items.length,
    total_items: all.length,
    account_id: ACCOUNT_ID,
    environment_id: ENV_PROD_ID,
    items,
  };
}

// --- Legacy list (safety net; only hit if use_new_river_list is off) ---
const toLegacyRiver = (f: Flow) => ({
  cross_id: oid(f.cross),
  _id: oid(f.cross),
  river_definitions: {
    cross_id: oid(f.cross),
    _id: oid(f.cross),
    river_name: f.name,
    group_id: { _id: oid(f.groupCross), name: groupByKey(f.group).name },
    is_scheduled: f.scheduled,
    updated_by_name: f.modifiedBy,
    river_modified_date: { $date: f.lastModified },
    river_date_inserted: { $date: f.lastModified },
    is_api_v2: true,
    river_desc: describe(f),
    source: { name: connectorById(f.source)?.name, icon: '' },
    source_type: f.source,
    river_type: f.type,
    river_type_id: f.type,
    env_id: oid(ENV_PROD_ID),
    account: oid(ACCOUNT_ID),
  },
  tasks_definitions: [],
});

export function riversLegacyPage(page = 1, pageSize = 20) {
  return {
    page,
    page_size: pageSize,
    total_rivers: FLOWS.length,
    total_filtered_rivers: FLOWS.length,
    total_pages: Math.ceil(FLOWS.length / pageSize),
    data: paginate(FLOWS, page, pageSize).map(toLegacyRiver),
  };
}

export const hasRivers = { has_rivers: true };

export const sourcesList = {
  sources: Array.from(new Set(FLOWS.map(f => f.source))),
};
