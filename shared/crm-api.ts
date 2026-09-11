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

// These declared the wrong field names for every one of the three routes —
// `staffId` where the server reads `managerRef`, `tourId`/`travellerId` where
// it reads `tripRef`/`travellerRef`, and a `url` on the share response that
// the server has never returned. All three typechecked perfectly and all
// three 400'd at runtime, which is precisely the failure this file's header
// says it exists to prevent. Declaring a contract is not the same as holding
// both sides to it: the CRM read routes are type-annotated on their handlers,
// these three were not, so nothing checked them. They are now.

export interface ManagerSessionRequest {
  /** Kaafil's manager ref, or your CRM's own id for that person. */
  managerRef: string;
}

export interface AgencyAdminSessionRequest {
  agencyAdminRef: string;
}

/** What both staff mints return. Hand `accessToken`/`refreshToken`/`agencyRef` to the provider. */
export interface StaffSessionResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  /** Kaafil's internal agency id — NOT what the provider wants. */
  agencyId: string;
  /** Your own ref for the agency. This is the provider's `agencyRef`. */
  agencyRef: string;
  baseUrl: string;
}

export interface ManagerSessionResponse extends StaffSessionResponse {
  managerId: string;
}

export type AgencyAdminSessionResponse = StaffSessionResponse;

export interface ShareLinkRequest {
  tripRef: string;
  /** Omit for a whole-trip link not scoped to one traveller. */
  travellerRef?: string;
}

export interface ShareLinkResponse {
  id: string;
  /** The whole credential for the traveller surface — pass as `shareToken`. */
  token: string;
  tripId: string;
  travellerId: string | null;
  status: string;
  expiresAt: string;
  /**
   * Which sections the traveller may see — a flag per section, not a list of
   * enabled names. This is the server's own answer about what the link
   * exposes, and it is why a "missing" section on a share page is a token
   * configuration question rather than a UI one.
   */
  sections: Readonly<Record<string, boolean>>;
  version: number;
  baseUrl: string;
}

/** The shape every route returns on failure. `code` is stable; `message` is not. */
export interface CrmErrorBody {
  error: { code: string; message: string; requestId?: string };
}
