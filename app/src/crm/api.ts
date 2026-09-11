/**
 * The CRM's own read API, as the browser sees it.
 *
 * Every path and every row shape comes from `shared/crm-api.ts`, which the
 * server imports too. Nothing in this file writes a URL literal or redeclares
 * a response type — that is deliberate, and it is the fix for a real defect:
 * the first version of this file invented `/api/crm/tours` and `/api/crm/agency`
 * against a server serving `/api/crm/trips` and no agency route at all, and
 * typed `/api/crm/staff` as a flat `CrmStaff[]` when the server returns
 * `{ staff: { staff, assignments }[] }`. Both halves compiled; every screen
 * 404'd, and the login screen's identity lookup silently never matched so the
 * Sign in button could never enable.
 *
 * Vite proxies `/api` to the node:http server (`app/vite.config.ts`), so the
 * browser only ever talks to same-origin URLs and never learns the port.
 *
 * The routes take no query parameters. Six departures and sixty-two travellers
 * is a dataset the browser can hold and filter in one hand, and pushing the
 * filters into SQL would buy nothing but a round trip per keystroke. Run
 * `pnpm seed:bulk` and that trade stops holding — which is itself worth
 * noticing.
 */

import {
  CRM_API,
  type StaffResponse,
  type TourResponse,
  type ToursResponse,
  type TravellersResponse,
} from '../../../shared/crm-api.js';

export type {
  CrmAgency,
  CrmBooking,
  CrmPayment,
  CrmStaff,
  CrmTour,
  CrmTraveller,
  DutyRole,
} from '../../../fixtures/types.js';
export type {
  StaffRecord,
  TourDetail,
  TourSummary,
  TravellerRecord,
} from '../../../shared/crm-api.js';

/**
 * A failed request carries the status so a caller can tell "this departure was
 * deleted" from "the server is not running", which are very different things to
 * put in front of a desk executive.
 */
export class CrmApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CrmApiError';
    this.status = status;
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, signal });
  } catch (cause) {
    // fetch only rejects when the request never completed: the dev server is
    // down, or the proxy has nothing to talk to. Status 0 says "no answer".
    throw new CrmApiError(
      cause instanceof Error && cause.name === 'AbortError'
        ? 'Request cancelled.'
        : 'Could not reach the Sharma Travels server. Is `pnpm dev` still running?',
      0,
    );
  }

  if (!response.ok) {
    throw new CrmApiError(`GET ${path} returned ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

/** The departures list. The agency record rides along — it has no route of its own. */
export function fetchTours(signal?: AbortSignal): Promise<ToursResponse> {
  return get(CRM_API.tours, signal);
}

export function fetchTour(tourId: string, signal?: AbortSignal): Promise<TourResponse> {
  return get(CRM_API.tour(tourId), signal);
}

export function fetchTravellers(signal?: AbortSignal): Promise<TravellersResponse> {
  return get(CRM_API.travellers, signal);
}

/**
 * The staff roster, with a last-known-good fallback — the ONE read in this file
 * that survives having no network, because it is the one that gates the whole
 * app.
 *
 * `App.tsx` fetches the roster once at boot and renders an error page if it
 * fails, so without this a reload with the network off stops at "Could not
 * reach the Sharma Travels server" and no route renders at all — including the
 * Kaafil ones. That made milestone 10's "reload the page, still offline" step
 * impossible to reach even with the app shell in `app/public/sw.js` doing its
 * job, and the wall had nothing to do with Kaafil: a manager's queued writes
 * were sitting intact in IndexedDB behind a CRM that would not boot.
 *
 * Deliberately narrow. Only this route caches, only a status-0 failure (the
 * request never completed) falls back, and a real HTTP error still surfaces —
 * a 500 from a running server is a bug to see, not to paper over with a stale
 * roster. The other screens are desk screens; they can say "offline" honestly.
 */
const ROSTER_CACHE_KEY = 'sharma-travels.roster.last-known-good';

export async function fetchStaff(signal?: AbortSignal): Promise<StaffResponse> {
  try {
    const fresh = await get<StaffResponse>(CRM_API.staff, signal);
    try {
      localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(fresh));
    } catch {
      // A full or disabled localStorage costs the offline boot, nothing else.
    }
    return fresh;
  } catch (cause) {
    if (!(cause instanceof CrmApiError) || cause.status !== 0) throw cause;
    let cached: string | null = null;
    try {
      cached = localStorage.getItem(ROSTER_CACHE_KEY);
    } catch {
      cached = null;
    }
    if (cached === null) throw cause;
    return JSON.parse(cached) as StaffResponse;
  }
}
