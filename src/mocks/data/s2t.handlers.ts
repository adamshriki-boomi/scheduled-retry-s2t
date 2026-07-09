/*
 * S2T wizard MSW handlers.
 *
 * These make the "new Source-to-Target data flow" wizard walkable end-to-end
 * with no real backend. They are registered in src/mocks/handlers.ts BEFORE the
 * permissive v1 and api fallbacks (order matters — MSW takes the first match),
 * and the specific per-river sub-routes come before the generic river route.
 *
 * Client base-URL -> MSW pattern (see api.proxy.ts / createRiveryApi):
 *   axios `api`          -> <origin>/api/...     -> match "star/api/..."
 *   createRiveryApiV1    -> https://api.<region>.rivery.io/v1/...
 *   ...V1AccountEnv      -> .../v1/accounts/:acc/environments/:env/...
 */
import { rest } from 'msw';
import { ACCOUNT_ID, ENV_PROD_ID } from '../fixtures';
import { connectionsByType } from './connections';
import { targetTypes } from './datasources';
import { connectorById, groupByKey, mkId } from './_shared';
import { FLOWS } from './seed';
import {
  ACTIVATION_PREFIX,
  DEACTIVATION_PREFIX,
  activationResult,
  columnList,
  decodeOp,
  encodeOp,
  metadataResultForTask,
  schemaList,
  tableList,
  testResultsList,
} from './s2t.metadata';
import {
  activateRiver,
  bumpPoll,
  disableRiver,
  getRiver,
  listCreated,
  resetPoll,
  saveRiver,
} from './s2t.state';

const ok = (body: unknown) => (_req: any, res: any, ctx: any) =>
  res(ctx.status(200), ctx.json(body));

// MSW 0.44 only auto-parses req.body into an object when it recognizes the
// request's JSON content-type; otherwise handlers receive the raw string.
// Axios requests from the app hit the string path, so parse defensively.
export const parseBody = (req: { body?: unknown }): Record<string, any> => {
  const raw = req?.body;
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw === 'string' && raw.length) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
};

const FIXED_TS = 1717200000000;
const FIXED_ISO = '2024-06-01T00:00:00.000Z';
const oid = (id: string) => ({ $oid: id });

// A deterministic-but-unique id for a newly created river, derived from its name.
// Salted with the current store size so that two rivers with the same name in one
// session get different ids and distinct poll counters (no Date.now/Math.random).
const newRiverId = (name: string): string => {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const base = `bb${h.toString(16).padStart(22, '0')}`.slice(0, 24);
  // If the base id already exists in the store (same name used again this session),
  // append the store size as a deterministic salt and re-hash until unique.
  let candidate = base;
  let salt = 0;
  while (listCreated().some(r => r.cross_id === candidate)) {
    salt += 1;
    let sh = h;
    // mix the salt in
    sh = (sh * 31 + salt) >>> 0;
    candidate = `bb${sh.toString(16).padStart(22, '0')}`.slice(0, 24);
  }
  return candidate;
};

// --- Target-types (Step 2) — createRiveryApiV1 region host -----------------
const targetTypesHandler = rest.get('*/target_types', ok(targetTypes));

// --- Connections (Step 1 source + Step 2 target connection dropdowns) ------
// Both fetchConnectionsByType (?connection_type=) and useGetConnectionQuery
// (?_id=) hit GET */api/connections. Register BEFORE the generic /api/* fallback.
const connectionsHandler = rest.get('*/api/connections', (req, res, ctx) => {
  const p = req.url.searchParams;
  return res(
    ctx.status(200),
    ctx.json(
      connectionsByType({
        connectionType: p.get('connection_type'),
        id: p.get('_id'),
      }),
    ),
  );
});

// --- Test Connection (Step 1) ----------------------------------------------
// Start: GET */api/connections/test?id=<connId> → 'R' (kicks off a 1s poll).
// The poll id lives in `_id.$oid`.
const testStartHandler = rest.get('*/api/connections/test', (req, res, ctx) => {
  const id = req.url.searchParams.get('id') || 'unknown';
  return res(
    ctx.status(200),
    ctx.json({
      request_status: 'R',
      results: false,
      _id: oid(`testop::${id}`),
    }),
  );
});

// Poll: GET */api/pull_test_connection?id=testop::<connId> → success on first poll.
const testPollHandler = rest.get(
  '*/api/pull_test_connection',
  (req, res, ctx) => {
    const id = req.url.searchParams.get('id') || 'testop::unknown';
    return res(
      ctx.status(200),
      ctx.json({
        request_status: 'D',
        results: true,
        error_msg: '',
        results_list: testResultsList(),
        _id: oid(id),
        run_id: `${id}::run`,
        is_start: false,
        skip_table_mapping: false,
      }),
    );
  },
);

// --- Metadata service: databases/schemas dropdowns + reload metadata -------
// POST */pull_requests responds already-done ('D'), so the queryFn skips polling.
const pullRequestsHandler = rest.post('*/pull_requests', (req, res, ctx) => {
  const body = parseBody(req);
  const task: string = body.task;
  const connectionId: string = body.pull_request_inputs?.connection_id ?? '';
  const databaseName: string | undefined =
    body.pull_request_inputs?.database_name;
  return res(
    ctx.status(200),
    ctx.json({
      status: 'D',
      operation_id: encodeOp(task, connectionId, databaseName),
      result: metadataResultForTask(task),
      error_message: null,
    }),
  );
});

// --- Operations poll — shared by the metadata service, activation, and disable ---
// GET */operations/:opId. Branch on the operation-id prefix:
//   act::<riverId>   → activation status (polls 1-2 'R', ≥3 'D' + result map → river active)
//   deact::<riverId> → disable status   (polls 1-2 'R', ≥3 'D' + result map → river disabled)
//   op::<task>...    → metadata result, decoded from the id alone (cookie revisit)
const operationsHandler = rest.get('*/operations/:opId', (req, res, ctx) => {
  const opId = String(req.params.opId);

  if (opId.startsWith(ACTIVATION_PREFIX)) {
    const riverId = opId.slice(ACTIVATION_PREFIX.length);
    const poll = bumpPoll(opId);
    if (poll < 3) {
      return res(
        ctx.status(200),
        ctx.json({ status: 'R', operation_id: opId }),
      );
    }
    activateRiver(riverId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'D',
        operation_id: opId,
        result: activationResult(),
      }),
    );
  }

  if (opId.startsWith(DEACTIVATION_PREFIX)) {
    const riverId = opId.slice(DEACTIVATION_PREFIX.length);
    const poll = bumpPoll(opId);
    if (poll < 3) {
      return res(
        ctx.status(200),
        ctx.json({ status: 'R', operation_id: opId }),
      );
    }
    disableRiver(riverId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'D',
        operation_id: opId,
        result: activationResult(),
      }),
    );
  }

  const decoded = decodeOp(opId);
  return res(
    ctx.status(200),
    ctx.json({
      status: 'D',
      operation_id: opId,
      result: decoded ? metadataResultForTask(decoded.task) : [],
      error_message: null,
    }),
  );
});

// --- Schemas / Tables / Columns (Step 3 Multi Tables) ----------------------
const envelope = (items: any[], connectionId: string) => ({
  next_page: '',
  previous_page: null,
  page: 1,
  current_page_size: items.length,
  total_items: items.length,
  account_id: ACCOUNT_ID,
  environment_id: ENV_PROD_ID,
  connection_id: connectionId,
  items,
});

const schemasHandler = rest.get(
  '*/connections/:connectionId/schemas',
  (req, res, ctx) => {
    const connectionId = String(req.params.connectionId);
    const schemaName = req.url.searchParams.get('schema_name');
    const all = schemaList();
    const items = schemaName
      ? all.filter(s => s.name.includes(schemaName))
      : all;
    return res(ctx.status(200), ctx.json(envelope(items, connectionId)));
  },
);

const tablesHandler = rest.get(
  '*/connections/:connectionId/tables',
  (req, res, ctx) => {
    const connectionId = String(req.params.connectionId);
    const schemaName = req.url.searchParams.get('schema_name') || '';
    const tableName = req.url.searchParams.get('table_name');
    let items = tableList(schemaName);
    if (tableName) items = items.filter(t => t.id.includes(tableName));
    return res(ctx.status(200), ctx.json(envelope(items, connectionId)));
  },
);

const columnsHandler = rest.get(
  '*/connections/:connectionId/columns',
  (req, res, ctx) => {
    const connectionId = String(req.params.connectionId);
    const schemaName = req.url.searchParams.get('schema_name') || '';
    const tableId = req.url.searchParams.get('table_id') || '';
    return res(
      ctx.status(200),
      ctx.json(envelope(columnList(schemaName, tableId), connectionId)),
    );
  },
);

// --- River create / read (Step 4 + Activate + summary page) ----------------
// The created-river response must carry `properties.schemas` as an ARRAY
// (transformResponseToKeyValue calls .reduce on it — an object/undefined throws).
const buildRiverResponse = (crossId: string, payload: any, status: string) => {
  const schemas = Array.isArray(payload?.properties?.schemas)
    ? payload.properties.schemas
    : []; // convertRiverToPayload already sent the array form on create/update
  return {
    ...payload,
    cross_id: crossId,
    account_id: ACCOUNT_ID,
    environment_id: ENV_PROD_ID,
    type: payload?.type ?? 'source_to_target',
    properties: {
      source: payload?.properties?.source ?? {},
      target: payload?.properties?.target ?? {},
      ...payload?.properties,
      schemas,
    },
    metadata: {
      ...payload?.metadata,
      river_status: status,
      last_updated_at: FIXED_ISO,
      last_updated_by: 'Adam Shriki',
      created_by: 'Adam Shriki',
      created_at: FIXED_ISO,
    },
  };
};

// POST */rivers (create) — mint an id, persist, echo the V1 response shape.
const createRiverHandler = rest.post('*/rivers', (req, res, ctx) => {
  const body = parseBody(req);
  const crossId = newRiverId(body.name);
  saveRiver(crossId, body.name, { ...body, cross_id: crossId });
  const stored = getRiver(crossId);
  return res(
    ctx.status(200),
    ctx.json(buildRiverResponse(crossId, stored?.payload ?? body, 'disabled')),
  );
});

// PUT */rivers/:riverId (save) — persist and echo. Guard against `list`.
const updateRiverHandler = rest.put('*/rivers/:riverId', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  const body = parseBody(req);
  const stored = saveRiver(riverId, body.name, {
    ...body,
    cross_id: riverId,
  });
  return res(
    ctx.status(200),
    ctx.json(buildRiverResponse(riverId, stored.payload, stored.river_status)),
  );
});

// POST */rivers/:riverId/activate_river — MUST be 'R' (immediate 'D' → error branch).
// Reset the poll counter so that re-activating in the same session replays the
// full R→R→D progression (stale counter ≥3 would return 'D' immediately → error).
const activateRiverHandler = rest.post(
  '*/rivers/:riverId/activate_river',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    const opId = `${ACTIVATION_PREFIX}${riverId}`;
    resetPoll(opId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'R',
        operation_id: opId,
      }),
    );
  },
);

// POST */rivers/:riverId/disable_river — uses a distinct 'deact::' prefix so the
// operations handler can set river status to disabled (not active) on 'D'.
// Reset the counter so repeated disable/enable cycles replay the full R→R→D progression.
const disableRiverHandler = rest.post(
  '*/rivers/:riverId/disable_river',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    const opId = `${DEACTIVATION_PREFIX}${riverId}`;
    resetPoll(opId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'R',
        operation_id: opId,
      }),
    );
  },
);

// POST */rivers/:riverId/run — {} crashes useRiverRun (runs[0].run_id).
// Reset the run-group poll counter so each run re-plays the running→succeeded
// progression (stale counter ≥3 would show success instantly on repeat runs).
const runRiverHandler = rest.post('*/rivers/:riverId/run', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  const runGroupId = `rg::${riverId}`;
  resetPoll(`rungroup::${runGroupId}`);
  return res(
    ctx.status(200),
    ctx.json({
      river_cross_id: riverId,
      run_group_id: runGroupId,
      runs: [
        {
          run_id: `run::${riverId}::1`,
          status: 'running',
          message: '',
        },
      ],
    }),
  );
});

const cancelRunHandler = rest.post(
  '*/rivers/:riverId/cancel_run',
  ok({ details: 'canceled' }),
);

// GET */rivers/:riverId/activities_run_groups (LIST) — per-river run history for
// the Activities per-river run list. MUST be registered BEFORE the DETAIL route
// (activities_run_groups/:runGroupId) so MSW matches the specific path first.
// Serves the flow's seeded runHistory mapped to IRunScheduler shape.
const runGroupsListHandler = rest.get(
  '*/rivers/:riverId/activities_run_groups',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    const p = req.url.searchParams;
    const page = Number(p.get('page')) || 1;
    const perPage = Number(p.get('items_per_page')) || 25;

    const flow = FLOWS.find(f => f.cross === riverId);
    const runHistory = flow?.runHistory ?? [];

    const start = (page - 1) * perPage;
    const pageItems = runHistory.slice(start, start + perPage);

    const items = pageItems.map(r => ({
      run_group_id: r.run_group_id,
      status: r.status,
      rpu: r.rpu,
      max_duration_in_milliseconds: r.max_run_duration_milliseconds,
      run_date_epoch_milliseconds: r.run_date,
      run_date_utc: new Date(r.run_date).toISOString(),
      trigger: r.trigger,
    }));

    return res(
      ctx.status(200),
      ctx.json({
        items,
        next_page:
          start + perPage < runHistory.length ? `page=${page + 1}` : '',
        total_items: runHistory.length,
        page,
        current_page_size: items.length,
        river_cross_id: ACCOUNT_ID,
        environment_id: ENV_PROD_ID,
        account_id: ACCOUNT_ID,
      }),
    );
  },
);

// GET */rivers/:riverId/activities_run_groups/:runGroupId — table counters,
// polled every 3s. running → succeeded across 2-3 polls, counters keyed to the
// created river's selected-table count.
const runGroupHandler = rest.get(
  '*/rivers/:riverId/activities_run_groups/:runGroupId',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    const runGroupId = String(req.params.runGroupId);
    const total = Math.max(getRiver(riverId)?.selectedTables.length ?? 3, 1);
    const poll = bumpPoll(`rungroup::${runGroupId}`);
    const finished = poll >= 3;
    return res(
      ctx.status(200),
      ctx.json({
        run_group_id: runGroupId,
        status: finished ? 'succeeded' : 'running',
        units: total,
        max_duration_in_milliseconds: 42000,
        run_date_epoch_milliseconds: FIXED_TS,
        run_date_utc: FIXED_ISO,
        run_end_date_epoch_milliseconds: finished ? FIXED_TS + 42000 : 0,
        run_end_date_utc: finished ? FIXED_ISO : '',
        running: finished ? 0 : total,
        canceled: 0,
        pending: 0,
        failed: 0,
        succeeded: finished ? total : 0,
        skipped: 0,
      }),
    );
  },
);

// GET */rivers/:riverId/runs/:runId — the finish bar's single-run record.
const singleRunHandler = rest.get(
  '*/rivers/:riverId/runs/:runId',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    const runId = String(req.params.runId);
    const river = getRiver(riverId);
    const total = Math.max(river?.selectedTables.length ?? 3, 1);
    return res(
      ctx.status(200),
      ctx.json({
        run_id: runId,
        datasource_id: river?.payload?.properties?.source?.datasource_id ?? '',
        error_description: '',
        units: total,
        run_group_id: `rg::${riverId}`,
        status: 'succeeded',
        source_name: river?.payload?.properties?.source?.connection_name ?? '',
        target_name: river?.payload?.properties?.target?.connection_name ?? '',
        start_date_utc: FIXED_ISO,
        start_date_in_milliseconds: FIXED_TS,
        end_date_utc: FIXED_ISO,
        end_date_in_milliseconds: FIXED_TS + 42000,
        sub_river_id: '',
        is_sub_river_run: false,
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// GET */rivers/:riverId/runs — per-table run rows for the right-panel grid.
//
// The right panel (SourceToTarget.tsx) calls useGetRiverActivitiesRunQuery which
// maps to rivers/:riverId/runs?run_group_id=<id>&start_time=...&end_time=...
// returning RiverActivitiesRunResponse { items: IRiverActivityRun[], ... }.
//
// Crash vector: no handler → falls to */v1/* fallback → items:[] → blank panel.
// Seeded run_group_ids (mkId(3,…) and mkId(9,…)) never match the rg:: guard in
// runGroupHandler so they'd fall through even if that handler ran.
//
// We generate deterministic per-table rows (IRiverActivityRun shape) keyed to
// the run_group_id. Each source has a small table list; the Marketo failedRun
// shows one table failed, the rest succeeded; all other runs show all-succeeded.
// ---------------------------------------------------------------------------
const SOURCE_TABLES: Record<string, string[]> = {
  salesforce: ['Account', 'Contact', 'Opportunity', 'Lead', 'Task'],
  hubspot: ['contacts', 'companies', 'deals', 'email_events'],
  marketo: ['leads', 'activities', 'programs', 'campaigns'],
  facebook_ads: ['ads', 'ad_sets', 'campaigns', 'insights'],
  stripe: ['charges', 'invoices', 'subscriptions', 'customers'],
  zendesk: ['tickets', 'users', 'organizations', 'satisfaction_ratings'],
  google_analytics: ['sessions', 'events', 'users', 'page_views'],
  netsuite: ['transactions', 'gl_accounts', 'items', 'vendors'],
  mixpanel: ['events', 'users', 'funnels', 'retention'],
  postgres: ['users', 'events', 'feature_flags', 'sessions'],
  mysql: ['events', 'logs', 'sessions', 'errors'],
  shopify: ['orders', 'products', 'customers', 'line_items'],
  linkedin: ['campaigns', 'ad_analytics', 'creatives'],
  intercom: ['conversations', 'contacts', 'events'],
  jira: ['issues', 'projects', 'users', 'sprints'],
};
const DEFAULT_TABLES = ['table_a', 'table_b', 'table_c'];

// Build IRiverActivityRun[] rows for a given run entry + flow source.
// failedTableIdx: if >=0, that table index gets status 'failed'; rest succeed.
const buildRunRows = (
  run: {
    run_group_id: string;
    status: string;
    run_date: number;
    max_run_duration_milliseconds: number;
  },
  source: string,
  riverId: string,
  failedTableIdx = -1,
): any[] => {
  const tables = SOURCE_TABLES[source] ?? DEFAULT_TABLES;
  const end = run.run_date + run.max_run_duration_milliseconds;
  return tables.map((tbl, idx) => {
    const tableStatus =
      run.status === 'failed' && failedTableIdx < 0
        ? idx === 0
          ? 'failed'
          : 'succeeded' // at least one failed table for a failed run
        : failedTableIdx === idx
        ? 'failed'
        : run.status === 'running'
        ? idx === 0
          ? 'running'
          : 'pending'
        : run.status === 'succeeded' || run.status === 'partially succeeded'
        ? 'succeeded'
        : run.status;
    return {
      run_id: `${run.run_group_id}::table::${idx}`,
      datasource_id: source,
      error_description:
        tableStatus === 'failed' ? 'Connection timeout after 30s' : '',
      units: Number((0.1 + idx * 0.05).toFixed(2)),
      run_group_id: run.run_group_id,
      status: tableStatus,
      source_name: source,
      target_name: tbl,
      start_date_utc: new Date(run.run_date).toISOString(),
      start_date_in_milliseconds: run.run_date,
      end_date_utc: new Date(end).toISOString(),
      end_date_in_milliseconds:
        tableStatus === 'running' || tableStatus === 'pending' ? 0 : end,
      sub_river_id: '',
      is_sub_river_run: false,
    };
  });
};

// GET */rivers/:riverId/runs — returns per-table row list (IRiverActivityRun[]).
// Registered BEFORE singleRunHandler (which has a /runs/:runId segment) so MSW
// can distinguish the bare /runs list from the /runs/:runId detail.
const runsListHandler = rest.get('*/rivers/:riverId/runs', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  const runGroupId = req.url.searchParams.get('run_group_id') ?? '';

  // Look up the flow by its cross id to get the seeded run history.
  const flow = FLOWS.find(f => f.cross === riverId);
  if (!flow) {
    // Created-river path: return a minimal succeeded table set.
    const river = getRiver(riverId);
    const tables = river?.selectedTables ?? [];
    const tableNames =
      tables.length > 0
        ? tables.map((t: any) => t.name ?? String(t))
        : DEFAULT_TABLES;
    const ts = FIXED_TS;
    const items = tableNames.map((tbl: string, idx: number) => ({
      run_id: `${runGroupId}::table::${idx}`,
      datasource_id: river?.payload?.properties?.source?.datasource_id ?? '',
      error_description: '',
      units: 0.1,
      run_group_id: runGroupId,
      status: 'succeeded',
      source_name: river?.payload?.properties?.source?.connection_name ?? '',
      target_name: tbl,
      start_date_utc: new Date(ts).toISOString(),
      start_date_in_milliseconds: ts,
      end_date_utc: new Date(ts + 42_000).toISOString(),
      end_date_in_milliseconds: ts + 42_000,
      sub_river_id: '',
      is_sub_river_run: false,
    }));
    return res(
      ctx.status(200),
      ctx.json({
        items,
        next_page: '',
        total_items: items.length,
        page: 1,
        current_page_size: items.length,
        master_river_id: riverId,
      }),
    );
  }

  // Seeded flow: find the run in runHistory by run_group_id. The app strips
  // leading zeros off the id when building the query (?run=0…0895488 arrives
  // as run_group_id=895488), so compare zero-stripped values on both sides.
  const stripZeros = (id: string) => id.replace(/^0+/, '');
  const run = flow.runHistory.find(
    r => stripZeros(r.run_group_id) === stripZeros(runGroupId),
  );
  if (!run) {
    return res(
      ctx.status(200),
      ctx.json({
        items: [],
        next_page: '',
        total_items: 0,
        page: 1,
        current_page_size: 0,
        master_river_id: riverId,
      }),
    );
  }

  // For the Marketo/Facebook retry story: the failedRun (mkId(9, index*10+1))
  // shows a realistic partial failure — first table failed, rest succeeded.
  // The retryRun (mkId(9, index*10+2)) shows all succeeded.
  const isRetryStoryFailed = run.run_group_id === mkId(9, flow.index * 10 + 1);
  const failedTableIdx = isRetryStoryFailed ? 0 : -1;

  const items = buildRunRows(run, flow.source, riverId, failedTableIdx);
  return res(
    ctx.status(200),
    ctx.json({
      items,
      next_page: '',
      total_items: items.length,
      page: 1,
      current_page_size: items.length,
      master_river_id: riverId,
    }),
  );
});

// Derive a plausible target datasource_id from the flow name ("→ Snowflake" etc).
const targetDatasourceFromName = (name: string): string => {
  if (name.includes('BigQuery')) return 'bigquery';
  if (name.includes('Redshift')) return 'redshift';
  return 'snowflake';
};

// Returns true when the riverId looks like a real 24-char hex-ish id
// (starts with digits/letters, no dots, not "list").
const isRealRiverId = (id: string): boolean =>
  /^[0-9a-fA-F]{24}$/.test(id) || /^[a-z0-9]{8,}$/.test(id);

// The retry-story flows get scheduled_retry enabled; others default to off.
const RETRY_STORY_NAMES_SET = new Set([
  'Marketo Leads → Snowflake',
  'Facebook Ads Insights → Snowflake',
]);

// GET */rivers/:riverId (V1 STT river on the summary page) — full response.
// `properties.schemas` MUST be an array. Guard: `list` is POST-only, but keep
// the guard so a stray GET */rivers/list can't match here.
// Before the generic fallback, look up seeded FLOWS by cross id so clicking a
// row in the Data Flows grid opens a summary page with the real flow name and
// metadata rather than a generic "Data Flow" placeholder.
const getRiverHandler = rest.get('*/rivers/:riverId', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  // Guard: pass through non-id strings (e.g. "list" or legacy ".html" routes)
  // so they don't render raw JSON. In MSW 0.44, rest handlers have no
  // req.passthrough() — return 404 JSON so the app handles it gracefully.
  if (riverId === 'list' || riverId.includes('.') || !isRealRiverId(riverId)) {
    return res(ctx.status(404), ctx.json({}));
  }
  const stored = getRiver(riverId);
  // If this id belongs to a seeded flow (not a wizard-created one), synthesize
  // the payload from the flow's seed data so the summary page reflects the
  // real name, group, source/target, and scheduler.
  const seededFlow = stored ? null : FLOWS.find(f => f.cross === riverId);
  if (seededFlow) {
    const group = groupByKey(seededFlow.group);
    const sourceConnector = connectorById(seededFlow.source);
    const targetId = targetDatasourceFromName(seededFlow.name);
    const targetConnector = connectorById(targetId);
    const isRetryFlow = RETRY_STORY_NAMES_SET.has(seededFlow.name);
    const seededPayload = {
      name: seededFlow.name,
      group_id: seededFlow.groupCross,
      group_name: group?.name ?? '',
      kind: 'main_river',
      type: seededFlow.type === 'logic' ? 'logic' : 'source_to_target',
      schedulers: seededFlow.scheduled
        ? [{ is_enabled: true, cron_expression: '0 0 1/1 * *' }]
        : [],
      settings: {
        scheduled_retry: { is_enabled: isRetryFlow },
      },
      notification_settings: {},
      properties: {
        source: {
          datasource_id: seededFlow.source,
          connection_name: sourceConnector?.name ?? seededFlow.source,
          name: seededFlow.source,
        },
        target: {
          datasource_id: targetId,
          connection_name: targetConnector?.name ?? targetId,
          name: targetId,
        },
        schemas: (() => {
          const tables = SOURCE_TABLES[seededFlow.source] ?? DEFAULT_TABLES;
          return [
            {
              name: 'public',
              tables: tables.map(t => ({
                details: { name: t, target_table: t, is_selected: true },
              })),
            },
          ];
        })(),
      },
      metadata: {},
    };
    return res(
      ctx.status(200),
      ctx.json(buildRiverResponse(riverId, seededPayload, 'active')),
    );
  }
  const payload = stored?.payload ?? {
    name: 'Data Flow',
    group_id: '',
    group_name: '',
    kind: 'main_river',
    type: 'source_to_target',
    schedulers: [],
    settings: {},
    notification_settings: {},
    properties: { source: {}, target: {}, schemas: [] },
    metadata: {},
  };
  return res(
    ctx.status(200),
    ctx.json(
      buildRiverResponse(riverId, payload, stored?.river_status ?? 'disabled'),
    ),
  );
});

// --- Landing page: legacy river fetch (redux fetchRiver) -------------------
// POST */api/rivers/list body {_id:{$oid}} → legacy river shape. The reducer
// dereferences river_definitions.shared_params.notifications, so it must exist.
// When the id belongs to a seeded flow (not wizard-created), synthesize the
// legacy shape from the flow's seed data so the per-river Activities header
// shows the real flow name and icons rather than a generic "Data Flow".
const sharedParams = {
  notifications: {
    on_failure: null,
    on_warning: null,
    on_run_threshold: null,
  },
  run_notification_timeout: null,
  river_variables: {},
};

const fetchRiverListHandler = rest.post(
  '*/api/rivers/list',
  (req, res, ctx) => {
    const body = parseBody(req);
    const crossId = body?._id?.$oid ?? body?._id ?? '';

    // Seeded flow branch: look up by cross id and build the legacy shape from seed data.
    const seededFlow = FLOWS.find(f => f.cross === crossId);
    if (seededFlow) {
      const group = groupByKey(seededFlow.group);
      const sourceConnector = connectorById(seededFlow.source);
      const targetId = targetDatasourceFromName(seededFlow.name);
      const targetConnector = connectorById(targetId);
      // tasks_definitions lets RiverHeader.tsx resolve source/target logos via
      // datasource_id (ordinal 0 = source, ordinal 1 = target). Without this
      // DataSourceIcon receives type=undefined and renders a blank icon.
      return res(
        ctx.status(200),
        ctx.json({
          cross_id: oid(crossId),
          _id: oid(crossId),
          river_definitions: {
            cross_id: oid(crossId),
            _id: oid(crossId),
            river_name: seededFlow.name,
            river_type: 'src_to_trgt',
            river_type_id: 'src_to_trgt',
            source_type: seededFlow.source,
            source: {
              name: sourceConnector?.name ?? seededFlow.source,
              icon: '',
            },
            target: {
              name: targetConnector?.name ?? targetId,
              icon: '',
            },
            group_id: {
              _id: oid(seededFlow.groupCross),
              name: group?.name ?? '',
            },
            is_scheduled: seededFlow.scheduled,
            is_api_v2: true,
            updated_by_name: seededFlow.modifiedBy,
            river_modified_date: { $date: seededFlow.lastModified },
            river_date_inserted: { $date: seededFlow.lastModified },
            env_id: oid(ENV_PROD_ID),
            account: oid(ACCOUNT_ID),
            schedulers: seededFlow.scheduled
              ? [{ is_enabled: true, cron_expression: '0 0 1/1 * *' }]
              : [],
            shared_params: sharedParams,
          },
          tasks_definitions: [
            { ordinal: 0, datasource_id: seededFlow.source },
            { ordinal: 1, datasource_id: targetId },
          ],
        }),
      );
    }

    // Wizard-created river branch.
    const stored = getRiver(crossId);
    const source = stored?.payload?.properties?.source ?? {};
    const target = stored?.payload?.properties?.target ?? {};
    // tasks_definitions lets RiverHeader.tsx resolve source/target logos via
    // datasource_id (ordinal 0 = source, ordinal 1 = target). Without this
    // DataSourceIcon receives type=undefined and renders a blank icon.
    return res(
      ctx.status(200),
      ctx.json({
        cross_id: oid(crossId),
        _id: oid(crossId),
        river_definitions: {
          cross_id: oid(crossId),
          _id: oid(crossId),
          river_name: stored?.name ?? 'Data Flow',
          river_type: 'src_to_trgt',
          river_type_id: 'src_to_trgt',
          source_type: source.datasource_id ?? 'mysql',
          group_id: {
            _id: oid(stored?.group_id ?? ''),
            name: stored?.group_name ?? '',
          },
          is_scheduled: true,
          is_api_v2: true,
          updated_by_name: 'Adam Shriki',
          river_modified_date: { $date: FIXED_TS },
          river_date_inserted: { $date: FIXED_TS },
          env_id: oid(ENV_PROD_ID),
          account: oid(ACCOUNT_ID),
          schedulers: [{ is_enabled: true, cron_expression: '0 0 1/1 * *' }],
          shared_params: sharedParams,
        },
        tasks_definitions: [
          { ordinal: 0, datasource_id: source.datasource_id ?? 'mysql' },
          { ordinal: 1, datasource_id: target.datasource_id ?? 'snowflake' },
        ],
      }),
    );
  },
);

/*
 * Ordered handler list. Specific per-river sub-routes (activate/run/etc.) come
 * BEFORE the generic river route; the POST api/rivers/list handler is separate
 * (different method + host) so it doesn't collide with GET rivers/:riverId.
 */
export const s2tHandlers = [
  // Step 2 target types
  targetTypesHandler,
  // Step 1 test connection (specific /connections/test before bare /connections)
  testStartHandler,
  testPollHandler,
  connectionsHandler,
  // Metadata service (databases/schemas) + shared operations poll
  pullRequestsHandler,
  operationsHandler,
  // Step 3 schemas/tables/columns
  schemasHandler,
  tablesHandler,
  columnsHandler,
  // River sub-routes (BEFORE generic */rivers/:riverId)
  activateRiverHandler,
  disableRiverHandler,
  runRiverHandler,
  cancelRunHandler,
  runGroupsListHandler, // LIST must precede DETAIL (:runGroupId)
  runGroupHandler,
  runsListHandler, // bare /runs list (right panel) must precede /runs/:runId detail
  singleRunHandler,
  // Legacy landing-page fetch
  fetchRiverListHandler,
  // River create/update/read
  createRiverHandler,
  updateRiverHandler,
  getRiverHandler,
];
