# Scheduled Retry — S2T Data Flows — Live Prototype

A live prototype of the **Scheduled Retry** capability for Source-to-Target (S2T) data
flows (PRD epic CORE-2320, UI ticket CORE-2446), built on the cloned Rivery front-end
(`react_rivery`) running on a **mock backend**. Stakeholders can walk the real 4-step
"new S2T data flow" wizard end-to-end — **Set Up Data Source → Select Data Target →
Configure Schema → Schedule & Settings** — and see the new Scheduled Retry UX in
authentic product UI (Chakra / original Rivery chrome).

This repo is a sibling of the [BDI-in-Boomi](https://github.com/adamshriki-boomi/BDI-in-Boomi)
prototype and inherits its infrastructure (mock backend, GitHub Pages deploy). The
Exosphere version switcher from that prototype is **pinned off** here — this demo always
renders the original Rivery chrome (`src/modules/BdiPrototype/config.ts`).

## Prototype Guide (floating navigator)

A **Prototype Guide** panel floats in the bottom-right corner of every authenticated page. It lists the four feature surfaces — account settings, new flow wizard, Activities run history, and flow summary — and navigates to each with a single click. The currently active surface is highlighted with a left accent. Cold visitors see the panel expanded; subsequent visits remember your last collapsed/expanded state per browser (stored in `localStorage` under the key `srs2t.tour.collapsed`). Click the pill button to re-open it.

## What's new in this prototype

| Surface | What to look at |
|---|---|
| Wizard step 4 — Schedule & Settings | New **Retry** section under the Scheduler: "Retry failed runs" toggle (badge *S2T only*), **Max retries** (1–12, default 3), **Delay between retries** (1–60 min, default 5), inline range validation |
| Settings → account settings (Features) | **Enable Scheduled Retry** account toggle + default retry count/delay for new data flows |
| Data Flow summary page | **Trigger** row after *Last Modified* — Schedule / API / Logic / Manual / **Retry** |
| Activities → per-flow run history | **Trigger** column showing a failed scheduled run recovered by a successful **Retry** run |

## Demo script (stakeholder click-path)

1. Land on the Dashboard (auto-login via mocks).
2. **Create → Data Flow**: MySQL → connection *test shiran* → **Test Connection** (succeeds) → Next.
3. Snowflake → connection *Rivery Snowflake* → Database *das* / Schema *fsd* → Next.
4. Multi Tables loads MySQL schemas (classicmodels…) → select a few tables → Next.
5. **Schedule & Settings**: the **Retry failed runs** section sits right under Schedule
   Data Flow. Toggle it, try Max retries = 20 → inline validation error blocks Activate;
   set 3 → Activate.
6. After activation, the Data Flow summary shows the **Trigger** row.
7. **Activities** → open *Marketo Leads → Snowflake* → the run list shows a failed
   scheduled run followed by a successful run marked **Retry**.
8. **Settings → account settings**: flip the account-level default and create a new data
   flow to see defaults applied.

---

## Prerequisites

- **Node 18.20.8** (pinned in `.nvmrc`). Install via `nvm`: `nvm install 18.20.8 && nvm use`.
- A hosts entry so the app can serve over its expected SSL domain (already present on the dev machine):
  ```
  127.0.0.1 localhost.rivery.in
  ```
- The SSL cert is auto-provisioned by `vite-plugin-mkcert` on first run (cert files also live in `.cert/`).

## Run it (mock backend — default)

```bash
nvm use                         # Node 18.20.8
export NODE_TLS_REJECT_UNAUTHORIZED=0   # corporate TLS (zscaler) workaround
npm install
npm start                        # vite dev server
```

Open **https://localhost.rivery.in:3000/** (accept the local self-signed cert).

- A local override file **`.env.development.local`** (gitignored) sets `VITE_PORT=3000`
  (avoids needing `sudo` for port 443) and `VITE_USE_MOCKS=true`.
- The app **auto-logs-in via MSW mocks** and lands on the authenticated shell — no real
  backend or credentials needed. Mock identity: *Adam Shriki* / account *Boomi Data
  Integration* / env *Production*.

## Switching to a real staging/dev backend

In `.env.development.local` set `VITE_USE_MOCKS=false`, then point the API at your
environment (these already have dev defaults in `.env.development`):

```
VITE_USE_MOCKS=false
VITE_API_BASE_URL_DEFAULT=https://api.dev.rivery.in/v1
VITE_PROXY=https://console.dev.rivery.in/
```

With mocks off the app uses the real `LoginGuard` (you'll sign in normally) and live data.
(Note: the Scheduled Retry surfaces are prototype-only — a real backend won't persist them.)

## Deploy (GitHub Pages)

The prototype is deployed as a static, mock-backed build.

**Live:** https://adamshriki-boomi.github.io/scheduled-retry-s2t/

- **Auto-deploys** on every push to `main` via `.github/workflows/pages.yml` (Node 18 →
  `npm run build` with `VITE_USE_MOCKS=true` and `VITE_BASE_PATH=/scheduled-retry-s2t/`, then
  publishes `build/`). A deploy takes ~4–5 min.
- **Sub-path aware:** Vite `base` = `VITE_BASE_PATH`; the router `basename` and the MSW
  service-worker URL both derive from `import.meta.env.BASE_URL`, so everything resolves
  under `/scheduled-retry-s2t/`. The workflow copies `index.html` → `404.html` (SPA deep-link
  fallback) and adds `.nojekyll`.

> The repo is **public** (required for GitHub Pages on this plan) and contains the full
> `react_rivery` source — an interim host until the Bitbucket path is sorted. The 61 MB
> `lambdaFiles/hyperexecute_mac` CI runner is excluded from this copy entirely.

---

## Where things live (prototype additions)

| Area | Path |
|---|---|
| Step-4 Retry section | `src/modules/SourceTarget/components/Schedule/RetrySettings.tsx` |
| Retry data model | `src/modules/SourceTarget/store/types.ts` (`ScheduledRetrySetting`) |
| Account Features toggle | `src/containers/AppSettings/AdminAccountSettings.tsx` |
| Summary Trigger row | `src/containers/River/RiverSourceToTarget/Overview/ScheduleOverview.tsx` |
| Activities Trigger column | `src/containers/Activities/[id]/LeftContainer/` |
| MSW mock backend (handlers, fixtures, worker) | `src/mocks/` (started in `src/index.tsx`) |
| S2T wizard mock data/state | `src/mocks/data/s2t.metadata.ts`, `src/mocks/data/s2t.state.ts` |
| Pinned chrome config (Rivery only, switcher off) | `src/modules/BdiPrototype/config.ts` |

## Notable implementation details (inherited from the parent prototype)

- **`headers-polyfill` pinned to `3.0.4`** via `package.json` `overrides` — `msw@0.44.2`
  needs it (`headers.all()` + `headers-polyfill/lib`); newer versions break the Vite build.
- **Root redirect for static hosting** — at `/` the app redirects to the Dashboard route
  once account + env resolve (the legacy `/ng` iframe has no host on a static deploy).
- The Exosphere components from the parent prototype remain in the codebase but are
  dormant (never rendered) — see `EXOSPHERE-CUSTOM.md` for their documentation.

## Known limitations (by design for this prototype)

- Legacy areas that are still the **Angular `/ng` iframe** have no host on the static/mock
  deploy — irrelevant to the Scheduled Retry flows, which are fully React.
- Only the demo path's data is mocked in depth (MySQL → Snowflake); other connectors show
  in pickers but aren't walkable.
- Scheduled Retry settings persist per browser (mock backend + localStorage), not to any
  real backend.
