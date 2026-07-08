/**
 * GET /data_source_types  → { items: IDataSourceV1[] }
 * GET /target_types        → { items: IDataTarget[] }
 * GET /data_source_sections → { items: [{ data_source_section }] }
 *
 * `data_source_types` powers source-icon resolution (useSourceByType) across the
 * Data Flows list, Activities and the Dashboard source view, AND the S2T wizard's
 * source/target pickers. Icons point at local assets so they render offline.
 *
 * For the S2T wizard to be walkable (not bounce to the legacy route) each tile
 * carries `data_source_type_settings.is_new_interface: true`, and the MySQL
 * source carries the exact `feature_flags` that make `useShouldDisplayExtractMethod`
 * return strictly `false` (so Step 2 auto-sets extract_method:'all'):
 *   - custom_query:false, allow_log:false, allow_bw:false,
 *     support_system_versioning:false, standard_extraction_exists:true.
 */
import { CONNECTORS, iconUrl } from './_shared';

// Group sources into a couple of believable sections for the picker sidebar.
const SECTION_BY_KIND: Record<string, { id: string; name: string }> = {
  warehouse: { id: 'sec_warehouse', name: 'Data Warehouses' },
  source: { id: 'sec_general', name: 'Sources' },
};
const DB_SOURCES = new Set(['mysql', 'postgres']);
const DB_SECTION = { id: 'sec_relational', name: 'Databases' };

const sectionFor = (c: typeof CONNECTORS[number]) =>
  DB_SOURCES.has(c.id) ? DB_SECTION : SECTION_BY_KIND[c.kind];

const items = CONNECTORS.map(c => ({
  id: c.id,
  api_name: c.id,
  name: c.name,
  icon: iconUrl(c.icon),
  connection_type: c.id,
  status: 'enabled',
  section_id: sectionFor(c).id,
  segment:
    c.kind === 'warehouse'
      ? ['connections', 'target']
      : ['source', 'connections', 'target'],
  labels: [],
  // New-interface flag: without it, SetupDataSource pushes the legacy route.
  data_source_type_settings: { is_new_interface: true },
  feature_flags:
    c.id === 'mysql'
      ? {
          custom_query: false,
          allow_log: false,
          allow_bw: false,
          support_system_versioning: false,
          standard_extraction_exists: true,
        }
      : {},
}));

/** Filter items to a wizard segment ('source' | 'target' | 'connections'). */
export const dataSourceTypesFor = (segment?: string | null) => {
  const filtered = segment
    ? items.filter(i => i.segment.includes(segment))
    : items;
  return {
    next_page: '',
    previous_page: null,
    page: 1,
    current_page_size: filtered.length,
    total_items: filtered.length,
    items: filtered,
  };
};

// Unsegmented default (used by the app-wide source-icon registry).
export const dataSourceTypes = dataSourceTypesFor();

// --- Target types (Step 2 target picker + useGetTarget('snowflake')) -------
// `useGetTarget` matches by `api_name`; `isTargetNewInterface` matches
// `datasource_type_id` against the source tile `id`. Only snowflake needs to be
// walkable; the others are there so the target picker looks real.
const WAREHOUSE_TARGETS = ['snowflake', 'bigquery', 'redshift'];

const targetItems = CONNECTORS.filter(c =>
  WAREHOUSE_TARGETS.includes(c.id),
).map(c => ({
  name: c.name,
  api_name: c.id,
  target_type: c.id,
  datasource_type_id: c.id,
  connection_type: c.id,
  target_task_type_id: c.id,
  logic_step_type: null,
  icon: iconUrl(c.icon),
  status: 'enabled',
  segment: ['connections', 'target'],
  labels: [],
  river_type_id: null,
  target_settings: {
    is_new_interface: true,
    enable_cdc: false,
    allowed_for_blueprint: false,
  },
}));

export const targetTypes = {
  next_page: '',
  previous_page: null,
  page: 1,
  current_page_size: targetItems.length,
  total_items: targetItems.length,
  items: targetItems,
};

// --- Data source sections (picker sidebar categories) ----------------------
const sectionDefs = [
  DB_SECTION,
  SECTION_BY_KIND.source,
  SECTION_BY_KIND.warehouse,
];
const sectionItems = sectionDefs.map(s => ({
  data_source_section: { id: s.id, name: s.name, description: `${s.name}.` },
}));

export const dataSourceSectionsFor = (segment?: string | null) => ({
  next_page: '',
  previous_page: null,
  page: 1,
  current_page_size: sectionItems.length,
  total_items: sectionItems.length,
  // Sections are shared across segments; the app filters entities by section_id.
  items: segment === 'target' ? [sectionItems[2]] : sectionItems,
});
