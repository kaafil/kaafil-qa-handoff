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

export function fetchStaff(signal?: AbortSignal): Promise<StaffResponse> {
  return get(CRM_API.staff, signal);
}
