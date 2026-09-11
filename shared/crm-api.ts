/**
 * The CRM's own HTTP contract — the one both halves import.
 *
 * WHY THIS FILE EXISTS. `server/` and `app/` are typechecked by two separate
 * tsconfigs that never meet, so nothing was checking the boundary between
 * them. The first build of this repo shipped a browser calling
 * `/api/crm/tours` against a server serving `/api/crm/trips`, and a login
 * screen typed `CrmStaff[]` against a server returning
 * `{ staff: { staff, assignments }[] }`. Both halves typechecked perfectly on
 * their own; the app 404'd on every screen and the Sign in button could never
 * enable, because the identity lookup silently never matched.
 *
 * Declaring the contract once and having BOTH sides depend on it turns that
 * entire class of defect into a compile error. The route handlers are typed by
 * their response, and the client's fetchers are typed by the same names.
 *
 * Anything that changes here must change on both sides, which is the point.
 */

import type {
  CrmAgency,
  CrmBooking,
  CrmPayment,
  CrmStaff,
  CrmTour,
  CrmTourStaff,
  CrmTraveller,
} from '../fixtures/types.js';

// ── Paths ───────────────────────────────────────────────────────────────────
// Single source of truth. The server registers these and the client fetches
// them; neither side writes a path literal of its own.

export const CRM_API = {
  /** The departures list, plus the agency the office belongs to. */
  tours: '/api/crm/trips',
  /** One departure, everything the detail screen needs, in one read. */
  tour: (tourId: string) => `/api/crm/trips/${encodeURIComponent(tourId)}`,
  /** Pattern form, for server route registration. */
  tourPattern: '/api/crm/trips/:tourId',
  travellers: '/api/crm/travellers',
  staff: '/api/crm/staff',
  health: '/api/health',
} as const;

/** The three routes that hold the API key. The browser never calls Kaafil. */
export const KAAFIL_API = {
  /** Mints a manager session for a tour leader. */
  session: '/api/session',
  /** Mints an agency-admin session for a desk executive. */
  adminSession: '/api/admin-session',
  /** Creates a traveller share link. */
  shareLink: '/api/share-link',
} as const;

// ── Row shapes ──────────────────────────────────────────────────────────────

export interface TourSummary {
  tour: CrmTour;
  bookingCount: number;
  paxBooked: number;
  billedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  /** Whoever holds `LEAD_LEADER` on this departure. `null` before one is rostered. */
  leadLeader: { staffId: string; fullName: string; phone: string } | null;
}

export interface TourDetail extends TourSummary {
  crew: readonly { assignment: CrmTourStaff; staff: CrmStaff }[];
  bookings: readonly { booking: CrmBooking; payments: readonly CrmPayment[] }[];
  travellers: readonly CrmTraveller[];
}

/** A traveller as the records screen lists them — with the departure they are on. */
export interface TravellerRecord {
  traveller: CrmTraveller;
  tourTitle: string;
  tourStatus: CrmTour['status'];
  partyName: string;
}

/** A staff member as the roster screen lists them. */
export interface StaffRecord {
  staff: CrmStaff;
  /** Departures this person is rostered onto, newest departure first. */
  assignments: readonly { tourId: string; tourTitle: string; dutyRole: CrmTourStaff['dutyRole'] }[];
}

// ── Response envelopes ──────────────────────────────────────────────────────
// Each is keyed by the path that returns it, so a reader can go from a URL in
// devtools to the type without searching.

export interface ToursResponse {
  agency: CrmAgency;
  tours: readonly TourSummary[];
}

export type TourResponse = TourDetail;

export interface TravellersResponse {
  travellers: readonly TravellerRecord[];
}

export interface StaffResponse {
  staff: readonly StaffRecord[];
}

// ── Kaafil route payloads ───────────────────────────────────────────────────

export interface SessionRequest {
  /** The CRM's own staff id. The server maps it to a Kaafil managerRef. */
  staffId: string;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  agencyRef: string;
}

export interface ShareLinkRequest {
  tourId: string;
  /** Omit for a whole-trip link not scoped to one traveller. */
  travellerId?: string;
}

export interface ShareLinkResponse {
  token: string;
  url: string;
}

/** The shape every route returns on failure. `code` is stable; `message` is not. */
export interface CrmErrorBody {
  error: { code: string; message: string; requestId?: string };
}
