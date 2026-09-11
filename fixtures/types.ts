/**
 * Sharma Travels' own domain model.
 *
 * This is a tour operator's back-office store, written the way a CRM that grew
 * up in Pune over fifteen years would write it: a *tour* is a dated departure
 * of a package, a *booking* is what a party of people bought, a *traveller* is
 * a person on a manifest, and *staff* are the people who sell trips at the desk
 * or run them on the ground.
 *
 * None of Kaafil's vocabulary appears here, and that is deliberate. Nothing in
 * this file knows what a `tripRef`, a `managerRef`, an `agencyAdmin`, an
 * `eventType` or a `sourceUpdatedAt`-bearing upsert is. Translating these rows
 * into Kaafil's shapes is a real job with real judgement calls in it, it
 * happens in exactly one place (`server/ingest.ts`), and it is the same job a
 * paying partner has to do on day one.
 *
 * Two conventions hold everywhere below:
 *
 *   Money  — an integer count of paise in a field named `*Minor`. Never a
 *            float, never rupees. ₹58,500 is 5_850_000.
 *   Time   — `sourceUpdatedAt` on every row is when the CRM last touched that
 *            record, as an ISO-8601 string with a real offset. It is fixture
 *            data with fixture timestamps; nothing derives it from the clock.
 */

/** ISO-8601 instant with an offset, e.g. `2026-08-04T11:32:00+05:30`. */
export type IsoTimestamp = string;

/** Calendar date with no time part, e.g. `2026-10-02`. A departure has a date, not a moment. */
export type IsoDate = string;

/** Integer paise. `4_650_000` is ₹46,500. */
export type Paise = number;

// ---------------------------------------------------------------------------
// The operator
// ---------------------------------------------------------------------------

export interface CrmAgency {
  /** The operator's own short code, used on every booking reference it prints. */
  agencyCode: string;
  legalName: string;
  /** What customers see on the invoice and the website. */
  brandName: string;
  gstin: string;
  headOfficeCity: string;
  headOfficeState: string;
  supportPhone: string;
  supportEmail: string;
  website: string;
  sourceUpdatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/**
 * Two kinds of people work here, and the difference is where they sit.
 *
 * A TOUR_LEADER travels with the group and is the only person who can see what
 * is actually happening on the ground. A DESK_EXECUTIVE sells, collects money
 * and handles the paperwork from the Pune office and never leaves it.
 */
export type StaffRole = 'TOUR_LEADER' | 'DESK_EXECUTIVE';

export interface CrmStaff {
  staffId: string;
  /** Printed on the ID card the leader carries, e.g. `STPL/TL/04`. */
  staffCode: string;
  fullName: string;
  role: StaffRole;
  phone: string;
  /** The CRM's fake login identity. There is no password store in this repo. */
  loginEmail: string;
  /** Where this person is actually based — leaders are hired regionally. */
  basedIn: string;
  languages: readonly string[];
  joinedOn: IsoDate;
  active: boolean;
  sourceUpdatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

/**
 * Where a dated departure is in its life.
 *
 *   CONFIRMED  — sold and going, hasn't left yet.
 *   ON_TOUR    — the group is out there right now.
 *   RETURNED   — everyone is home; accounts not yet settled.
 *   CLOSED     — settled and filed. Nothing more happens to it.
 *   CALLED_OFF — the operator pulled the departure. Refunds are owed.
 */
export type TourStatus = 'CONFIRMED' | 'ON_TOUR' | 'RETURNED' | 'CLOSED' | 'CALLED_OFF';

/**
 * How the departure is run. A trek is a different product: permits, a fitness
 * declaration, altitude, and a leader who is a certified guide rather than a
 * coordinator with a bus.
 */
export type TourStyle = 'GROUP_TOUR' | 'TREK';

/** Fixed departures go on the website with a date; customised ones are quoted per party. */
export type SellingMode = 'FIXED_DEPARTURE' | 'CUSTOMISED';

export interface CrmItineraryDay {
  dayNumber: number;
  date: IsoDate;
  title: string;
  /** Where the group sleeps that night. `null` on an overnight transit day. */
  nightHalt: string | null;
}

export interface CrmTour {
  tourId: string;
  /** The package this departure is an instance of — many departures share one code. */
  packageCode: string;
  /** What appears on the brochure. */
  title: string;
  /** Free-text, the way the sales desk describes the route to a customer. */
  destination: string;
  region: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Where the group physically assembles on day one. */
  boardingCity: string;
  meetingPoint: string;
  /** IANA zone the tour is actually run in, which is not necessarily the desk's. */
  timezone: string;
  currency: string;
  status: TourStatus;
  style: TourStyle;
  sellingMode: SellingMode;
  /** Brochure price for one person on twin-sharing. */
  pricePerSeatMinor: Paise;
  seatsTotal: number;
  seatsSold: number;
  itinerary: readonly CrmItineraryDay[];
  /** Set once the group is back and accounts have a deadline. */
  settlementDueOn?: IsoDate;
  /** Only on a CALLED_OFF departure. */
  calledOffOn?: IsoDate;
  calledOffReason?: string;
  notes?: string;
  sourceUpdatedAt: IsoTimestamp;
}

/** Which staff are rostered onto which departure, and who is in charge. */
export type DutyRole = 'LEAD_LEADER' | 'ASSISTANT_LEADER' | 'DESK_OWNER';

export interface CrmTourStaff {
  tourId: string;
  staffId: string;
  dutyRole: DutyRole;
  assignedOn: IsoDate;
  sourceUpdatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Bookings and money
// ---------------------------------------------------------------------------

export type BookingChannel = 'WALK_IN' | 'PHONE' | 'WEBSITE' | 'AGENT_REFERRAL' | 'REPEAT_CLIENT';

/**
 * Payment state, which is what the desk actually sorts its list by.
 *
 *   PART_PAID    — advance in, balance outstanding.
 *   PAID_IN_FULL — nothing owed.
 *   REFUND_DUE   — departure called off or party withdrew; money still held.
 *   REFUNDED     — settled and closed out.
 */
export type BookingStatus = 'PART_PAID' | 'PAID_IN_FULL' | 'REFUND_DUE' | 'REFUNDED';

export interface CrmBooking {
  /** The reference printed on the receipt, e.g. `STPL/26/0412`. */
  bookingRef: string;
  tourId: string;
  /** Everyone on one booking travels together and is billed together. */
  partyName: string;
  /** `travellerId` of the person the desk actually calls. */
  leadTravellerId: string;
  paxCount: number;
  channel: BookingChannel;
  status: BookingStatus;
  bookedOn: IsoDate;
  /** Gross of the party's seats, before any concession. */
  grossMinor: Paise;
  /** Group discount, early-bird, repeat-client concession. Zero is normal. */
  discountMinor: Paise;
  /** What the party owes in total: `grossMinor - discountMinor`. */
  totalMinor: Paise;
  /** Receipts less refunds. `totalMinor - receivedMinor` is the outstanding balance. */
  receivedMinor: Paise;
  /** When the balance is due. Absent once the booking is settled either way. */
  balanceDueOn?: IsoDate;
  remarks?: string;
  sourceUpdatedAt: IsoTimestamp;
}

export type PaymentMode = 'UPI' | 'NEFT' | 'CASH' | 'CARD' | 'CHEQUE';

/** `IN` is money the operator received; `OUT` is a refund it paid back. */
export type PaymentDirection = 'IN' | 'OUT';

export interface CrmPayment {
  paymentId: string;
  bookingRef: string;
  direction: PaymentDirection;
  /** Always positive. `direction` carries the sign. */
  amountMinor: Paise;
  mode: PaymentMode;
  paidOn: IsoDate;
  /** UTR, UPI reference, cheque number — whatever the mode produces. */
  reference: string;
  /** Which desk executive entered it. */
  recordedByStaffId: string;
  sourceUpdatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Travellers
// ---------------------------------------------------------------------------

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED';

/** What the kitchen needs to know. `NON_VEG` is the default on most packages. */
export type MealPreference = 'VEG' | 'JAIN' | 'NON_VEG' | 'VEGAN';

export type IdProofType = 'AADHAAR' | 'PASSPORT' | 'DRIVING_LICENCE' | 'VOTER_ID';

/** Whether this person is the one the desk talks to, or travels under someone else's booking. */
export type PartyRole = 'LEAD' | 'MEMBER';

export interface CrmTraveller {
  travellerId: string;
  tourId: string;
  bookingRef: string;
  fullName: string;
  /** E.164, which is how the CRM has stored Indian mobiles since it added WhatsApp receipts. */
  phone: string;
  email?: string;
  gender: Gender;
  dateOfBirth?: IsoDate;
  partyRole: PartyRole;
  /** How this person relates to the lead — 'Self', 'Spouse', 'Son', 'Friend'. */
  relationToLead: string;
  city: string;
  state: string;
  mealPreference: MealPreference;
  /**
   * Free text the leader must read before departure: allergies, medication,
   * a knee that cannot do stairs. `null` means the form came back blank, which
   * is not the same as "nothing to declare" and the desk treats it that way.
   */
  medicalNotes: string | null;
  idProofType?: IdProofType;
  /** Set only where the package needs one (Ladakh inner line, Spiti). */
  permitNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /** Language the desk speaks to this person in. */
  preferredLanguage: string;
  /** Cleared for the trek: medical form signed and fitness declared. */
  fitnessCleared?: boolean;
  sourceUpdatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// The whole seed
// ---------------------------------------------------------------------------

/**
 * Everything `server/db.ts` writes into crm.sqlite on boot. `fixtures/core.ts`
 * exports one of these by hand; `fixtures/bulk.ts` generates a much larger one
 * of the same shape.
 */
export interface CrmFixture {
  agency: CrmAgency;
  staff: readonly CrmStaff[];
  tours: readonly CrmTour[];
  tourStaff: readonly CrmTourStaff[];
  bookings: readonly CrmBooking[];
  payments: readonly CrmPayment[];
  travellers: readonly CrmTraveller[];
}
