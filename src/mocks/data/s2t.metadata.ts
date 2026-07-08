/**
 * S2T wizard — metadata fixtures + codecs.
 *
 * Everything the "new Source-to-Target data flow" wizard reads from the backend
 * that ISN'T a river document: the two demo connections, the Snowflake
 * database/schema dropdown lists, realistic MySQL schemas/tables/columns for the
 * Multi-Tables step, the test-connection result rows, and the activation status
 * result. All timestamps are the shared fixed epoch (see fixtures.ts) so nothing
 * drifts between reloads.
 */
import { oid } from './_shared';

const FIXED_TS = 1717200000000; // matches fixtures.ts
const FIXED_ISO = '2024-06-01T00:00:00.000Z';

// --- Demo connections (Step 1 source: MySQL, Step 2 target: Snowflake) -----
// Stable ids so the same connection resolves across list/by-type/by-id calls.
export const MYSQL_CONN_ID = 'aa0000000000000000000001';
export const SNOWFLAKE_CONN_ID = 'aa0000000000000000000002';

/**
 * IConnectionType shape (bare-array `GET /api/connections?connection_type=`).
 * The connection dropdown keys options by `cross_id.$oid` (entity-adapter id)
 * and labels them by `connection_name`.
 */
const connection = (id: string, name: string, type: string) => ({
  _id: oid(id),
  cross_id: oid(id),
  connection_name: name,
  connection_type: type,
  connection_type_id: type,
  connection_type_name: type,
  connection_desc: '',
  connection_creation_time: { $date: FIXED_TS },
  connection_update_time: { $date: FIXED_TS },
  connection_update_by: 'Adam Shriki',
  updated_by_name: 'Adam Shriki',
  last_test_date: { $date: FIXED_TS },
  valid: true,
  is_test_connection: false,
  is_test_connection_list: true,
  is_fz_connection: false,
  custom_fz: false,
});

export const DEMO_CONNECTIONS = [
  connection(MYSQL_CONN_ID, 'test shiran', 'mysql'),
  connection(SNOWFLAKE_CONN_ID, 'Rivery Snowflake', 'snowflake'),
];

// --- Test-connection result rows (Step 1 "Test Connection") ----------------
export const testResultsList = () => [
  {
    order: 1,
    test_name: 'connectivity',
    test_label: 'Connectivity',
    test_description: 'Reaching the database host and port.',
    test_status: 'D',
    test_result: true,
    error_msg: '',
  },
  {
    order: 2,
    test_name: 'authentication',
    test_label: 'Authentication',
    test_description: 'Validating the provided credentials.',
    test_status: 'D',
    test_result: true,
    error_msg: '',
  },
  {
    order: 3,
    test_name: 'permissions',
    test_label: 'Read Permissions',
    test_description: 'Confirming the user can list schemas and tables.',
    test_status: 'D',
    test_result: true,
    error_msg: '',
  },
];

// --- Snowflake target dropdowns (Step 2) -----------------------------------
export const SNOWFLAKE_DATABASES = ['das', 'analytics', 'raw_landing'];
export const SNOWFLAKE_SCHEMAS = ['fsd', 'public', 'staging'];

// --- MySQL source schemas + tables (Step 3, Multi Tables) ------------------
// Classic MySQL sample databases so the picker looks like a real MySQL source.
const TABLES: Record<string, string[]> = {
  classicmodels: [
    'customers',
    'orders',
    'orderdetails',
    'products',
    'productlines',
    'employees',
    'offices',
    'payments',
  ],
  sakila: [
    'actor',
    'film',
    'film_actor',
    'category',
    'inventory',
    'rental',
    'payment',
    'customer',
    'store',
    'staff',
    'address',
    'city',
  ],
  world: ['city', 'country', 'countrylanguage'],
};

export const schemaList = () =>
  Object.entries(TABLES).map(([name, tables]) => ({
    name,
    display_name: null,
    tables_count: tables.length,
    database_properties: { name, type: 'mysql' },
  }));

/** ITable rows for one schema — matches ITable (id/increment_columns/...). */
export const tableList = (schemaName: string) => {
  const tables = TABLES[schemaName] ?? [];
  return tables.map(name => ({
    id: name,
    schema_name: schemaName,
    updated_at: FIXED_ISO,
    database_properties: { name: schemaName, type: 'mysql' },
    no_increment: false,
    increment_required: false,
    increment_columns: [
      {
        name: 'updated_at',
        type: 'TIMESTAMP',
        incremental_type: 'datetime',
        is_default: true,
      },
      {
        // The auto-increment id column. ITable's incremental_type union does
        // NOT include 'incremental_id'; 'runningnumber' is the correct value.
        name: 'id',
        type: 'INTEGER',
        incremental_type: 'runningnumber',
        is_default: false,
      },
    ],
  }));
};

/** Plausible column list per table (table-settings drawer). */
export const columnList = (schemaName: string, tableId: string) => {
  const base = [
    { name: 'id', type: 'INTEGER', is_key: true, can_increment: true },
    { name: 'name', type: 'VARCHAR', is_key: false, can_increment: false },
    { name: 'status', type: 'VARCHAR', is_key: false, can_increment: false },
    { name: 'amount', type: 'FLOAT', is_key: false, can_increment: false },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      is_key: false,
      can_increment: true,
    },
    {
      name: 'updated_at',
      type: 'TIMESTAMP',
      is_key: false,
      can_increment: true,
      is_default_increment_column: true,
    },
  ];
  return base.map((c, i) => ({
    ...c,
    column_db_type: 'structured_db',
    is_selected: true,
    updated_at: FIXED_ISO,
    order: i,
  }));
};

// --- Operation-id codec (metadata pull_requests + operations poll) ---------
// The metadata service caches the operation id in a cookie for 45 days and, on
// a later visit, polls GET /operations/:opId DIRECTLY (skipping pull_requests).
// So the op id must be self-describing: decode task/conn/db from the id alone.
const OP_PREFIX = 'op::';
const SEP = '::';

export const encodeOp = (
  task: string,
  connectionId: string,
  databaseName?: string,
): string =>
  [OP_PREFIX + task, connectionId, databaseName].filter(Boolean).join(SEP);

export interface DecodedOp {
  task: string;
  connectionId: string;
  databaseName?: string;
}

export const decodeOp = (opId: string): DecodedOp | null => {
  if (!opId?.startsWith(OP_PREFIX)) return null;
  const [taskWithPrefix, connectionId, databaseName] = opId.split(SEP);
  return {
    task: taskWithPrefix.slice(OP_PREFIX.length),
    connectionId,
    databaseName,
  };
};

/** Resolve a metadata operation-id (or a live pull_requests query) to a result. */
export const metadataResultForTask = (task: string): string[] => {
  if (task === 'get_databases') return SNOWFLAKE_DATABASES;
  if (task === 'get_schemas') return SNOWFLAKE_SCHEMAS;
  // get_db_metadata (Reload Metadata) returns the schema list; the queryFn
  // passes result through untouched for this task.
  return [];
};

// --- Activation status result (poll of activate_river's operation) ---------
// Keys must match `baseStatusMap` in RiverActivation/hooks.ts. Each step's
// `validation_status` drives the per-step icons in the activation modal.
export const ACTIVATION_PREFIX = 'act::';

export const activationResult = () => ({
  validate_river_target: { validation_status: 'success', details: null },
  update_river_settings: { validation_status: 'success', details: null },
});
