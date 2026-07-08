import { rest } from 'msw';
import { accountDetails, environmentsPage, userLogin } from './fixtures';
import {
  activitiesGraph,
  activitiesPage,
  activitiesStatistics,
  connectionsList,
  dashboardData,
  dataSourceSectionsFor,
  dataSourceTypesFor,
  hasRivers,
  riverGroups,
  riversLegacyPage,
  riversSearchPage,
  s2tHandlers,
  sourcesList,
} from './data';

/**
 * MSW request handlers for the BDI prototype mock backend.
 *
 * Order matters — MSW responds with the FIRST matching handler, so specific
 * auth/bootstrap handlers come first and broad "keep the app from hitting the
 * network" fallbacks come last. Anything not matched here (HMR, assets, the
 * legacy Angular `/ng` iframe, 3rd-party scripts) is bypassed to the network
 * (see browser.ts onUnhandledRequest: 'bypass').
 */

const ok = (body: unknown) => (_req: any, res: any, ctx: any) =>
  res(ctx.status(200), ctx.json(body));

const LS_ACCOUNT_KEY = 'bdi_account_settings';

function readAccountOverlay(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(LS_ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const handlers = [
  // --- Critical auth handshake (axios `api` instance: <origin>/api/*) ---
  rest.post('*/api/login', ok(userLogin)),
  rest.post('*/api/token', (_req, res, ctx) => {
    const overlay = readAccountOverlay();
    const merged = {
      ...accountDetails,
      account_settings: {
        ...accountDetails.account_settings,
        ...overlay,
      },
    };
    return res(ctx.status(200), ctx.json(merged));
  }),

  // --- Account settings save (PATCH /accounts/:id) ---
  // Must be registered BEFORE the permissive */api/* fallback.
  rest.patch('*/api/accounts/:accountId', async (req, res, ctx) => {
    const body: Record<string, unknown> =
      typeof req.body === 'object' && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    // Extract the three retry keys plus any other account_settings keys
    // that may have been sent. Deep-merge into the existing overlay so
    // unrelated settings (set by other handlers) are not clobbered.
    const retryKeys = [
      'enable_scheduled_retry',
      'scheduled_retry_max_retries',
      'scheduled_retry_delay_minutes',
    ] as const;
    const existing = readAccountOverlay();
    const update: Record<string, unknown> = { ...existing };
    for (const key of retryKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        update[key] = body[key];
      }
    }
    // Also persist allow_ai_based_processing if present (same settings form)
    const extraKeys = ['allow_ai_based_processing'] as const;
    for (const key of extraKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        update[key] = body[key];
      }
    }
    try {
      localStorage.setItem(LS_ACCOUNT_KEY, JSON.stringify(update));
    } catch {
      // localStorage may be unavailable in some test environments — ignore
    }
    return res(ctx.status(200), ctx.json({ status_code: 200 }));
  }),

  // --- Shell bootstrap (RTK Query v1: https://api.*/v1/*) ---
  rest.get('*/v1/accounts/:accountId/environments', ok(environmentsPage)),

  // --- Source-icon registry + S2T source/target pickers ---
  // App-wide icon resolution (no segment) AND the wizard's segmented fetches
  // (?segment=source|target); the app reads response.items and filters by segment.
  rest.get('*/data_source_types', (req, res, ctx) =>
    res(
      ctx.status(200),
      ctx.json(dataSourceTypesFor(req.url.searchParams.get('segment'))),
    ),
  ),
  rest.get('*/data_source_sections', (req, res, ctx) =>
    res(
      ctx.status(200),
      ctx.json(dataSourceSectionsFor(req.url.searchParams.get('segment'))),
    ),
  ),

  // --- Dashboard ---
  rest.get('*/has_rivers', ok(hasRivers)),
  rest.get('*/sources_list', ok(sourcesList)),
  rest.post('*/dashboard', (req, res, ctx) => {
    const body = (req.body as any) || {};
    return res(
      ctx.status(200),
      ctx.json(dashboardData(body.metric, body.view)),
    );
  }),

  // --- Activities / Monitoring (specific before the broad `*/activities`) ---
  rest.get('*/activities_statistics', ok(activitiesStatistics)),
  rest.post('*/activities_graph', ok(activitiesGraph)),
  rest.get('*/activities', (req, res, ctx) => {
    const p = req.url.searchParams;
    const page = Number(p.get('page')) || 1;
    const perPage = Number(p.get('items_per_page')) || 25;
    const status = [...p.getAll('status'), ...p.getAll('status[]')]
      .flatMap(s => s.split(','))
      .filter(Boolean);
    return res(
      ctx.status(200),
      ctx.json(activitiesPage(page, perPage, status)),
    );
  }),

  // --- Data Flows (V1 grid is primary; legacy list as a safety net) ---
  rest.get('*/rivers_search', (req, res, ctx) => {
    const p = req.url.searchParams;
    const page = Number(p.get('page')) || 1;
    const perPage = Number(p.get('items_per_page')) || 20;
    return res(ctx.status(200), ctx.json(riversSearchPage(page, perPage)));
  }),
  rest.get('*/api/rivers', (req, res, ctx) => {
    const p = req.url.searchParams;
    const page = Number(p.get('page')) || 1;
    const perPage = Number(p.get('page_size')) || 20;
    return res(ctx.status(200), ctx.json(riversLegacyPage(page, perPage)));
  }),
  rest.get('*/api/river_groups', ok(riverGroups)),

  // --- Connections (React connections screen) ---
  rest.get('*/api/connections/list', ok(connectionsList)),

  // --- New Source-to-Target data flow wizard (Steps 1-4 + Activate + Run) ---
  // Registered BEFORE the permissive fallbacks; specific */rivers/:id/<sub>
  // routes are ordered before the generic */rivers/:riverId inside this list.
  ...s2tHandlers,

  // --- Permissive fallbacks: never let an API call escape to the network ---
  // v1 host (paginated-style empty page covers fetchAllPages consumers)
  rest.get(
    '*/v1/*',
    ok({ items: [], next_page: '', current_page_size: 0, page: 1 }),
  ),
  rest.post('*/v1/*', ok({})),
  rest.put('*/v1/*', ok({})),
  rest.patch('*/v1/*', ok({})),
  rest.delete('*/v1/*', ok({})),
  // same-origin /api host
  rest.get('*/api/*', ok([])),
  rest.post('*/api/*', ok({})),
  rest.put('*/api/*', ok({})),
  rest.patch('*/api/*', ok({})),
  rest.delete('*/api/*', ok({})),
];
