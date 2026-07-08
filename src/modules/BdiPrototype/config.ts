/**
 * BDI prototype — runtime version toggle config.
 *
 * Pinned for the "Scheduled Retry - S2T Data Flows" prototype: this demo always
 * renders the original Rivery chrome (leftnav=rivery, masthead=off) and hides the
 * version switcher. The pin lives in readInitialBdiConfig/isBdiPrototypeEnv so URL
 * params, env vars, and localStorage left behind by the BDI-in-Boomi demo (same
 * github.io origin, same `bdi.*` keys) can't flip this prototype to Exosphere.
 */

export type LeftnavMode = 'rivery' | 'exo';
export type MastheadMode = 'off' | 'exo';

export interface BdiConfig {
  leftnav: LeftnavMode;
  masthead: MastheadMode;
}

const LS = { leftnav: 'bdi.leftnav', masthead: 'bdi.masthead' } as const;

function lsSet(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

export function readInitialBdiConfig(): BdiConfig {
  return { leftnav: 'rivery', masthead: 'off' };
}

export function persistBdiConfig(cfg: BdiConfig): void {
  lsSet(LS.leftnav, cfg.leftnav);
  lsSet(LS.masthead, cfg.masthead);
  // Reflect in the URL without triggering a route change.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('leftnav', cfg.leftnav);
    url.searchParams.set('masthead', cfg.masthead);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* ignore */
  }
}

/** The version switcher is disabled in this prototype (single pinned version). */
export function isBdiPrototypeEnv(): boolean {
  return false;
}
