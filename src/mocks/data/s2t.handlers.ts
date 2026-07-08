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
import {
  ACTIVATION_PREFIX,
  activationResult,
  columnList,
  decodeOp,
  encodeOp,
  metadataResultForTask,
  schemaList,
  tableList,
  testResultsList,
} from './s2t.metadata';
import { activateRiver, bumpPoll, getRiver, saveRiver } from './s2t.state';

const ok = (body: unknown) => (_req: any, res: any, ctx: any) =>
  res(ctx.status(200), ctx.json(body));

const FIXED_TS = 1717200000000;
const FIXED_ISO = '2024-06-01T00:00:00.000Z';
const oid = (id: string) => ({ $oid: id });

// A deterministic-but-unique id for a newly created river, derived from its name.
const newRiverId = (name: string) => {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `bb${h.toString(16).padStart(22, '0')}`.slice(0, 24);
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
  const body = (req.body as any) || {};
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

// --- Operations poll — shared by BOTH the metadata service AND activation ---
// GET */operations/:opId. Branch on the operation-id prefix:
//   act::<riverId>  → activation status (polls 1-2 'R', ≥3 'D' + result map)
//   op::<task>...   → metadata result, decoded from the id alone (cookie revisit)
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
  const body = (req.body as any) || {};
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
  const body = (req.body as any) || {};
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
const activateRiverHandler = rest.post(
  '*/rivers/:riverId/activate_river',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'R',
        operation_id: `${ACTIVATION_PREFIX}${riverId}`,
      }),
    );
  },
);

// POST */rivers/:riverId/disable_river — mirror activation handshake.
const disableRiverHandler = rest.post(
  '*/rivers/:riverId/disable_river',
  (req, res, ctx) => {
    const riverId = String(req.params.riverId);
    return res(
      ctx.status(200),
      ctx.json({
        status: 'R',
        operation_id: `${ACTIVATION_PREFIX}${riverId}`,
      }),
    );
  },
);

// POST */rivers/:riverId/run — {} crashes useRiverRun (runs[0].run_id).
const runRiverHandler = rest.post('*/rivers/:riverId/run', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  const runGroupId = `rg::${riverId}`;
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

// GET */rivers/:riverId (V1 STT river on the summary page) — full response.
// `properties.schemas` MUST be an array. Guard: `list` is POST-only, but keep
// the guard so a stray GET */rivers/list can't match here.
const getRiverHandler = rest.get('*/rivers/:riverId', (req, res, ctx) => {
  const riverId = String(req.params.riverId);
  if (riverId === 'list') {
    return res(ctx.status(404), ctx.json({}));
  }
  const stored = getRiver(riverId);
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
const fetchRiverListHandler = rest.post(
  '*/api/rivers/list',
  (req, res, ctx) => {
    const body = (req.body as any) || {};
    const crossId = body?._id?.$oid ?? body?._id ?? '';
    const stored = getRiver(crossId);
    const source = stored?.payload?.properties?.source ?? {};
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
          is_api_v2: false,
          updated_by_name: 'Adam Shriki',
          river_modified_date: { $date: FIXED_TS },
          river_date_inserted: { $date: FIXED_TS },
          env_id: oid(ENV_PROD_ID),
          account: oid(ACCOUNT_ID),
          schedulers: [{ is_enabled: true, cron_expression: '0 0 1/1 * *' }],
          // Reducer reads shared_params.notifications + run_notification_timeout.
          shared_params: {
            notifications: {
              on_failure: null,
              on_warning: null,
              on_run_threshold: null,
            },
            run_notification_timeout: null,
            river_variables: {},
          },
        },
        tasks_definitions: [],
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
  runGroupHandler,
  singleRunHandler,
  // Legacy landing-page fetch
  fetchRiverListHandler,
  // River create/update/read
  createRiverHandler,
  updateRiverHandler,
  getRiverHandler,
];
