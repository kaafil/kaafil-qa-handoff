/**
 * The CRM → Kaafil push.
 *
 * Sharma Travels' book of business lives in `crm.sqlite`, in Sharma Travels'
 * own vocabulary: tours, bookings, staff, parties. Kaafil knows none of those
 * words. This file is the translation layer — the one place in the repo where
 * a tour becomes a trip, a tour leader becomes a manager, a desk executive
 * becomes an agency admin, and a party of travellers becomes a manifest.
 *
 * It runs once, on boot, before the CRM starts serving. That mirrors how a
 * real partner integrates: the CRM stays the system of record and replays what
 * it knows into Kaafil, rather than Kaafil becoming a second place where trips
 * are authored.
 *
 * ── THE ORDER IS NOT A STYLE CHOICE ────────────────────────────────────────
 *
 *   1  agencies.upsert                the agency every other row hangs off
 *   2  trips.managers.upsert          manager entities (NOT trip-scoped)
 *   3  agencyAdmins.upsert            desk staff
 *   4  trips.upsert                   the trips themselves
 *   5  trips.travellers.pushManifest  the roster on each trip
 *   6  trips.managers.assign          staff onto trips
 *   7  journey.waitUntilReady         the trip becomes workable
 *
 * Each step resolves references the next one needs. A manifest push names a
 * trip that has to exist; an assign names both a trip and a manager that have
 * to exist. Running these out of order does not half-work, it 404s.
 *
 * ── sourceUpdatedAt ────────────────────────────────────────────────────────
 *
 * Every upsert carries the CRM row's OWN `sourceUpdatedAt` — the instant the
 * CRM last touched that record — never the clock at call time. Kaafil orders
 * concurrent and out-of-order writes by last-writer-wins on this stamp. Stamp
 * everything `new Date()` and every push looks like the newest truth, the
 * staleness check silently stops rejecting anything, and a replayed or delayed
 * message overwrites good data with old data. Seed data is exactly where that
 * mistake looks harmless, which is why it is worth being pedantic about here.
 *
 * A consequence worth knowing before it surprises you: restart the server and
 * the second ingest pushes the identical stamps, so Kaafil answers `200` with
 * `verdict: 'ignored_stale'` rather than rewriting rows. That is the check
 * working, not a failure — this file says so out loud when it happens.
 *
 * ── AN INVARIANT THE COMPILER NO LONGER HOLDS FOR US ───────────────────────
 *
 * `sourceUpdatedAt` used to be required on every upsert, so dropping one was a
 * type error. As of `kaafil-js@0.5.0` it is OPTIONAL on manifest entries (and
 * on `vendors.upsert`) — omit it and the SERVER stamps its own clock, which is
 * precisely the "every push looks like the newest truth" failure above. So the
 * manifest push below still passes it deliberately, and deleting that line
 * would now typecheck cleanly while silently defeating the staleness check.
 * The rule is ours to hold now, not the compiler's.
 *
 * ── THE SANDBOX TRIP CAP ───────────────────────────────────────────────────
 *
 * A TEST-plane tenant holds at most FIVE trips; the sixth `trips.upsert` that
 * CREATES a trip is refused with `TEST_TRIP_LIMIT`. This fixture has six
 * departures, and `pnpm reset:kaafil` plants one fixture trip of Kaafil's own
 * first — so after a reset there are four free slots, not five.
 *
 * That is a real product limit, not a bug to route around, so the ingest does
 * the one thing it can: it pushes in SCENARIO-CRITICALITY order (see
 * `INGEST_PRIORITY`), so the departures the exercise actually names survive
 * the cap and the least load-bearing ones are the ones refused. The refusal is
 * collected like any other failure and explained at the end of the run.
 */

import { isKaafilError, type Kaafil } from 'kaafil-js';
import type {
  CrmFixture,
  CrmStaff,
  CrmTour,
  CrmTraveller,
  Gender,
  IsoDate,
  MealPreference,
  TourStatus,
} from '../fixtures/types';

// ---------------------------------------------------------------------------
// What the caller passes in and gets back
// ---------------------------------------------------------------------------

export interface IngestOptions {
  /** The seed that was just written into `crm.sqlite`. */
  readonly fixture: CrmFixture;
  /**
   * `KAAFIL_AGENCY_REF` — your own id for the agency. Kaafil stores it as the
   * agency's external reference and you address the agency by it forever
   * after, so every manager, admin and trip below names this same string.
   */
  readonly agencyRef: string;
  /**
   * How long to wait for one trip's journey to be built before giving up and
   * moving to the next. The SDK's own default is ~60s; boot shortens it so a
   * slow or unhappy worker delays the CRM by seconds rather than minutes.
   */
  readonly journeyTimeoutMs?: number;
  /** Where narration goes. Swappable so a test can capture it. */
  readonly log?: (line: string) => void;
}

/** One push that did not land. Collected, never thrown — see `runIngest`. */
export interface IngestFailure {
  /** Which of the seven steps, in this file's own words. */
  readonly step: string;
  /** The CRM row it was about, e.g. `TR-2609-SPITI` or `ST-03`. */
  readonly subject: string;
  /** Kaafil's error code, or the error kind when the server never answered. */
  readonly code: string;
  /** Quote this to Kaafil support; it identifies the exact request. */
  readonly requestId: string | undefined;
  readonly message: string;
}

export interface IngestResult {
  readonly agencyRef: string;
  /** `externalManagerId`s that reached Kaafil — what `/session` mints against. */
  readonly managerRefs: readonly string[];
  /** `externalAgencyAdminId`s that reached Kaafil. */
  readonly agencyAdminRefs: readonly string[];
  /** `externalTripId`s that reached Kaafil. */
  readonly tripRefs: readonly string[];
  /** The subset whose journey is built — the only trips that are workable. */
  readonly readyTripRefs: readonly string[];
  readonly travellersPushed: number;
  readonly failures: readonly IngestFailure[];
}

// ---------------------------------------------------------------------------
// Translating Sharma Travels' vocabulary into Kaafil's
//
// Type-keyed records rather than switch chains: adding a CRM status later is
// then a compile error here instead of a value that silently falls through.
// ---------------------------------------------------------------------------

/**
 * The CRM tracks a departure through five states; Kaafil tracks a trip through
 * five different ones, and they are not the same five.
 *
 * `RETURNED` and `CLOSED` both collapse to `COMPLETED` — Kaafil has no notion
 * of "home but the accounts are still open", because settlement is the CRM's
 * job and stays there. The distinction survives in the CRM's own screens.
 */
const TRIP_STATUS: Record<TourStatus, 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'> = {
  CONFIRMED: 'CONFIRMED',
  ON_TOUR: 'IN_PROGRESS',
  RETURNED: 'COMPLETED',
  CLOSED: 'COMPLETED',
  CALLED_OFF: 'CANCELLED',
};

/** What the kitchen note looks like once it is text a manager can read. */
const DIETARY: Record<MealPreference, string | null> = {
  VEG: 'Vegetarian',
  JAIN: 'Jain — no root vegetables',
  // The house default on every package. Sending it as a "requirement" would
  // fill the manager's meal list with rows that say nothing.
  NON_VEG: null,
  VEGAN: 'Vegan',
};

/**
 * Kaafil's `gender` is a four-value enum and the CRM's is a different four.
 * `UNDISCLOSED` is the interesting one: the person was asked and declined,
 * which Kaafil represents as `UNKNOWN` because it draws the line at "we do not
 * have a value" rather than at why.
 */
const GENDER: Record<Gender, 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN'> = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  UNDISCLOSED: 'UNKNOWN',
};

/**
 * The CRM stores the language the desk speaks to someone in as a plain English
 * word, because that is what a Pune sales desk types. Kaafil wants a locale
 * tag, since it picks message templates with it.
 */
const LOCALE: Record<string, string> = {
  Assamese: 'as-IN',
  Bengali: 'bn-IN',
  English: 'en-IN',
  Gujarati: 'gu-IN',
  Hindi: 'hi-IN',
  Kannada: 'kn-IN',
  Malayalam: 'ml-IN',
  Marathi: 'mr-IN',
  Punjabi: 'pa-IN',
  Tamil: 'ta-IN',
  Telugu: 'te-IN',
  Urdu: 'ur-IN',
};

/**
 * The CRM stores a departure's start and end as calendar dates, because a
 * departure has a date and not a moment. Kaafil's `startDate`/`endDate` are
 * full instants, so the date has to be anchored somewhere — and the right
 * somewhere is the tour's OWN timezone, not the desk's and not UTC. Hand a
 * bare `2026-10-02` to a date parser and you get UTC midnight, which is the
 * previous evening in Leh; the trip then shows up a day early to everyone
 * looking at it.
 *
 * `new Date()` here is a constructor over fixture data, not a clock read —
 * nothing in this file derives a `sourceUpdatedAt` from the current time.
 */
function zonedInstant(date: IsoDate, timeZone: string, clockTime: '00:00:00' | '23:59:59'): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(probe);
  // Intl spells the offset `GMT+05:30`, or a bare `GMT` at zero offset.
  const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = label.slice(3) === '' ? '+00:00' : label.slice(3);
  return `${date}T${clockTime}${offset}`;
}

// ---------------------------------------------------------------------------
// Trip ingest order — see "THE SANDBOX TRIP CAP" in this file's header
// ---------------------------------------------------------------------------

/**
 * Which departures matter most, when the sandbox cap means not all six land.
 *
 * Deliberately declared HERE and not by reordering `fixtures/core.ts`: that
 * array is Sharma Travels' own book of business and the CRM's screens read it,
 * so reordering it would change what a human sees in the trip list for a
 * reason that has nothing to do with the CRM. The constraint is Kaafil's, so
 * the ordering lives next to the Kaafil call.
 *
 * The ranking is by what the exercise NAMES BY REF, not by what looks
 * interesting:
 *
 *   SPITI      milestones 6 and 10 — the only mid-tour departure, and the one
 *              the offline test is written against.
 *   MEGHALAYA  milestone 7 and §4 — the cancelled trip. Also the regression
 *              guard for the worst finding of the last QA round, when it read
 *              "Upcoming · Starts in 5 days".
 *   KERALA     milestone 7 and all of §5 — the closed-out trip, so the only
 *              way to exercise the 423 lock.
 *   LADAKH     milestone 5's desk manifest; the clean pre-departure case.
 *   RISHIKESH  §7's money checks. Lands on a fresh sandbox, not a reset one.
 *   HAMPTA     the deliberate sacrifice — a trek with walk-ins, named by no
 *              milestone.
 *
 * Anything absent from this list sorts last, in fixture order, so adding a
 * departure to the fixtures never silently displaces a ranked one.
 */
const INGEST_PRIORITY: readonly string[] = [
  'TR-2609-SPITI',
  'TR-2609-MEGHALAYA',
  'TR-2608-KERALA',
  'TR-2610-LADAKH',
  'TR-2610-RISHIKESH',
  'TR-2609-HAMPTA',
];

function orderedTours(tours: readonly CrmTour[]): CrmTour[] {
  const rank = (tour: CrmTour): number => {
    const at = INGEST_PRIORITY.indexOf(tour.tourId);
    return at === -1 ? INGEST_PRIORITY.length : at;
  };
  // A stable sort, so unranked departures keep their fixture order.
  return [...tours].sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------------------
// Failure collection
// ---------------------------------------------------------------------------

function toFailure(step: string, subject: string, error: unknown): IngestFailure {
  // `isKaafilError` is the SDK's own shape check, and it survives the case
  // where two copies of kaafil-js end up in one dependency tree — which
  // `error instanceof KaafilError` would not.
  if (isKaafilError(error)) {
    return {
      step,
      subject,
      // A transport failure (timeout, DNS, connection refused) has no catalog
      // code, because no server ever answered to supply one.
      code: error.code ?? `no response (${error.kind})`,
      requestId: error.requestId,
      message: error.message,
    };
  }
  return {
    step,
    subject,
    code: 'not a Kaafil error',
    requestId: undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

// ---------------------------------------------------------------------------
// The push
// ---------------------------------------------------------------------------

/**
 * Pushes the whole seeded CRM into the tenant behind `kaafil`.
 *
 * Resilient on purpose: one trip that Kaafil refuses does not abort the other
 * five. Every refusal is collected and printed in a summary at the end with
 * its error code and `requestId`, because a boot that dies on the first `422`
 * tells you about one problem when there might be three.
 *
 * Never throws for a rejected push. It can still throw if the CRM hands it
 * something structurally impossible, which is a bug in this repo, not in the
 * QA's key or tenant.
 */
export async function runIngest(kaafil: Kaafil, options: IngestOptions): Promise<IngestResult> {
  const { fixture, agencyRef } = options;
  const say = options.log ?? ((line: string) => console.log(line));
  const journeyTimeoutMs = options.journeyTimeoutMs ?? 30_000;
  const failures: IngestFailure[] = [];

  const log = (line: string) => say(`[ingest] ${line}`);

  log(
    `Pushing Sharma Travels' book of business into your Kaafil tenant. Seven steps, in a ` +
      `fixed order, because each one resolves a reference the next one needs.`,
  );

  // -- 1 ---------------------------------------------------------------------
  // Everything else names this agency by YOUR id for it. Getting it in first
  // is what makes `externalAgencyId` resolvable on the three steps below.

  log(
    `1/7 Agency. Registering "${fixture.agency.brandName}" under your own reference ` +
      `"${agencyRef}" — every manager, admin and trip below is addressed against it.`,
  );
  try {
    const agency = await kaafil.agencies.upsert({
      agencyRef,
      name: fixture.agency.brandName,
      // The CRM's own last-touched instant for this row. Not the clock.
      sourceUpdatedAt: fixture.agency.sourceUpdatedAt,
    });
    if (agency.verdict === 'ignored_stale') {
      log(
        `    Kaafil already holds an agency row stamped at or after ` +
          `${fixture.agency.sourceUpdatedAt}, so it ignored this push as stale and kept what ` +
          `it had. That is last-writer-wins working — you have booted before.`,
      );
    } else {
      log(`    ${agency.created ? 'Created' : 'Re-synced'} agency "${agency.name}".`);
    }
  } catch (error) {
    failures.push(toFailure('agencies.upsert', agencyRef, error));
    log(
      `    The agency push failed. Nothing below it can resolve an agency, so the rest of the ` +
        `ingest will fail too — see the summary at the end for the code and requestId.`,
    );
  }

  // -- 2 ---------------------------------------------------------------------
  // The tour leaders. These live under `trips.managers` in the SDK but they
  // are NOT trip-scoped: this creates the person, and step 6 puts them on a
  // trip. A manager is who the field surface signs in as.

  const leaders = fixture.staff.filter((person) => person.role === 'TOUR_LEADER');
  const managerRefs: string[] = [];

  log(
    `2/7 Managers. Creating ${leaders.length} tour leaders as manager identities. These are ` +
      `people, not roster rows — putting them on a trip is step 6.`,
  );
  for (const leader of leaders) {
    try {
      await kaafil.trips.managers.upsert({
        externalAgencyId: agencyRef,
        externalManagerId: leader.staffId,
        fullName: leader.fullName,
        phone: leader.phone,
        sourceUpdatedAt: leader.sourceUpdatedAt,
      });
      managerRefs.push(leader.staffId);
    } catch (error) {
      failures.push(toFailure('trips.managers.upsert', leader.staffId, error));
    }
  }
  log(`    ${managerRefs.length} of ${leaders.length} managers are in Kaafil.`);

  // -- 3 ---------------------------------------------------------------------
  // The desk. An agency admin sees every trip in the agency from an office; a
  // manager sees the trips they are rostered onto, from the field. Same
  // capabilities, different vantage point — which is why they are separate
  // identities rather than one person with a flag.

  const deskStaff = fixture.staff.filter((person) => person.role === 'DESK_EXECUTIVE');
  const agencyAdminRefs: string[] = [];

  log(
    `3/7 Desk staff. Creating ${deskStaff.length} agency admins — the office-side identity ` +
      `that sees the whole agency, as against a manager who sees their own trips.`,
  );
  for (const executive of deskStaff) {
    try {
      await kaafil.agencyAdmins.upsert({
        externalAgencyId: agencyRef,
        externalAgencyAdminId: executive.staffId,
        fullName: executive.fullName,
        phone: executive.phone,
        sourceUpdatedAt: executive.sourceUpdatedAt,
      });
      agencyAdminRefs.push(executive.staffId);
    } catch (error) {
      failures.push(toFailure('agencyAdmins.upsert', executive.staffId, error));
    }
  }
  log(`    ${agencyAdminRefs.length} of ${deskStaff.length} agency admins are in Kaafil.`);

  // -- 4, 5, 6 ---------------------------------------------------------------
  // Per trip, because a manifest and an assign both need a trip that already
  // resolves. A trip that fails at step 4 skips its own 5 and 6 and leaves the
  // other five departures alone.

  const tripRefs: string[] = [];
  const pushedTours: CrmTour[] = [];
  let travellersPushed = 0;

  log(
    `4/7 Trips. Pushing ${fixture.tours.length} departures. Note the verb: creating a trip in ` +
      `Kaafil is an upsert on YOUR id for it, so re-pushing is how you send a change.`,
  );
  for (const tour of orderedTours(fixture.tours)) {
    try {
      await kaafil.trips.upsert({
        // Your id for the departure. It is the trip's identity from here on:
        // every later call can address the trip by this string.
        externalTripId: tour.tourId,
        externalAgencyId: agencyRef,
        // The departure's own reference, not `packageCode` — many dated
        // departures share one package code, so it does not identify this one.
        code: tour.tourId,
        name: tour.title,
        startDate: zonedInstant(tour.startDate, tour.timezone, '00:00:00'),
        endDate: zonedInstant(tour.endDate, tour.timezone, '23:59:59'),
        sourceUpdatedAt: tour.sourceUpdatedAt,
        // A trek is a different product with permits, altitude and a fitness
        // declaration; Kaafil's trek surfaces only appear when it is told so.
        eventType: tour.style === 'TREK' ? 'TREK' : 'TRIP',
        // A customised departure is quoted per party and has no shared
        // manifest, which is what PERSONALIZED means on Kaafil's side.
        tripMode: tour.sellingMode === 'CUSTOMISED' ? 'PERSONALIZED' : 'GROUP',
        status: TRIP_STATUS[tour.status],
        // The tour's own zone. A Ladakh departure sold from Pune is still run
        // on Ladakh time, and the desk's zone is nobody's business here.
        timezone: tour.timezone,
        currency: tour.currency,
      });
      tripRefs.push(tour.tourId);
      pushedTours.push(tour);
    } catch (error) {
      failures.push(toFailure('trips.upsert', tour.tourId, error));
      log(`    ${tour.tourId} was refused; skipping its manifest and roster.`);
    }
  }
  log(`    ${tripRefs.length} of ${fixture.tours.length} trips are in Kaafil.`);

  // -- 5 ---------------------------------------------------------------------

  log(
    `5/7 Manifests. Pushing each trip's roster in 'replace' mode: the CRM is the system of ` +
      `record for who is travelling, so anyone not in the push is taken off the manifest.`,
  );
  for (const tour of pushedTours) {
    const onboard = fixture.travellers.filter(
      (traveller: CrmTraveller) => traveller.tourId === tour.tourId,
    );
    if (onboard.length === 0) {
      continue;
    }
    try {
      const manifest = await kaafil.trips.travellers.pushManifest({
        tripRef: tour.tourId,
        mode: 'replace',
        travellers: onboard.map((traveller) => ({
          externalTravellerId: traveller.travellerId,
          // This traveller's own last-touched instant — each row carries its
          // own, so one edited yesterday does not drag the rest forward.
          sourceUpdatedAt: traveller.sourceUpdatedAt,
          fullName: traveller.fullName,
          phone: traveller.phone,
          email: traveller.email ?? null,
          gender: GENDER[traveller.gender],
          dietary: DIETARY[traveller.mealPreference],
          // A flag, not the text. The CRM's `medicalNotes` are free text a
          // leader reads in the CRM; Kaafil is told only that there is
          // something to read, which keeps the detail out of a share link.
          medicalFlag: traveller.medicalNotes !== null,
          locale: LOCALE[traveller.preferredLanguage] ?? null,
        })),
      });
      travellersPushed += manifest.items.length;
      const stale = manifest.items.filter((item) => item.verdict === 'ignored_stale').length;
      log(
        `    ${tour.tourId}: ${manifest.manifestCount} travellers on the manifest` +
          (stale > 0 ? ` (${stale} already current, so ignored as stale)` : '') +
          '.',
      );
    } catch (error) {
      failures.push(toFailure('trips.travellers.pushManifest', tour.tourId, error));
    }
  }

  // -- 6 ---------------------------------------------------------------------
  // Only tour leaders are assignable. A DESK_OWNER duty row points at a desk
  // executive, who went to Kaafil as an agency admin in step 3 and has no
  // manager identity to resolve — assigning one would 404 for a good reason.

  const staffById = new Map<string, CrmStaff>(
    fixture.staff.map((person) => [person.staffId, person]),
  );
  const rosterRows = fixture.tourStaff.filter(
    (row) => staffById.get(row.staffId)?.role === 'TOUR_LEADER' && tripRefs.includes(row.tourId),
  );
  let assigned = 0;

  log(
    `6/7 Rostering. Putting ${rosterRows.length} tour leaders onto their trips. Desk staff are ` +
      `skipped — an agency admin already sees every trip, so there is nothing to assign.`,
  );
  for (const row of rosterRows) {
    try {
      await kaafil.trips.managers.assign({
        tripRef: row.tourId,
        managerRef: row.staffId,
        // At most one lead per trip; promoting a new one demotes the old one.
        isLead: row.dutyRole === 'LEAD_LEADER',
        role: 'MANAGER',
        // Optional on this one call, because a desk operator assigning by hand
        // has no CRM stamp to send. A CRM does, so a CRM sends it.
        sourceUpdatedAt: row.sourceUpdatedAt,
      });
      assigned += 1;
    } catch (error) {
      failures.push(toFailure('trips.managers.assign', `${row.tourId}/${row.staffId}`, error));
    }
  }
  log(`    ${assigned} of ${rosterRows.length} rostering rows applied.`);

  // -- 7 ---------------------------------------------------------------------
  // A trip exists the moment step 4 returns, but it is not WORKABLE yet:
  // Kaafil builds its journey — the itinerary, checklists and scheduled steps
  // the manager and desk surfaces actually render — in a background worker. A
  // UI opened before that lands shows an empty console, and the QA needs to
  // know that is why, rather than assuming their integration is broken.

  const waitable = pushedTours.filter((tour) => tour.status !== 'CALLED_OFF');
  const skipped = pushedTours.length - waitable.length;
  const readyTripRefs: string[] = [];

  log(
    `7/7 Journeys. Waiting for Kaafil to build each trip's journey. Until this lands a trip is ` +
      `not workable: the surfaces render, but with nothing in them.` +
      (skipped > 0
        ? ` ${skipped} called-off departure skipped — a cancelled trip never gets a journey, so ` +
          `waiting would only burn the timeout.`
        : ''),
  );
  for (const tour of waitable) {
    try {
      const journey = await kaafil.journey.waitUntilReady({
        tripRef: tour.tourId,
        timeoutMs: journeyTimeoutMs,
      });
      readyTripRefs.push(tour.tourId);
      log(`    ${tour.tourId}: journey ${journey.status.toLowerCase()}, ${journey.currentPhase}.`);
    } catch (error) {
      failures.push(toFailure('journey.waitUntilReady', tour.tourId, error));
      log(
        `    ${tour.tourId}: no journey after ${Math.round(journeyTimeoutMs / 1000)}s. The trip ` +
          `is in Kaafil and the CRM will show it, but the Kaafil surfaces for it will look ` +
          `empty until the build finishes. It may well land on its own in a moment.`,
      );
    }
  }

  // -- The summary -----------------------------------------------------------

  if (failures.length === 0) {
    log(
      `Done. ${tripRefs.length} trips, ${travellersPushed} travellers, ${managerRefs.length} ` +
        `managers and ${agencyAdminRefs.length} agency admins are in your tenant, and ` +
        `${readyTripRefs.length} trips are workable.`,
    );
  } else {
    log(
      `Done, with ${failures.length} push${failures.length === 1 ? '' : 'es'} that did not ` +
        `land. Everything else went through — one refusal is not allowed to abort the rest, ` +
        `because a boot that dies on the first one hides the other two.`,
    );
    for (const failure of failures) {
      log(
        `    ${failure.step} · ${failure.subject} · ${failure.code}` +
          `${failure.requestId === undefined ? '' : ` · requestId ${failure.requestId}`}`,
      );
      log(`        ${failure.message}`);
    }
    // The one refusal that is EXPECTED rather than a fault, and which reads
    // like a bug if nobody says so: the sandbox's five-trip cap. Left as a
    // bare code it looks like a broken seed, and the QA goes hunting.
    if (failures.some((failure) => failure.code === 'TEST_TRIP_LIMIT')) {
      const refused = failures
        .filter((failure) => failure.code === 'TEST_TRIP_LIMIT')
        .map((failure) => failure.subject);
      log('');
      log(
        `    ^ TEST_TRIP_LIMIT is the sandbox's own ceiling, not a broken seed. A kf_test_ ` +
          `tenant holds FIVE trips; this fixture has six, and pnpm reset:kaafil plants one ` +
          `fixture trip of Kaafil's own first, which leaves four. Refused here: ` +
          `${refused.join(', ')}.`,
      );
      log(
        `    Trips are pushed most-important-first, so the departures the milestones name ` +
          `land ahead of the ones they do not. Everything you need for milestones 5, 6, 7 ` +
          `and 10 is in your tenant. What you lose is noted in docs/01-the-exercise.md.`,
      );
      log(
        `    A kf_live_ key has no such cap, and is the only way to run pnpm seed:bulk — ` +
          `see the Volume bullet in docs/02-what-to-look-for.md §7.`,
      );
      log('');
    }
    log(
      `Quote a requestId if you raise one of these with Kaafil. Fix the cause and restart the ` +
        `server to replay: the whole ingest is idempotent, and rows that already landed come ` +
        `back as ignored_stale rather than being written twice.`,
    );
  }

  return {
    agencyRef,
    managerRefs,
    agencyAdminRefs,
    tripRefs,
    readyTripRefs,
    travellersPushed,
    failures,
  };
}
