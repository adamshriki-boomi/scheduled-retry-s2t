/**
 * Prototype Guide — story configuration.
 *
 * MARKETO_ID is the deterministic cross-id for the "Marketo Leads → Snowflake"
 * flow from the mock seed. It is computed by replicating mkId's arithmetic:
 *
 *   mkId(kind, i) = (kind * 1_000_000 + i).toString(16).padStart(24, '0')
 *
 * "Marketo Leads → Snowflake" is at index 7 in src/mocks/data/seed.ts SPECS
 * (0-based: indices 0–4 are Sales group, 5–6 are HubSpot*, 7 is Marketo).
 * Flow cross ids use kind=2, so: mkId(2, 7) = (2000007).toString(16).padStart(24,'0')
 *
 * = mkId(2, 7) for 'Marketo Leads → Snowflake' in src/mocks/data/seed.ts
 *   — regenerate if seed order changes.
 */
export const MARKETO_ID = '0000000000000000001e8487';

export interface TourStory {
  id: string;
  title: string;
  blurb: string;
  /** Returns the route path for this story, given account and env ids. */
  getRoute: (account: string, env: string) => string;
  /** Determines if the current pathname is "active" for this story. */
  isActive: (pathname: string, account: string, env: string) => boolean;
}

export const TOUR_STORIES: TourStory[] = [
  {
    id: 'settings',
    title: 'Enable it for the account',
    blurb:
      'Admins turn on Scheduled Retry once per account (Settings → Features) and set the default retry values applied to new data flows.',
    getRoute: (account, env) => `/settings/${account}/${env}`,
    isActive: (pathname, account, env) =>
      pathname.startsWith(`/settings/${account}/${env}`),
  },
  {
    id: 'new-flow',
    title: 'Configure retry on a data flow',
    blurb:
      'The new Retry section sits under the Scheduler in step 4: toggle "Retry failed runs", set Max retries (1–12) and Delay (1–60 min). Walk the mocked MySQL → Snowflake path from step 1.',
    getRoute: (account, env) =>
      `/rivers/${account}/${env}/new/source-to-target`,
    isActive: (pathname, account, env) =>
      pathname.startsWith(`/rivers/${account}/${env}/new/source-to-target`),
  },
  {
    id: 'activities',
    title: 'Watch a flow self-heal',
    blurb:
      "In 'Marketo Leads → Snowflake' a failed scheduled run recovered automatically 5 minutes later — the new Trigger column marks the recovery run as Retry.",
    getRoute: (account, env) =>
      `/activities/${account}/${env}/activities/${MARKETO_ID}`,
    isActive: (pathname, account, env) =>
      pathname.startsWith(
        `/activities/${account}/${env}/activities/${MARKETO_ID}`,
      ),
  },
  {
    id: 'flow-summary',
    title: 'See how a run was triggered',
    blurb:
      "The Data Flow summary now shows the last run's trigger — Schedule, API, Logic, Manual, or Retry — right after Last Modified.",
    getRoute: (account, env) => `/rivers/${account}/${env}/${MARKETO_ID}`,
    isActive: (pathname, account, env) => {
      const target = `/rivers/${account}/${env}/${MARKETO_ID}`;
      // Must match exactly this flow's river page, not the new-flow wizard
      // (story 2) or any other sub-path under rivers.
      return (
        pathname === target ||
        (pathname.startsWith(target) && pathname[target.length] === '/')
      );
    },
  },
];
