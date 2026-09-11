/**
 * Sharma Travels' own back-office store.
 *
 * This file is the CRM's product, not Kaafil's. Nothing in it imports
 * `kaafil-js`, knows what a `tripRef` is, or has any opinion about what the
 * UI Kit needs — it reads and writes a tour operator's own tables, exactly as
 * the real thing would. The translation into Kaafil's vocabulary happens in
 * one place, `server/ingest.ts`, and nowhere else.
 *
 * ── WHY THE FILE IS DELETED ON EVERY BOOT ──────────────────────────────────
 *
 * `openStore()` unlinks `crm.sqlite` before it opens it, and rebuilds the
 * whole thing from `fixtures/core.ts`. That is deliberate and it is the
 * requirement, not a shortcut. A QA on this exercise restarts the server
 * dozens of times — mid-integration, after a crash, after an edit — and the
 * one thing that must never vary between restarts is what they are looking
 * at. A migrating store would accumulate whatever half-state the previous
 * run left behind, and the first time a measured timing looked wrong we
 * would not be able to tell a product defect from a dirty database. Wiping
 * costs about fifteen milliseconds and buys a reproducible starting state.
 *
 * Note the asymmetry, which is intentional: THIS store is destroyed on every
 * boot; the QA's Kaafil tenant is never touched automatically. Resetting the
 * engine side is `pnpm reset:kaafil`, explicit and separate, because the
 * engine's fixture rebuild is destructive and rate limited — wiring it to
 * boot would 429 anyone who restarts twice in a minute.
 *
 * Schema conventions: snake_case columns mirroring `fixtures/types.ts`
 * field-for-field, integer paise in every `*_minor` column, `0`/`1` for
 * booleans, and ISO-8601 strings for every date and instant. Each row keeps
 * its own `source_updated_at` from the fixture; nothing here reads the clock.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { CORE_FIXTURE } from '../fixtures/core.js';
import type {
  CrmAgency,
  CrmBooking,
  CrmFixture,
  CrmItineraryDay,
  CrmPayment,
  CrmStaff,
  CrmTour,
  CrmTourStaff,
  CrmTraveller,
} from '../fixtures/types.js';

type Db = InstanceType<typeof Database>;

/** Repo root, one level up from `server/`. The store sits next to `.env`. */
const DB_PATH = fileURLToPath(new URL('../crm.sqlite', import.meta.url));

const SCHEMA = `
CREATE TABLE agency (
  agency_code        TEXT PRIMARY KEY,
  legal_name         TEXT NOT NULL,
  brand_name         TEXT NOT NULL,
  gstin              TEXT NOT NULL,
  head_office_city   TEXT NOT NULL,
  head_office_state  TEXT NOT NULL,
  support_phone      TEXT NOT NULL,
  support_email      TEXT NOT NULL,
  website            TEXT NOT NULL,
  source_updated_at  TEXT NOT NULL
);

CREATE TABLE staff (
  staff_id           TEXT PRIMARY KEY,
  staff_code         TEXT NOT NULL UNIQUE,
  full_name          TEXT NOT NULL,
  role               TEXT NOT NULL,
  phone              TEXT NOT NULL,
  login_email        TEXT NOT NULL UNIQUE,
  based_in           TEXT NOT NULL,
  -- A JSON array. SQLite has no list type and a languages_staff join table
  -- would be three tables of ceremony for a field nothing ever queries by.
  languages          TEXT NOT NULL,
  joined_on          TEXT NOT NULL,
  active             INTEGER NOT NULL,
  source_updated_at  TEXT NOT NULL
);

CREATE TABLE tours (
  tour_id              TEXT PRIMARY KEY,
  package_code         TEXT NOT NULL,
  title                TEXT NOT NULL,
  destination          TEXT NOT NULL,
  region               TEXT NOT NULL,
  start_date           TEXT NOT NULL,
  end_date             TEXT NOT NULL,
  boarding_city        TEXT NOT NULL,
  meeting_point        TEXT NOT NULL,
  timezone             TEXT NOT NULL,
  currency             TEXT NOT NULL,
  status               TEXT NOT NULL,
  style                TEXT NOT NULL,
  selling_mode         TEXT NOT NULL,
  price_per_seat_minor INTEGER NOT NULL,
  seats_total          INTEGER NOT NULL,
  seats_sold           INTEGER NOT NULL,
  settlement_due_on    TEXT,
  called_off_on        TEXT,
  called_off_reason    TEXT,
  notes                TEXT,
  source_updated_at    TEXT NOT NULL
);

CREATE TABLE itinerary_days (
  tour_id      TEXT NOT NULL REFERENCES tours(tour_id),
  day_number   INTEGER NOT NULL,
  date         TEXT NOT NULL,
  title        TEXT NOT NULL,
  night_halt   TEXT,
  PRIMARY KEY (tour_id, day_number)
);

CREATE TABLE tour_staff (
  tour_id            TEXT NOT NULL REFERENCES tours(tour_id),
  staff_id           TEXT NOT NULL REFERENCES staff(staff_id),
  duty_role          TEXT NOT NULL,
  assigned_on        TEXT NOT NULL,
  source_updated_at  TEXT NOT NULL,
  PRIMARY KEY (tour_id, staff_id)
);

CREATE TABLE bookings (
  booking_ref        TEXT PRIMARY KEY,
  tour_id            TEXT NOT NULL REFERENCES tours(tour_id),
  party_name         TEXT NOT NULL,
  lead_traveller_id  TEXT NOT NULL,
  pax_count          INTEGER NOT NULL,
  channel            TEXT NOT NULL,
  status             TEXT NOT NULL,
  booked_on          TEXT NOT NULL,
  gross_minor        INTEGER NOT NULL,
  discount_minor     INTEGER NOT NULL,
  total_minor        INTEGER NOT NULL,
  received_minor     INTEGER NOT NULL,
  balance_due_on     TEXT,
  remarks            TEXT,
  source_updated_at  TEXT NOT NULL
);

CREATE TABLE payments (
  payment_id            TEXT PRIMARY KEY,
  booking_ref           TEXT NOT NULL REFERENCES bookings(booking_ref),
  direction             TEXT NOT NULL,
  amount_minor          INTEGER NOT NULL,
  mode                  TEXT NOT NULL,
  paid_on               TEXT NOT NULL,
  reference             TEXT NOT NULL,
  recorded_by_staff_id  TEXT NOT NULL REFERENCES staff(staff_id),
  source_updated_at     TEXT NOT NULL
);

CREATE TABLE travellers (
  traveller_id             TEXT PRIMARY KEY,
  tour_id                  TEXT NOT NULL REFERENCES tours(tour_id),
  booking_ref              TEXT NOT NULL REFERENCES bookings(booking_ref),
  full_name                TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  email                    TEXT,
  gender                   TEXT NOT NULL,
  date_of_birth            TEXT,
  party_role               TEXT NOT NULL,
  relation_to_lead         TEXT NOT NULL,
  city                     TEXT NOT NULL,
  state                    TEXT NOT NULL,
  meal_preference          TEXT NOT NULL,
  medical_notes            TEXT,
  id_proof_type            TEXT,
  permit_number            TEXT,
  emergency_contact_name   TEXT,
  emergency_contact_phone  TEXT,
  preferred_language       TEXT NOT NULL,
  fitness_cleared          INTEGER,
  source_updated_at        TEXT NOT NULL
);

CREATE INDEX idx_bookings_tour ON bookings(tour_id);
CREATE INDEX idx_travellers_tour ON travellers(tour_id);
CREATE INDEX idx_travellers_booking ON travellers(booking_ref);
CREATE INDEX idx_payments_booking ON payments(booking_ref);
`;

// ---------------------------------------------------------------------------
// Row shapes
//
// better-sqlite3 hands back `unknown` — it cannot know a query's columns. These
// interfaces are the one place a cast happens, and each mirrors the SELECT that
// produces it, so a schema edit that forgets one of them is a compile error in
// the mapper below rather than an `undefined` that reaches the browser.
// ---------------------------------------------------------------------------

interface AgencyRow {
  agency_code: string;
  legal_name: string;
  brand_name: string;
  gstin: string;
  head_office_city: string;
  head_office_state: string;
  support_phone: string;
  support_email: string;
  website: string;
  source_updated_at: string;
}

interface StaffRow {
  staff_id: string;
  staff_code: string;
  full_name: string;
  role: string;
  phone: string;
  login_email: string;
  based_in: string;
  languages: string;
  joined_on: string;
  active: number;
  source_updated_at: string;
}

interface TourRow {
  tour_id: string;
  package_code: string;
  title: string;
  destination: string;
  region: string;
  start_date: string;
  end_date: string;
  boarding_city: string;
  meeting_point: string;
  timezone: string;
  currency: string;
  status: string;
  style: string;
  selling_mode: string;
  price_per_seat_minor: number;
  seats_total: number;
  seats_sold: number;
  settlement_due_on: string | null;
  called_off_on: string | null;
  called_off_reason: string | null;
  notes: string | null;
  source_updated_at: string;
}

interface ItineraryRow {
  tour_id: string;
  day_number: number;
  date: string;
  title: string;
  night_halt: string | null;
}

interface TourStaffRow {
  tour_id: string;
  staff_id: string;
  duty_role: string;
  assigned_on: string;
  source_updated_at: string;
}

interface BookingRow {
  booking_ref: string;
  tour_id: string;
  party_name: string;
  lead_traveller_id: string;
  pax_count: number;
  channel: string;
  status: string;
  booked_on: string;
  gross_minor: number;
  discount_minor: number;
  total_minor: number;
  received_minor: number;
  balance_due_on: string | null;
  remarks: string | null;
  source_updated_at: string;
}

interface PaymentRow {
  payment_id: string;
  booking_ref: string;
  direction: string;
  amount_minor: number;
  mode: string;
  paid_on: string;
  reference: string;
  recorded_by_staff_id: string;
  source_updated_at: string;
}

interface TravellerRow {
  traveller_id: string;
  tour_id: string;
  booking_ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  gender: string;
  date_of_birth: string | null;
  party_role: string;
  relation_to_lead: string;
  city: string;
  state: string;
  meal_preference: string;
  medical_notes: string | null;
  id_proof_type: string | null;
  permit_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  preferred_language: string;
  fitness_cleared: number | null;
  source_updated_at: string;
}

/** SQLite stores no `undefined`; an absent optional field comes back `null`. */
function optional(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

// ---------------------------------------------------------------------------
// Row -> domain
// ---------------------------------------------------------------------------

function toAgency(row: AgencyRow): CrmAgency {
  return {
    agencyCode: row.agency_code,
    legalName: row.legal_name,
    brandName: row.brand_name,
    gstin: row.gstin,
    headOfficeCity: row.head_office_city,
    headOfficeState: row.head_office_state,
    supportPhone: row.support_phone,
    supportEmail: row.support_email,
    website: row.website,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toStaff(row: StaffRow): CrmStaff {
  return {
    staffId: row.staff_id,
    staffCode: row.staff_code,
    fullName: row.full_name,
    role: row.role as CrmStaff['role'],
    phone: row.phone,
    loginEmail: row.login_email,
    basedIn: row.based_in,
    languages: JSON.parse(row.languages) as string[],
    joinedOn: row.joined_on,
    active: row.active === 1,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toItineraryDay(row: ItineraryRow): CrmItineraryDay {
  return {
    dayNumber: row.day_number,
    date: row.date,
    title: row.title,
    nightHalt: row.night_halt,
  };
}

function toTour(row: TourRow, itinerary: readonly CrmItineraryDay[]): CrmTour {
  return {
    tourId: row.tour_id,
    packageCode: row.package_code,
    title: row.title,
    destination: row.destination,
    region: row.region,
    startDate: row.start_date,
    endDate: row.end_date,
    boardingCity: row.boarding_city,
    meetingPoint: row.meeting_point,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status as CrmTour['status'],
    style: row.style as CrmTour['style'],
    sellingMode: row.selling_mode as CrmTour['sellingMode'],
    pricePerSeatMinor: row.price_per_seat_minor,
    seatsTotal: row.seats_total,
    seatsSold: row.seats_sold,
    itinerary,
    settlementDueOn: optional(row.settlement_due_on),
    calledOffOn: optional(row.called_off_on),
    calledOffReason: optional(row.called_off_reason),
    notes: optional(row.notes),
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toTourStaff(row: TourStaffRow): CrmTourStaff {
  return {
    tourId: row.tour_id,
    staffId: row.staff_id,
    dutyRole: row.duty_role as CrmTourStaff['dutyRole'],
    assignedOn: row.assigned_on,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toBooking(row: BookingRow): CrmBooking {
  return {
    bookingRef: row.booking_ref,
    tourId: row.tour_id,
    partyName: row.party_name,
    leadTravellerId: row.lead_traveller_id,
    paxCount: row.pax_count,
    channel: row.channel as CrmBooking['channel'],
    status: row.status as CrmBooking['status'],
    bookedOn: row.booked_on,
    grossMinor: row.gross_minor,
    discountMinor: row.discount_minor,
    totalMinor: row.total_minor,
    receivedMinor: row.received_minor,
    balanceDueOn: optional(row.balance_due_on),
    remarks: optional(row.remarks),
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toPayment(row: PaymentRow): CrmPayment {
  return {
    paymentId: row.payment_id,
    bookingRef: row.booking_ref,
    direction: row.direction as CrmPayment['direction'],
    amountMinor: row.amount_minor,
    mode: row.mode as CrmPayment['mode'],
    paidOn: row.paid_on,
    reference: row.reference,
    recordedByStaffId: row.recorded_by_staff_id,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function toTraveller(row: TravellerRow): CrmTraveller {
  return {
    travellerId: row.traveller_id,
    tourId: row.tour_id,
    bookingRef: row.booking_ref,
    fullName: row.full_name,
    phone: row.phone,
    email: optional(row.email),
    gender: row.gender as CrmTraveller['gender'],
    dateOfBirth: optional(row.date_of_birth),
    partyRole: row.party_role as CrmTraveller['partyRole'],
    relationToLead: row.relation_to_lead,
    city: row.city,
    state: row.state,
    mealPreference: row.meal_preference as CrmTraveller['mealPreference'],
    medicalNotes: row.medical_notes,
    idProofType: (row.id_proof_type ?? undefined) as CrmTraveller['idProofType'],
    permitNumber: optional(row.permit_number),
    emergencyContactName: optional(row.emergency_contact_name),
    emergencyContactPhone: optional(row.emergency_contact_phone),
    preferredLanguage: row.preferred_language,
    fitnessCleared: row.fitness_cleared === null ? undefined : row.fitness_cleared === 1,
    sourceUpdatedAt: row.source_updated_at,
  };
}

// ---------------------------------------------------------------------------
// Read models the CRM screens actually render
// ---------------------------------------------------------------------------

// The four read models these screens render are declared ONCE in
// `shared/crm-api.ts`, because the browser needs the identical shapes and a
// second copy here is how the two halves drifted apart the first time. Kept
// re-exported so existing importers of `../db.js` keep working.
//
// Both statements are needed: `export type ... from` re-exports the names
// without binding them in this module's scope, and the store's own signatures
// below use all four.
import type { StaffRecord, TourDetail, TourSummary, TravellerRecord } from '../shared/crm-api.js';

export type {
  StaffRecord,
  TourDetail,
  TourSummary,
  TravellerRecord,
} from '../shared/crm-api.js';

export interface StoreCounts {
  staff: number;
  tours: number;
  bookings: number;
  payments: number;
  travellers: number;
}

export interface CrmStore {
  readonly path: string;
  readonly counts: StoreCounts;
  agency(): CrmAgency;
  listTours(): TourSummary[];
  getTour(tourId: string): TourDetail | null;
  listTravellers(): TravellerRecord[];
  listStaff(): StaffRecord[];
  /** The whole seed, for `server/ingest.ts` to translate into Kaafil's shapes. */
  snapshot(): CrmFixture;
  close(): void;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function removeIfPresent(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function seed(db: Db, fixture: CrmFixture): void {
  const insertAgency = db.prepare(`
    INSERT INTO agency (agency_code, legal_name, brand_name, gstin, head_office_city,
      head_office_state, support_phone, support_email, website, source_updated_at)
    VALUES (@agencyCode, @legalName, @brandName, @gstin, @headOfficeCity,
      @headOfficeState, @supportPhone, @supportEmail, @website, @sourceUpdatedAt)
  `);
  const insertStaff = db.prepare(`
    INSERT INTO staff (staff_id, staff_code, full_name, role, phone, login_email, based_in,
      languages, joined_on, active, source_updated_at)
    VALUES (@staffId, @staffCode, @fullName, @role, @phone, @loginEmail, @basedIn,
      @languages, @joinedOn, @active, @sourceUpdatedAt)
  `);
  const insertTour = db.prepare(`
    INSERT INTO tours (tour_id, package_code, title, destination, region, start_date, end_date,
      boarding_city, meeting_point, timezone, currency, status, style, selling_mode,
      price_per_seat_minor, seats_total, seats_sold, settlement_due_on, called_off_on,
      called_off_reason, notes, source_updated_at)
    VALUES (@tourId, @packageCode, @title, @destination, @region, @startDate, @endDate,
      @boardingCity, @meetingPoint, @timezone, @currency, @status, @style, @sellingMode,
      @pricePerSeatMinor, @seatsTotal, @seatsSold, @settlementDueOn, @calledOffOn,
      @calledOffReason, @notes, @sourceUpdatedAt)
  `);
  const insertDay = db.prepare(`
    INSERT INTO itinerary_days (tour_id, day_number, date, title, night_halt)
    VALUES (@tourId, @dayNumber, @date, @title, @nightHalt)
  `);
  const insertTourStaff = db.prepare(`
    INSERT INTO tour_staff (tour_id, staff_id, duty_role, assigned_on, source_updated_at)
    VALUES (@tourId, @staffId, @dutyRole, @assignedOn, @sourceUpdatedAt)
  `);
  const insertBooking = db.prepare(`
    INSERT INTO bookings (booking_ref, tour_id, party_name, lead_traveller_id, pax_count, channel,
      status, booked_on, gross_minor, discount_minor, total_minor, received_minor, balance_due_on,
      remarks, source_updated_at)
    VALUES (@bookingRef, @tourId, @partyName, @leadTravellerId, @paxCount, @channel,
      @status, @bookedOn, @grossMinor, @discountMinor, @totalMinor, @receivedMinor, @balanceDueOn,
      @remarks, @sourceUpdatedAt)
  `);
  const insertPayment = db.prepare(`
    INSERT INTO payments (payment_id, booking_ref, direction, amount_minor, mode, paid_on,
      reference, recorded_by_staff_id, source_updated_at)
    VALUES (@paymentId, @bookingRef, @direction, @amountMinor, @mode, @paidOn,
      @reference, @recordedByStaffId, @sourceUpdatedAt)
  `);
  const insertTraveller = db.prepare(`
    INSERT INTO travellers (traveller_id, tour_id, booking_ref, full_name, phone, email, gender,
      date_of_birth, party_role, relation_to_lead, city, state, meal_preference, medical_notes,
      id_proof_type, permit_number, emergency_contact_name, emergency_contact_phone,
      preferred_language, fitness_cleared, source_updated_at)
    VALUES (@travellerId, @tourId, @bookingRef, @fullName, @phone, @email, @gender,
      @dateOfBirth, @partyRole, @relationToLead, @city, @state, @mealPreference, @medicalNotes,
      @idProofType, @permitNumber, @emergencyContactName, @emergencyContactPhone,
      @preferredLanguage, @fitnessCleared, @sourceUpdatedAt)
  `);

  // One transaction for the whole seed: a partially written store is worse
  // than no store, because the CRM would render and only look subtly wrong.
  const writeAll = db.transaction((f: CrmFixture) => {
    insertAgency.run(f.agency);

    for (const person of f.staff) {
      insertStaff.run({
        ...person,
        languages: JSON.stringify(person.languages),
        active: person.active ? 1 : 0,
      });
    }

    for (const tour of f.tours) {
      // Listed field by field rather than spread: `CrmTour` carries an
      // `itinerary` array that belongs in its own table, and better-sqlite3
      // rejects both an array bind and a named parameter the statement has no
      // placeholder for.
      insertTour.run({
        tourId: tour.tourId,
        packageCode: tour.packageCode,
        title: tour.title,
        destination: tour.destination,
        region: tour.region,
        startDate: tour.startDate,
        endDate: tour.endDate,
        boardingCity: tour.boardingCity,
        meetingPoint: tour.meetingPoint,
        timezone: tour.timezone,
        currency: tour.currency,
        status: tour.status,
        style: tour.style,
        sellingMode: tour.sellingMode,
        pricePerSeatMinor: tour.pricePerSeatMinor,
        seatsTotal: tour.seatsTotal,
        seatsSold: tour.seatsSold,
        settlementDueOn: tour.settlementDueOn ?? null,
        calledOffOn: tour.calledOffOn ?? null,
        calledOffReason: tour.calledOffReason ?? null,
        notes: tour.notes ?? null,
        sourceUpdatedAt: tour.sourceUpdatedAt,
      });
      for (const day of tour.itinerary) {
        insertDay.run({ ...day, tourId: tour.tourId });
      }
    }

    for (const assignment of f.tourStaff) {
      insertTourStaff.run(assignment);
    }
    for (const booking of f.bookings) {
      insertBooking.run({
        ...booking,
        balanceDueOn: booking.balanceDueOn ?? null,
        remarks: booking.remarks ?? null,
      });
    }
    for (const payment of f.payments) {
      insertPayment.run(payment);
    }
    for (const traveller of f.travellers) {
      insertTraveller.run({
        ...traveller,
        email: traveller.email ?? null,
        dateOfBirth: traveller.dateOfBirth ?? null,
        idProofType: traveller.idProofType ?? null,
        permitNumber: traveller.permitNumber ?? null,
        emergencyContactName: traveller.emergencyContactName ?? null,
        emergencyContactPhone: traveller.emergencyContactPhone ?? null,
        fitnessCleared:
          traveller.fitnessCleared === undefined ? null : traveller.fitnessCleared ? 1 : 0,
      });
    }
  });

  writeAll(fixture);
}

/**
 * Deletes `crm.sqlite`, rebuilds it, seeds it, and returns the read API the
 * `/api/crm/*` routes use. See this file's header for why the delete is not
 * optional.
 *
 * `fixture` defaults to the hand-written core seed; `pnpm seed:bulk` passes a
 * much larger generated one of the same shape.
 */
export function openStore(fixture: CrmFixture = CORE_FIXTURE): CrmStore {
  removeIfPresent(DB_PATH);
  // SQLite's own sidecars. They only exist if a previous process died in WAL
  // mode, and an orphaned `-wal` next to a brand-new main file would be read
  // back as committed data that never was.
  removeIfPresent(`${DB_PATH}-wal`);
  removeIfPresent(`${DB_PATH}-shm`);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seed(db, fixture);

  const selectAgency = db.prepare('SELECT * FROM agency LIMIT 1');
  const selectTours = db.prepare('SELECT * FROM tours ORDER BY start_date DESC, tour_id');
  const selectTour = db.prepare('SELECT * FROM tours WHERE tour_id = ?');
  const selectDays = db.prepare(
    'SELECT * FROM itinerary_days WHERE tour_id = ? ORDER BY day_number',
  );
  const selectAllDays = db.prepare('SELECT * FROM itinerary_days ORDER BY tour_id, day_number');
  // The assignment's columns are aliased rather than splatted. `SELECT ts.*,
  // s.*` looks tidier and is wrong: tour_staff and staff BOTH carry
  // `source_updated_at`, better-sqlite3 keeps the last column of a duplicate
  // name, and so every crew row silently reported the person's timestamp as
  // the assignment's. Two tables that happen to share a column name is the
  // normal case, not the exotic one, so the aliases stay.
  const selectCrew = db.prepare(`
    SELECT
      ts.tour_id          AS assignment_tour_id,
      ts.staff_id         AS assignment_staff_id,
      ts.duty_role        AS assignment_duty_role,
      ts.assigned_on      AS assignment_assigned_on,
      ts.source_updated_at AS assignment_source_updated_at,
      s.*
    FROM tour_staff ts
    JOIN staff s ON s.staff_id = ts.staff_id
    WHERE ts.tour_id = ?
    ORDER BY ts.duty_role, s.full_name
  `);
  const selectAllTourStaff = db.prepare('SELECT * FROM tour_staff ORDER BY tour_id, staff_id');
  const selectStaff = db.prepare('SELECT * FROM staff ORDER BY role, full_name');
  const selectStaffAssignments = db.prepare(`
    SELECT ts.staff_id, ts.duty_role, t.tour_id, t.title AS tour_title
    FROM tour_staff ts JOIN tours t ON t.tour_id = ts.tour_id
    ORDER BY t.start_date DESC
  `);
  const selectBookings = db.prepare('SELECT * FROM bookings ORDER BY booking_ref');
  const selectBookingsForTour = db.prepare(
    'SELECT * FROM bookings WHERE tour_id = ? ORDER BY booking_ref',
  );
  const selectPayments = db.prepare('SELECT * FROM payments ORDER BY paid_on, payment_id');
  const selectPaymentsForTour = db.prepare(`
    SELECT p.* FROM payments p JOIN bookings b ON b.booking_ref = p.booking_ref
    WHERE b.tour_id = ? ORDER BY p.paid_on, p.payment_id
  `);
  const selectTravellers = db.prepare('SELECT * FROM travellers ORDER BY traveller_id');
  const selectTravellersForTour = db.prepare(
    'SELECT * FROM travellers WHERE tour_id = ? ORDER BY booking_ref, party_role DESC, full_name',
  );
  const selectTravellerRecords = db.prepare(`
    SELECT tv.*, t.title AS tour_title, t.status AS tour_status, b.party_name AS party_name
    FROM travellers tv
    JOIN tours t ON t.tour_id = tv.tour_id
    JOIN bookings b ON b.booking_ref = tv.booking_ref
    ORDER BY t.start_date DESC, tv.booking_ref, tv.full_name
  `);
  const selectRollups = db.prepare(`
    SELECT tour_id,
           COUNT(*)             AS booking_count,
           SUM(pax_count)       AS pax_booked,
           SUM(total_minor)     AS billed_minor,
           SUM(received_minor)  AS received_minor
    FROM bookings GROUP BY tour_id
  `);
  const selectLeads = db.prepare(`
    SELECT ts.tour_id, s.staff_id, s.full_name, s.phone
    FROM tour_staff ts JOIN staff s ON s.staff_id = ts.staff_id
    WHERE ts.duty_role = 'LEAD_LEADER'
  `);

  interface RollupRow {
    tour_id: string;
    booking_count: number;
    pax_booked: number | null;
    billed_minor: number | null;
    received_minor: number | null;
  }
  interface LeadRow {
    tour_id: string;
    staff_id: string;
    full_name: string;
    phone: string;
  }

  function rollups(): Map<string, RollupRow> {
    return new Map((selectRollups.all() as RollupRow[]).map((row) => [row.tour_id, row]));
  }

  function leads(): Map<string, LeadRow> {
    return new Map((selectLeads.all() as LeadRow[]).map((row) => [row.tour_id, row]));
  }

  function summarise(
    row: TourRow,
    itinerary: readonly CrmItineraryDay[],
    rollup: RollupRow | undefined,
    lead: LeadRow | undefined,
  ): TourSummary {
    const billedMinor = rollup?.billed_minor ?? 0;
    const receivedMinor = rollup?.received_minor ?? 0;
    return {
      tour: toTour(row, itinerary),
      bookingCount: rollup?.booking_count ?? 0,
      paxBooked: rollup?.pax_booked ?? 0,
      billedMinor,
      receivedMinor,
      outstandingMinor: billedMinor - receivedMinor,
      leadLeader:
        lead === undefined
          ? null
          : { staffId: lead.staff_id, fullName: lead.full_name, phone: lead.phone },
    };
  }

  const counts: StoreCounts = {
    staff: fixture.staff.length,
    tours: fixture.tours.length,
    bookings: fixture.bookings.length,
    payments: fixture.payments.length,
    travellers: fixture.travellers.length,
  };

  return {
    path: DB_PATH,
    counts,

    agency(): CrmAgency {
      return toAgency(selectAgency.get() as AgencyRow);
    },

    listTours(): TourSummary[] {
      const daysByTour = new Map<string, CrmItineraryDay[]>();
      for (const row of selectAllDays.all() as ItineraryRow[]) {
        const bucket = daysByTour.get(row.tour_id);
        if (bucket === undefined) {
          daysByTour.set(row.tour_id, [toItineraryDay(row)]);
        } else {
          bucket.push(toItineraryDay(row));
        }
      }
      const rollupByTour = rollups();
      const leadByTour = leads();
      return (selectTours.all() as TourRow[]).map((row) =>
        summarise(
          row,
          daysByTour.get(row.tour_id) ?? [],
          rollupByTour.get(row.tour_id),
          leadByTour.get(row.tour_id),
        ),
      );
    },

    getTour(tourId: string): TourDetail | null {
      const row = selectTour.get(tourId) as TourRow | undefined;
      if (row === undefined) {
        return null;
      }
      const itinerary = (selectDays.all(tourId) as ItineraryRow[]).map(toItineraryDay);
      const summary = summarise(row, itinerary, rollups().get(tourId), leads().get(tourId));

      // One query, two records per row — the assignment's columns arrive under
      // `assignment_*` aliases (see selectCrew) so the staff row's identically
      // named `source_updated_at` cannot overwrite the assignment's.
      const crewRows = selectCrew.all(tourId) as (StaffRow & {
        assignment_tour_id: string;
        assignment_staff_id: string;
        assignment_duty_role: string;
        assignment_assigned_on: string;
        assignment_source_updated_at: string;
      })[];
      const crew = crewRows.map((crewRow) => ({
        assignment: toTourStaff({
          tour_id: crewRow.assignment_tour_id,
          staff_id: crewRow.assignment_staff_id,
          duty_role: crewRow.assignment_duty_role,
          assigned_on: crewRow.assignment_assigned_on,
          source_updated_at: crewRow.assignment_source_updated_at,
        }),
        staff: toStaff(crewRow),
      }));

      const paymentsByBooking = new Map<string, CrmPayment[]>();
      for (const paymentRow of selectPaymentsForTour.all(tourId) as PaymentRow[]) {
        const payment = toPayment(paymentRow);
        const bucket = paymentsByBooking.get(payment.bookingRef);
        if (bucket === undefined) {
          paymentsByBooking.set(payment.bookingRef, [payment]);
        } else {
          bucket.push(payment);
        }
      }
      const bookings = (selectBookingsForTour.all(tourId) as BookingRow[]).map((bookingRow) => {
        const booking = toBooking(bookingRow);
        return { booking, payments: paymentsByBooking.get(booking.bookingRef) ?? [] };
      });

      const travellers = (selectTravellersForTour.all(tourId) as TravellerRow[]).map(toTraveller);

      return { ...summary, crew, bookings, travellers };
    },

    listTravellers(): TravellerRecord[] {
      const rows = selectTravellerRecords.all() as (TravellerRow & {
        tour_title: string;
        tour_status: string;
        party_name: string;
      })[];
      return rows.map((row) => ({
        traveller: toTraveller(row),
        tourTitle: row.tour_title,
        tourStatus: row.tour_status as CrmTour['status'],
        partyName: row.party_name,
      }));
    },

    listStaff(): StaffRecord[] {
      const assignmentRows = selectStaffAssignments.all() as {
        staff_id: string;
        duty_role: string;
        tour_id: string;
        tour_title: string;
      }[];
      const byStaff = new Map<
        string,
        { tourId: string; tourTitle: string; dutyRole: CrmTourStaff['dutyRole'] }[]
      >();
      for (const row of assignmentRows) {
        const entry = {
          tourId: row.tour_id,
          tourTitle: row.tour_title,
          dutyRole: row.duty_role as CrmTourStaff['dutyRole'],
        };
        const bucket = byStaff.get(row.staff_id);
        if (bucket === undefined) {
          byStaff.set(row.staff_id, [entry]);
        } else {
          bucket.push(entry);
        }
      }
      return (selectStaff.all() as StaffRow[]).map((row) => ({
        staff: toStaff(row),
        assignments: byStaff.get(row.staff_id) ?? [],
      }));
    },

    snapshot(): CrmFixture {
      const daysByTour = new Map<string, CrmItineraryDay[]>();
      for (const row of selectAllDays.all() as ItineraryRow[]) {
        const bucket = daysByTour.get(row.tour_id);
        if (bucket === undefined) {
          daysByTour.set(row.tour_id, [toItineraryDay(row)]);
        } else {
          bucket.push(toItineraryDay(row));
        }
      }
      return {
        agency: toAgency(selectAgency.get() as AgencyRow),
        staff: (selectStaff.all() as StaffRow[]).map(toStaff),
        tours: (selectTours.all() as TourRow[]).map((row) =>
          toTour(row, daysByTour.get(row.tour_id) ?? []),
        ),
        tourStaff: (selectAllTourStaff.all() as TourStaffRow[]).map(toTourStaff),
        bookings: (selectBookings.all() as BookingRow[]).map(toBooking),
        payments: (selectPayments.all() as PaymentRow[]).map(toPayment),
        travellers: (selectTravellers.all() as TravellerRow[]).map(toTraveller),
      };
    },

    close(): void {
      db.close();
    },
  };
}
