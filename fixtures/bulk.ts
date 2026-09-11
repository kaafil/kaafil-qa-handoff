/**
 * Volume, on top of the six hand-written departures.
 *
 * `pnpm seed:bulk` generates fifty more departures and roughly five hundred
 * more travellers and writes the whole thing — core rows included — to
 * `fixtures/bulk.generated.json`. The next `pnpm dev` seeds crm.sqlite from
 * that file instead of the core fixture, so the CRM's lists, its pagination,
 * its search box and every Kaafil surface you hang off it are working against
 * a book of business big enough to hurt. Delete the file to go back to six.
 *
 * Two properties this file is built around.
 *
 * **It extends the core fixture, it does not replace it.** All six hand-written
 * departures survive verbatim, with their ids, their travellers and their
 * money. TR-2609-SPITI is still on day four, TR-2608-KERALA is still waiting on
 * a houseboat invoice, TR-2609-MEGHALAYA is still called off. Every scenario
 * you were told to look for is still findable by name, just further down a
 * longer list. Generated rows sit in id bands core never uses — `TV-1xxxx`
 * travellers, `STPL/<yy>/1xxx` bookings, `RC-1xxxx` receipts, tour ids with a
 * trailing departure number — so you can always tell which is which.
 *
 * **It is deterministic.** Every value below comes out of a mulberry32 PRNG
 * with a frozen seed. Two QAs who run `pnpm seed:bulk` get byte-identical
 * files, which means a bug report can say "STPL/26/1187 renders wrong" and
 * mean something to the person reading it. There is no `Math.random` here and
 * there is no clock: `TODAY` is a constant, and every date in the output is
 * integer day arithmetic from it. Changing `DEFAULT_SEED` invalidates every
 * bug report ever filed against the old data, so it does not get changed
 * casually.
 *
 * Same conventions as `core.ts`: money is integer paise in a `*Minor` field,
 * and every row carries its own `sourceUpdatedAt` — no two alike, none of them
 * read off the wall clock. The engine compares that value against what it
 * already holds to reject an out-of-order write, and five hundred rows all
 * stamped "now" would disable the check across the entire dataset at once.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE_FIXTURE } from './core.ts';
import type {
  BookingChannel,
  BookingStatus,
  CrmBooking,
  CrmFixture,
  CrmItineraryDay,
  CrmPayment,
  CrmStaff,
  CrmTour,
  CrmTourStaff,
  CrmTraveller,
  Gender,
  IdProofType,
  IsoDate,
  IsoTimestamp,
  MealPreference,
  Paise,
  PaymentMode,
  TourStatus,
} from './types.ts';

/**
 * The fixture's "today". Core describes a Friday in September 2026 and its
 * newest row is stamped the 10th; everything generated here lives in the same
 * week so the two halves read as one book of business. It is a constant and
 * not `new Date()` on purpose — a fixture that moves with the clock produces a
 * different dataset every morning and nobody can reproduce yesterday's bug.
 */
const TODAY: IsoDate = '2026-09-11';

/** Frozen. See the header: changing it invalidates every filed bug report. */
const DEFAULT_SEED = 20_260_911;

/** How many departures to generate on top of the six core ones. */
const DEPARTURE_COUNT = 50;

/** Where `pnpm seed:bulk` writes, and where `pnpm dev` looks for it. */
export const BULK_FIXTURE_PATH = new URL('./bulk.generated.json', import.meta.url);

// ---------------------------------------------------------------------------
// Randomness — seeded, never ambient
// ---------------------------------------------------------------------------

type Rng = () => number;

/**
 * mulberry32. Thirty-two bits of state, a period long enough for the few
 * thousand draws below, and — the only property that actually matters here —
 * identical output for identical input on every machine and every Node
 * version, which `Math.random` does not promise.
 */
function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Inclusive at both ends. */
function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, pool: readonly T[]): T {
  const chosen = pool[Math.floor(rng() * pool.length)];
  // Every pool in this file is a non-empty literal. The guard is here to
  // satisfy noUncheckedIndexedAccess, not because it can realistically fire.
  if (chosen === undefined) {
    throw new Error('pick() was handed an empty pool');
  }
  return chosen;
}

/** `true` with the given probability. Reads better than `rng() < 0.3` inline. */
function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Picks from a pool where earlier entries repeat, e.g. party sizes. */
function weighted<T>(rng: Rng, pool: readonly (readonly [T, number])[]): T {
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rng() * total;
  for (const [value, weight] of pool) {
    cursor -= weight;
    if (cursor <= 0) {
      return value;
    }
  }
  const last = pool[pool.length - 1];
  if (last === undefined) {
    throw new Error('weighted() was handed an empty pool');
  }
  return last[0];
}

// ---------------------------------------------------------------------------
// Dates — integer arithmetic on literal strings, no clock anywhere
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toDayNumber(date: IsoDate): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function fromDayNumber(day: number): IsoDate {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** ISO dates sort lexicographically, which is the whole reason for the format. */
function earliest(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

function latest(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Operators quote round hundreds of rupees. 100 rupees is 10,000 paise. */
function roundToHundredRupees(paise: number): Paise {
  return Math.round(paise / 10_000) * 10_000;
}

// ---------------------------------------------------------------------------
// The generator's own scratch state
// ---------------------------------------------------------------------------

interface Context {
  rng: Rng;
  /** Allocates a `sourceUpdatedAt` on a given day that nothing else holds. */
  stamp: (onDate: IsoDate) => IsoTimestamp;
  /** Allocates a mobile number nothing else in the fixture holds. */
  phone: () => string;
  nextBookingSequence: () => number;
  nextPaymentSequence: () => number;
  nextTravellerSequence: () => number;
}

function createContext(seed: number): Context {
  const rng = createRng(seed);

  // Seeded with the core fixture's own values so a generated row can never
  // shadow a hand-written one on either axis.
  const usedStamps = new Set<IsoTimestamp>();
  const usedPhones = new Set<string>();
  for (const row of [
    CORE_FIXTURE.agency,
    ...CORE_FIXTURE.staff,
    ...CORE_FIXTURE.tours,
    ...CORE_FIXTURE.tourStaff,
    ...CORE_FIXTURE.bookings,
    ...CORE_FIXTURE.payments,
    ...CORE_FIXTURE.travellers,
  ]) {
    usedStamps.add(row.sourceUpdatedAt);
  }
  for (const person of [...CORE_FIXTURE.staff, ...CORE_FIXTURE.travellers]) {
    usedPhones.add(person.phone);
  }

  /** Desk hours. Nothing at Sharma Travels is keyed in at 3am. */
  const FIRST_MINUTE = 9 * 60;
  const LAST_MINUTE = 20 * 60 + 59;

  function stamp(onDate: IsoDate): IsoTimestamp {
    // Nothing is edited in the future; a departure three months out was still
    // last touched this week.
    const day = earliest(onDate, TODAY);
    let minute = int(rng, FIRST_MINUTE, LAST_MINUTE);
    for (let attempt = 0; attempt <= LAST_MINUTE - FIRST_MINUTE; attempt += 1) {
      const candidate = `${day}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00+05:30`;
      if (!usedStamps.has(candidate)) {
        usedStamps.add(candidate);
        return candidate;
      }
      minute = minute >= LAST_MINUTE ? FIRST_MINUTE : minute + 1;
    }
    // Every business minute on that day is taken. Spill backwards rather than
    // emit a duplicate — a duplicate is the one thing this allocator exists to
    // prevent.
    return stamp(addDays(day, -1));
  }

  function phone(): string {
    for (;;) {
      let digits = String(pick(rng, [6, 7, 8, 9] as const));
      for (let i = 0; i < 9; i += 1) {
        digits += String(int(rng, 0, 9));
      }
      const candidate = `+91${digits}`;
      if (!usedPhones.has(candidate)) {
        usedPhones.add(candidate);
        return candidate;
      }
    }
  }

  let bookingSequence = 1000;
  let paymentSequence = 10_000;
  let travellerSequence = 10_000;

  return {
    rng,
    stamp,
    phone,
    nextBookingSequence: () => (bookingSequence += 1),
    nextPaymentSequence: () => (paymentSequence += 1),
    nextTravellerSequence: () => (travellerSequence += 1),
  };
}

// ---------------------------------------------------------------------------
// The catalogue
//
// Twenty packages the operator actually sells, each with a real day-by-day
// plan. A departure is one dated instance of a package, so the same template
// appears several times below with different dates, different pricing and a
// different leader — which is exactly how a tour operator's tour list looks
// and exactly the thing that makes a list view hard to scan.
// ---------------------------------------------------------------------------

interface PackageTemplate {
  packageCode: string;
  title: string;
  destination: string;
  region: string;
  boardingCity: string;
  meetingPoint: string;
  /** The tour's own zone, which for the three foreign packages is not Pune's. */
  timezone: string;
  /** Twin-sharing brochure price, before the per-departure variation. */
  basePriceMinor: Paise;
  trek: boolean;
  /** Sold abroad, so the manifest wants passports rather than Aadhaar. */
  international: boolean;
  /** Inner-line or protected-area permit, filed by the desk before departure. */
  permitRequired: boolean;
  /** `[title, night halt]` per day. The last day's halt is always `null`. */
  days: readonly (readonly [string, string | null])[];
}

/**
 * The operator's selling calendar — which months each package actually runs in,
 * as month numbers.
 *
 * This exists because a date ladder that ignored it would put the Brahmatal
 * *winter* trek in July, sell Valley of Flowers in December and run Rann of
 * Kutch in the monsoon. Nobody's tour list looks like that, and a reviewer who
 * knows the routes would spot it in the first screenful. The generator picks
 * the package to fit the date rather than the other way round, which also
 * reproduces the real shape of a tour list: the same four or five products
 * repeating through their season, not twenty products evenly spread.
 */
const SELLING_MONTHS: Readonly<Record<string, readonly number[]>> = {
  'GOA-5D': [10, 11, 12, 1, 2, 3],
  'RJS-8D': [10, 11, 12, 1, 2, 3],
  'AND-6D': [10, 11, 12, 1, 2, 3, 4, 5],
  'SIK-7D': [3, 4, 5, 6, 9, 10, 11, 12],
  'VAR-4D': [10, 11, 12, 1, 2, 3],
  'KAR-6D': [9, 10, 11, 12, 1, 2, 3],
  // The white desert is only white, and only bearable, between November and
  // February. The Rann Utsav dates are the operator's whole season here.
  'GUJ-7D': [11, 12, 1, 2],
  'APC-6D': [10, 11, 12, 1, 2, 3],
  'KSH-6D': [3, 4, 5, 6, 7, 8, 9, 10],
  'NEP-8D': [3, 4, 5, 9, 10, 11],
  'BHU-7D': [3, 4, 5, 9, 10, 11],
  'SRI-8D': [12, 1, 2, 3, 4, 7, 8],
  // Both temples are shut through the winter; the portals decide this one.
  'DDM-9D': [5, 6, 9, 10],
  'VOF-5D': [7, 8, 9],
  'KGL-7D': [7, 8, 9],
  'SND-5D': [3, 4, 5, 10, 11, 12],
  'BRT-6D': [12, 1, 2],
  'MAH-4D': [6, 7, 8, 9, 10, 11, 12, 1, 2],
  'TNT-7D': [10, 11, 12, 1, 2, 3],
  'TWG-8D': [3, 4, 5, 6, 9, 10, 11],
};

const PACKAGES: readonly PackageTemplate[] = [
  {
    packageCode: 'GOA-5D',
    title: 'Goa Beaches & Old Churches — 5 Days',
    destination: 'Calangute, Panjim, Old Goa, Palolem',
    region: 'Goa',
    boardingCity: 'Vasco da Gama',
    meetingPoint: 'Dabolim Airport, arrivals forecourt',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 2_150_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Goa, transfer to Calangute, sunset at Baga', 'Calangute'],
      ['Old Goa basilicas and the Panjim Latin Quarter', 'Calangute'],
      ['South Goa — Colva, Cabo de Rama and Palolem', 'Palolem'],
      ['Dudhsagar falls and a spice plantation lunch', 'Calangute'],
      ['Mandovi morning, transfer to Dabolim, departure', null],
    ],
  },
  {
    packageCode: 'RJS-8D',
    title: 'Rajasthan Royal Circuit — 8 Days',
    destination: 'Jaipur, Pushkar, Jodhpur, Ranakpur, Udaipur',
    region: 'Rajasthan',
    boardingCity: 'Jaipur',
    meetingPoint: 'Jaipur International Airport, terminal 2 arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 4_450_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Jaipur, Birla Mandir and dinner at Chokhi Dhani', 'Jaipur'],
      ['Amer Fort, Jantar Mantar and Hawa Mahal', 'Jaipur'],
      ['Jaipur to Pushkar — Brahma temple and the ghats', 'Pushkar'],
      ['Pushkar to Jodhpur via Ajmer Sharif', 'Jodhpur'],
      ['Mehrangarh, Jaswant Thada and the clock tower bazaar', 'Jodhpur'],
      ['Jodhpur to Udaipur via the Ranakpur Jain temples', 'Udaipur'],
      ['City Palace, a Pichola boat ride, Saheliyon ki Bari', 'Udaipur'],
      ['Transfer to Udaipur airport, departure', null],
    ],
  },
  {
    packageCode: 'AND-6D',
    title: 'Andaman Islands — 6 Days',
    destination: 'Port Blair, Havelock, Neil Island',
    region: 'Andaman & Nicobar',
    boardingCity: 'Port Blair',
    meetingPoint: 'Veer Savarkar Airport, arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 5_200_000,
    trek: false,
    international: false,
    permitRequired: true,
    days: [
      ['Arrive Port Blair, Cellular Jail light and sound show', 'Port Blair'],
      ['Ross Island and North Bay by ferry', 'Port Blair'],
      ['Catamaran to Havelock, sunset at Radhanagar', 'Havelock'],
      ['Elephant Beach snorkelling and a reef walk', 'Havelock'],
      ['Neil Island — Bharatpur beach and the Natural Bridge', 'Neil Island'],
      ['Ferry back to Port Blair, Chidiya Tapu, departure', null],
    ],
  },
  {
    packageCode: 'SIK-7D',
    title: 'Sikkim & Darjeeling — 7 Days',
    destination: 'Gangtok, Tsomgo, Pelling, Darjeeling',
    region: 'Sikkim',
    boardingCity: 'Siliguri',
    meetingPoint: 'New Jalpaiguri station, main exit',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 3_850_000,
    trek: false,
    international: false,
    permitRequired: true,
    days: [
      ['NJP pickup, drive up to Gangtok, MG Marg evening', 'Gangtok'],
      ['Tsomgo Lake and Baba Harbhajan Singh Mandir', 'Gangtok'],
      ['Rumtek and Enchey monasteries, Namgyal Institute', 'Gangtok'],
      ['Gangtok to Pelling via Ravangla and the Buddha Park', 'Pelling'],
      ['Pemayangtse, the Rabdentse ruins and Khecheopalri lake', 'Pelling'],
      ['Pelling to Darjeeling, Mall Road and Glenary’s', 'Darjeeling'],
      ['Tiger Hill sunrise, the toy train, transfer to NJP', null],
    ],
  },
  {
    packageCode: 'VAR-4D',
    title: 'Varanasi & Sarnath — 4 Days',
    destination: 'Varanasi, Sarnath',
    region: 'Uttar Pradesh',
    boardingCity: 'Varanasi',
    meetingPoint: 'Lal Bahadur Shastri Airport, arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 1_650_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Varanasi, Ganga Aarti at Dashashwamedh ghat', 'Varanasi'],
      ['Sunrise boat ride, Kashi Vishwanath, the old city on foot', 'Varanasi'],
      ['Sarnath — Dhamek Stupa, the ruins and the museum', 'Varanasi'],
      ['Banarasi silk weavers’ quarter, transfer to the airport', null],
    ],
  },
  {
    packageCode: 'KAR-6D',
    title: 'Karnataka Heritage — 6 Days',
    destination: 'Mysuru, Coorg, Hampi',
    region: 'Karnataka',
    boardingCity: 'Bengaluru',
    meetingPoint: 'Kempegowda Airport, terminal 1 arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 3_150_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Bengaluru pickup, drive to Mysuru, palace illumination', 'Mysuru'],
      ['Mysore Palace, Chamundi Hill and Devaraja market', 'Mysuru'],
      ['Mysuru to Coorg via Srirangapatna and Nisargadhama', 'Madikeri'],
      ['Abbey Falls, Talakaveri and a coffee estate walk', 'Madikeri'],
      ['Long drive to Hampi, sunset from Hemakuta hill', 'Hampi'],
      ['Virupaksha, Vittala and the stone chariot, departure', null],
    ],
  },
  {
    packageCode: 'GUJ-7D',
    title: 'Gujarat: Rann & Gir — 7 Days',
    destination: 'Ahmedabad, Bhuj, Dhordo, Sasan Gir, Somnath',
    region: 'Gujarat',
    boardingCity: 'Ahmedabad',
    meetingPoint: 'Sardar Vallabhbhai Patel Airport, terminal 1',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 3_950_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Ahmedabad, Sabarmati Ashram, Manek Chowk at night', 'Ahmedabad'],
      ['Ahmedabad to Bhuj, Aina Mahal and the Bhuj bazaar', 'Bhuj'],
      ['The white desert at Dhordo, camel cart, moonrise', 'Dhordo'],
      ['Kutch craft villages — Nirona, Hodka and Ajrakhpur', 'Bhuj'],
      ['Long drive to Sasan Gir', 'Sasan Gir'],
      ['Gir lion safari at dawn, Somnath temple in the evening', 'Sasan Gir'],
      ['Drive to Rajkot, departure', null],
    ],
  },
  {
    packageCode: 'APC-6D',
    title: 'Araku & the Andhra Coast — 6 Days',
    destination: 'Visakhapatnam, Araku Valley, Borra Caves',
    region: 'Andhra Pradesh',
    boardingCity: 'Visakhapatnam',
    meetingPoint: 'Visakhapatnam railway station, platform 1 exit',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 2_450_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Vizag, RK Beach and the submarine museum', 'Visakhapatnam'],
      ['The Araku train through the Eastern Ghats, coffee museum', 'Araku Valley'],
      ['Borra Caves and a Dhimsa village walk', 'Araku Valley'],
      ['Back to Vizag via Katiki waterfall', 'Visakhapatnam'],
      ['Simhachalam, Kailasagiri ropeway and Rushikonda', 'Visakhapatnam'],
      ['Bheemili beach morning, departure', null],
    ],
  },
  {
    packageCode: 'KSH-6D',
    title: 'Kashmir Valley — 6 Days',
    destination: 'Srinagar, Gulmarg, Pahalgam',
    region: 'Jammu & Kashmir',
    boardingCity: 'Srinagar',
    meetingPoint: 'Sheikh ul-Alam Airport, arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 4_100_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Srinagar, shikara ride on Dal Lake', 'Srinagar houseboat'],
      ['Gulmarg — gondola to Kongdoori and the meadow walk', 'Gulmarg'],
      ['Drive to Pahalgam, Betaab and Aru valleys', 'Pahalgam'],
      ['Chandanwari in the morning, back to Srinagar', 'Srinagar houseboat'],
      ['Mughal gardens — Nishat, Shalimar, Chashme Shahi', 'Srinagar houseboat'],
      ['Lal Chowk shopping, transfer to the airport', null],
    ],
  },
  {
    packageCode: 'NEP-8D',
    title: 'Nepal: Kathmandu & Pokhara — 8 Days',
    destination: 'Kathmandu, Bhaktapur, Patan, Pokhara',
    region: 'Nepal',
    boardingCity: 'Kathmandu',
    meetingPoint: 'Tribhuvan International Airport, arrivals hall',
    timezone: 'Asia/Kathmandu',
    basePriceMinor: 5_600_000,
    trek: false,
    international: true,
    permitRequired: false,
    days: [
      ['Arrive Kathmandu, evening in Thamel', 'Kathmandu'],
      ['Pashupatinath, Boudhanath and Swayambhunath', 'Kathmandu'],
      ['Bhaktapur and Patan durbar squares', 'Kathmandu'],
      ['Drive to Pokhara along the Trishuli', 'Pokhara'],
      ['Sarangkot sunrise over Annapurna, Phewa lake boating', 'Pokhara'],
      ['World Peace Pagoda, Davis Falls, Gupteshwor cave', 'Pokhara'],
      ['Fly back to Kathmandu, free afternoon', 'Kathmandu'],
      ['Transfer to Tribhuvan, departure', null],
    ],
  },
  {
    packageCode: 'BHU-7D',
    title: 'Bhutan: Paro, Thimphu & Punakha — 7 Days',
    destination: 'Paro, Thimphu, Punakha, Taktsang',
    region: 'Bhutan',
    boardingCity: 'Paro',
    meetingPoint: 'Paro International Airport, arrivals',
    timezone: 'Asia/Thimphu',
    basePriceMinor: 6_900_000,
    trek: false,
    international: true,
    permitRequired: true,
    days: [
      ['Arrive Paro, Rinpung Dzong and the national museum', 'Paro'],
      ['Paro to Thimphu, Buddha Dordenma at sunset', 'Thimphu'],
      ['Tashichho Dzong, the weekend market, Motithang takin preserve', 'Thimphu'],
      ['Thimphu to Punakha over Dochula pass', 'Punakha'],
      ['Punakha Dzong and the walk to Chimi Lhakhang', 'Punakha'],
      ['Back to Paro, hike to Taktsang — the Tiger’s Nest', 'Paro'],
      ['Transfer to Paro airport, departure', null],
    ],
  },
  {
    packageCode: 'SRI-8D',
    title: 'Sri Lanka Highlights — 8 Days',
    destination: 'Colombo, Sigiriya, Kandy, Nuwara Eliya, Galle',
    region: 'Sri Lanka',
    boardingCity: 'Colombo',
    meetingPoint: 'Bandaranaike International Airport, arrivals',
    timezone: 'Asia/Colombo',
    basePriceMinor: 7_400_000,
    trek: false,
    international: true,
    permitRequired: false,
    days: [
      ['Arrive Colombo, Galle Face green in the evening', 'Colombo'],
      ['Colombo to Sigiriya via the Dambulla cave temple', 'Sigiriya'],
      ['Sigiriya rock fortress, Minneriya elephant safari', 'Sigiriya'],
      ['Sigiriya to Kandy, the Temple of the Tooth', 'Kandy'],
      ['Kandy to Nuwara Eliya on the hill-country train', 'Nuwara Eliya'],
      ['A tea factory, Gregory Lake, then the drive to Galle', 'Galle'],
      ['Galle fort on foot and Unawatuna beach', 'Galle'],
      ['Transfer to Bandaranaike, departure', null],
    ],
  },
  {
    packageCode: 'DDM-9D',
    title: 'Do Dham — Kedarnath & Badrinath — 9 Days',
    destination: 'Haridwar, Guptkashi, Kedarnath, Badrinath, Rishikesh',
    region: 'Uttarakhand',
    boardingCity: 'Haridwar',
    meetingPoint: 'Haridwar Junction, platform 1 exit',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 4_750_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Assemble at Haridwar, Har ki Pauri aarti', 'Haridwar'],
      ['Haridwar to Guptkashi via Devprayag', 'Guptkashi'],
      ['Sonprayag, then trek or pony up to Kedarnath', 'Kedarnath'],
      ['Kedarnath darshan, descend to Guptkashi', 'Guptkashi'],
      ['Guptkashi to Joshimath via Rudraprayag', 'Joshimath'],
      ['Joshimath to Badrinath, evening aarti', 'Badrinath'],
      ['Badrinath darshan and Mana village, back to Joshimath', 'Joshimath'],
      ['Joshimath to Rishikesh', 'Rishikesh'],
      ['Rishikesh to Haridwar, departure', null],
    ],
  },
  {
    packageCode: 'VOF-5D',
    title: 'Valley of Flowers Trek — 5 Days',
    destination: 'Govindghat, Ghangaria, Valley of Flowers, Hemkund Sahib',
    region: 'Uttarakhand',
    boardingCity: 'Rishikesh',
    meetingPoint: 'Base camp office, Tapovan, Rishikesh — 0800 sharp',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 1_950_000,
    trek: true,
    international: false,
    permitRequired: false,
    days: [
      ['Report at Rishikesh, gear check and route briefing', 'Rishikesh'],
      ['Drive to Govindghat, trek up to Ghangaria', 'Ghangaria'],
      ['Into the Valley of Flowers and back to Ghangaria', 'Ghangaria'],
      ['Climb to Hemkund Sahib (4,630 m), descend to Ghangaria', 'Ghangaria'],
      ['Trek down to Govindghat, drive to Rishikesh, departure', null],
    ],
  },
  {
    packageCode: 'KGL-7D',
    title: 'Kashmir Great Lakes Trek — 7 Days',
    destination: 'Sonamarg, Nichnai, Vishansar, Gadsar, Gangbal',
    region: 'Jammu & Kashmir',
    boardingCity: 'Srinagar',
    meetingPoint: 'Base camp pickup, Dalgate, Srinagar — 0700 sharp',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 2_650_000,
    trek: true,
    international: false,
    permitRequired: false,
    days: [
      ['Report at Srinagar, gear issue and medical check', 'Srinagar'],
      ['Drive to Shitkadi, acclimatisation walk above Sonamarg', 'Shitkadi campsite'],
      ['Shitkadi to Nichnai through the Table Top meadow', 'Nichnai campsite'],
      ['Nichnai pass (4,100 m) to Vishansar lake', 'Vishansar campsite'],
      ['Gadsar pass (4,200 m) and down to Gadsar', 'Gadsar campsite'],
      ['Satsar and the Gangbal twin lakes', 'Gangbal campsite'],
      ['Descend to Naranag, drive to Srinagar, departure', null],
    ],
  },
  {
    packageCode: 'SND-5D',
    title: 'Sandakphu Ridge Trek — 5 Days',
    destination: 'Maneybhanjang, Tumling, Sandakphu, Srikhola',
    region: 'West Bengal',
    boardingCity: 'Siliguri',
    meetingPoint: 'New Jalpaiguri station, prepaid taxi stand',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 1_750_000,
    trek: true,
    international: false,
    permitRequired: true,
    days: [
      ['NJP pickup, drive to Maneybhanjang, briefing', 'Maneybhanjang'],
      ['Maneybhanjang to Tumling along the Singalila ridge', 'Tumling'],
      ['Tumling to Kalipokhri and up to Sandakphu (3,636 m)', 'Sandakphu'],
      ['Sleeping Buddha at sunrise, ridge walk down to Srikhola', 'Srikhola'],
      ['Drive back to NJP, departure', null],
    ],
  },
  {
    packageCode: 'BRT-6D',
    title: 'Brahmatal Winter Trek — 6 Days',
    destination: 'Lohajung, Bekaltal, Brahmatal, Bhekaltal ridge',
    region: 'Uttarakhand',
    boardingCity: 'Rishikesh',
    meetingPoint: 'Base camp office, Tapovan, Rishikesh — 0600 sharp',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 1_690_000,
    trek: true,
    international: false,
    permitRequired: false,
    days: [
      ['Report at Rishikesh, gear issue and briefing', 'Rishikesh'],
      ['Drive to Lohajung via Karnaprayag', 'Lohajung'],
      ['Lohajung to Bekaltal through the oak forest', 'Bekaltal campsite'],
      ['Bekaltal to Brahmatal, camp above the treeline', 'Brahmatal campsite'],
      ['Summit the Brahmatal ridge (3,750 m), descend to Lohajung', 'Lohajung'],
      ['Drive back to Rishikesh, debrief and certificates', null],
    ],
  },
  {
    packageCode: 'MAH-4D',
    title: 'Mahabaleshwar & Panchgani Weekend — 4 Days',
    destination: 'Mahabaleshwar, Pratapgad, Panchgani',
    region: 'Maharashtra',
    boardingCity: 'Pune',
    meetingPoint: 'Sharma Travels office, FC Road, Pune — 0700',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 1_250_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Pune pickup, drive to Mahabaleshwar, Wilson Point sunset', 'Mahabaleshwar'],
      ['Pratapgad fort and the Mapro strawberry farm', 'Mahabaleshwar'],
      ['Panchgani — Table Land, Sydney Point, Parsi Point', 'Panchgani'],
      ['Venna Lake in the morning, drive back to Pune', null],
    ],
  },
  {
    packageCode: 'TNT-7D',
    title: 'Tamil Nadu Temple Trail — 7 Days',
    destination: 'Chennai, Mahabalipuram, Pondicherry, Thanjavur, Madurai',
    region: 'Tamil Nadu',
    boardingCity: 'Chennai',
    meetingPoint: 'Chennai Central, suburban terminal exit',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 3_350_000,
    trek: false,
    international: false,
    permitRequired: false,
    days: [
      ['Arrive Chennai, Kapaleeshwarar temple and Marina beach', 'Chennai'],
      ['Mahabalipuram shore temple, drive to Pondicherry', 'Pondicherry'],
      ['The French quarter, Auroville and the Promenade at dusk', 'Pondicherry'],
      ['Pondicherry to Thanjavur, Brihadeeswarar temple', 'Thanjavur'],
      ['Thanjavur to Madurai via the Trichy Rockfort', 'Madurai'],
      ['Meenakshi Amman temple and the night palanquin ceremony', 'Madurai'],
      ['Transfer to Madurai airport, departure', null],
    ],
  },
  {
    packageCode: 'TWG-8D',
    title: 'Arunachal: Tawang & Sela — 8 Days',
    destination: 'Bhalukpong, Dirang, Tawang, Bumla',
    region: 'Arunachal Pradesh',
    boardingCity: 'Guwahati',
    meetingPoint: 'Lokpriya Gopinath Bordoloi Airport, arrivals',
    timezone: 'Asia/Kolkata',
    basePriceMinor: 5_300_000,
    trek: false,
    international: false,
    permitRequired: true,
    days: [
      ['Guwahati pickup, drive to Bhalukpong', 'Bhalukpong'],
      ['Bhalukpong to Dirang via Bomdila', 'Dirang'],
      ['Dirang to Tawang over Sela pass (4,170 m)', 'Tawang'],
      ['Tawang monastery, the war memorial and Urgelling', 'Tawang'],
      ['Bumla pass and Sangetsar — the Madhuri lake', 'Tawang'],
      ['Tawang back down to Dirang', 'Dirang'],
      ['Dirang to Guwahati via Nameri', 'Guwahati'],
      ['Kamakhya temple in the morning, departure', null],
    ],
  },
];

// ---------------------------------------------------------------------------
// Extra staff
//
// Six people cannot run fifty-six departures. Twelve more leaders, hired the
// way the core four were — regionally, because a Tawang permit run is not a
// job you hand to someone who has never filed one — and two more at the Pune
// desk. Ids continue from ST-06 so the whole roster reads as one list.
// ---------------------------------------------------------------------------

interface ExtraLeader {
  staffId: string;
  staffCode: string;
  fullName: string;
  phone: string;
  basedIn: string;
  languages: readonly string[];
  joinedOn: IsoDate;
  /** Which package regions this person is trusted with. */
  regions: readonly string[];
}

const EXTRA_LEADERS: readonly ExtraLeader[] = [
  {
    staffId: 'ST-07',
    staffCode: 'STPL/TL/05',
    fullName: 'Sandeep Rathore',
    phone: '+919829117340',
    basedIn: 'Jaipur, Rajasthan',
    languages: ['Rajasthani', 'Hindi', 'English'],
    joinedOn: '2018-08-06',
    regions: ['Rajasthan', 'Gujarat'],
  },
  {
    staffId: 'ST-08',
    staffCode: 'STPL/TL/06',
    fullName: 'Nisha Pednekar',
    phone: '+919960428815',
    basedIn: 'Panaji, Goa',
    languages: ['Konkani', 'Marathi', 'Hindi', 'English'],
    joinedOn: '2021-01-18',
    regions: ['Goa', 'Maharashtra'],
  },
  {
    staffId: 'ST-09',
    staffCode: 'STPL/TL/07',
    fullName: 'Bipin Chettri',
    phone: '+919832207166',
    basedIn: 'Gangtok, Sikkim',
    languages: ['Nepali', 'Hindi', 'English', 'Bhutia'],
    joinedOn: '2017-03-29',
    regions: ['Sikkim', 'West Bengal'],
  },
  {
    staffId: 'ST-10',
    staffCode: 'STPL/TL/08',
    fullName: 'Tarun Hazarika',
    phone: '+919864033921',
    basedIn: 'Guwahati, Assam',
    languages: ['Assamese', 'Hindi', 'English', 'Bengali'],
    joinedOn: '2019-10-02',
    regions: ['Arunachal Pradesh'],
  },
  {
    staffId: 'ST-11',
    staffCode: 'STPL/TL/09',
    fullName: 'Farhan Dar',
    phone: '+919906551208',
    basedIn: 'Srinagar, Jammu & Kashmir',
    languages: ['Kashmiri', 'Urdu', 'Hindi', 'English'],
    joinedOn: '2018-05-21',
    regions: ['Jammu & Kashmir'],
  },
  {
    staffId: 'ST-12',
    staffCode: 'STPL/TL/10',
    fullName: 'Suresh Yadav',
    phone: '+919415608234',
    basedIn: 'Varanasi, Uttar Pradesh',
    languages: ['Bhojpuri', 'Hindi', 'English'],
    joinedOn: '2015-12-08',
    regions: ['Uttar Pradesh'],
  },
  {
    staffId: 'ST-13',
    staffCode: 'STPL/TL/11',
    fullName: 'Kavitha Reddy',
    phone: '+919948310776',
    basedIn: 'Visakhapatnam, Andhra Pradesh',
    languages: ['Telugu', 'Hindi', 'English'],
    joinedOn: '2020-02-17',
    regions: ['Andhra Pradesh'],
  },
  {
    staffId: 'ST-14',
    staffCode: 'STPL/TL/12',
    fullName: 'Joseph D’Cruz',
    phone: '+919933740518',
    basedIn: 'Port Blair, Andaman & Nicobar',
    languages: ['Tamil', 'Bengali', 'Hindi', 'English'],
    joinedOn: '2019-06-11',
    regions: ['Andaman & Nicobar'],
  },
  {
    staffId: 'ST-15',
    staffCode: 'STPL/TL/13',
    fullName: 'Shalini Gowda',
    phone: '+919845227093',
    basedIn: 'Mysuru, Karnataka',
    languages: ['Kannada', 'Tamil', 'Hindi', 'English'],
    joinedOn: '2021-07-26',
    regions: ['Karnataka'],
  },
  {
    staffId: 'ST-16',
    staffCode: 'STPL/TL/14',
    fullName: 'Pemba Sherpa',
    phone: '+919711840562',
    basedIn: 'Delhi (Nepal & Bhutan desk)',
    languages: ['Nepali', 'Dzongkha', 'Hindi', 'English'],
    joinedOn: '2016-11-14',
    regions: ['Nepal', 'Bhutan'],
  },
  {
    staffId: 'ST-17',
    staffCode: 'STPL/TL/15',
    fullName: 'Murugan Selvaraj',
    phone: '+919894116470',
    basedIn: 'Madurai, Tamil Nadu',
    languages: ['Tamil', 'Sinhala', 'English', 'Hindi'],
    joinedOn: '2017-09-05',
    regions: ['Tamil Nadu', 'Sri Lanka'],
  },
  {
    staffId: 'ST-18',
    staffCode: 'STPL/TL/16',
    fullName: 'Deepak Negi',
    phone: '+919758203344',
    basedIn: 'Rishikesh, Uttarakhand',
    languages: ['Garhwali', 'Hindi', 'English'],
    joinedOn: '2014-04-30',
    regions: ['Uttarakhand'],
  },
];

const EXTRA_DESK: readonly CrmStaff[] = [
  {
    staffId: 'ST-19',
    staffCode: 'STPL/DK/03',
    fullName: 'Sadhana Kulkarni',
    role: 'DESK_EXECUTIVE',
    phone: '+919850337261',
    loginEmail: 'sadhana.kulkarni@sharmatravels.co.in',
    basedIn: 'Pune, Maharashtra',
    languages: ['Marathi', 'Hindi', 'English'],
    joinedOn: '2017-02-13',
    active: true,
    sourceUpdatedAt: '2026-09-10T09:24:00+05:30',
  },
  {
    staffId: 'ST-20',
    staffCode: 'STPL/DK/04',
    fullName: 'Nilesh Gokhale',
    role: 'DESK_EXECUTIVE',
    phone: '+919822556104',
    loginEmail: 'nilesh.gokhale@sharmatravels.co.in',
    basedIn: 'Pune, Maharashtra',
    languages: ['Marathi', 'Hindi', 'English'],
    joinedOn: '2013-06-24',
    active: true,
    sourceUpdatedAt: '2026-09-10T19:41:00+05:30',
  },
];

/**
 * Which leader is trusted with which region — the core four included, so the
 * generated departures land on the same people the hand-written ones do.
 */
const LEADER_REGIONS: Readonly<Record<string, readonly string[]>> = {
  'ST-01': ['Ladakh', 'Jammu & Kashmir'],
  'ST-02': ['Himachal Pradesh', 'Uttarakhand'],
  'ST-03': ['Kerala', 'Tamil Nadu', 'Karnataka'],
  'ST-04': ['Meghalaya', 'Arunachal Pradesh', 'West Bengal'],
  ...Object.fromEntries(EXTRA_LEADERS.map((leader) => [leader.staffId, leader.regions])),
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const MALE_FIRST_NAMES: readonly string[] = [
  'Aditya',
  'Rohan',
  'Vikas',
  'Nikhil',
  'Siddharth',
  'Arjun',
  'Kunal',
  'Rahul',
  'Amit',
  'Sanjay',
  'Manoj',
  'Prakash',
  'Ramesh',
  'Venkatesh',
  'Karthik',
  'Sathish',
  'Praveen',
  'Naveen',
  'Ravi',
  'Sunil',
  'Ashish',
  'Gaurav',
  'Ankit',
  'Varun',
  'Abhishek',
  'Devendra',
  'Jatin',
  'Parth',
  'Yash',
  'Harsh',
  'Omkar',
  'Sagar',
  'Tushar',
  'Sameer',
  'Irfan',
  'Zaid',
  'Arif',
  'Joseph',
  'Thomas',
  'Gurpreet',
  'Bikram',
  'Anirban',
  'Debashish',
  'Mahadev',
  'Nitin',
];

const FEMALE_FIRST_NAMES: readonly string[] = [
  'Ananya',
  'Shreya',
  'Divya',
  'Kavya',
  'Nandini',
  'Ishita',
  'Rituparna',
  'Sneha',
  'Pooja',
  'Neha',
  'Swati',
  'Aarti',
  'Manisha',
  'Sunita',
  'Lakshmi',
  'Revathi',
  'Meenakshi',
  'Padmini',
  'Bhavana',
  'Trisha',
  'Gayatri',
  'Rukmini',
  'Aishwarya',
  'Vaishnavi',
  'Madhuri',
  'Rupa',
  'Tanya',
  'Ayesha',
  'Farida',
  'Zainab',
  'Grace',
  'Simran',
  'Harleen',
  'Paromita',
  'Sharmila',
  'Jyoti',
  'Rekha',
  'Urmila',
  'Snehal',
  'Kritika',
];

const SURNAMES: readonly string[] = [
  'Sharma',
  'Verma',
  'Gupta',
  'Agarwal',
  'Bansal',
  'Mittal',
  'Chopra',
  'Kapoor',
  'Malhotra',
  'Sethi',
  'Deshpande',
  'Kulkarni',
  'Joshi',
  'Patil',
  'Jadhav',
  'Gaikwad',
  'Shinde',
  'Patel',
  'Shah',
  'Desai',
  'Trivedi',
  'Mehta',
  'Iyer',
  'Iyengar',
  'Subramanian',
  'Krishnan',
  'Nair',
  'Menon',
  'Pillai',
  'Reddy',
  'Rao',
  'Naidu',
  'Gowda',
  'Shetty',
  'Hegde',
  'Banerjee',
  'Chatterjee',
  'Mukherjee',
  'Ghosh',
  'Dutta',
  'Bose',
  'Sen',
  'Singh',
  'Chauhan',
  'Rathore',
  'Bhati',
  'Khan',
  'Sheikh',
  'Ansari',
  'Fernandes',
  'Pinto',
  'Varghese',
  'Borah',
  'Hazarika',
  'Lama',
  'Tamang',
];

interface HomeTown {
  city: string;
  state: string;
  language: string;
}

const HOME_TOWNS: readonly HomeTown[] = [
  { city: 'Pune', state: 'Maharashtra', language: 'Marathi' },
  { city: 'Mumbai', state: 'Maharashtra', language: 'Marathi' },
  { city: 'Nashik', state: 'Maharashtra', language: 'Marathi' },
  { city: 'Nagpur', state: 'Maharashtra', language: 'Marathi' },
  { city: 'Ahmedabad', state: 'Gujarat', language: 'Gujarati' },
  { city: 'Surat', state: 'Gujarat', language: 'Gujarati' },
  { city: 'Vadodara', state: 'Gujarat', language: 'Gujarati' },
  { city: 'Bengaluru', state: 'Karnataka', language: 'Kannada' },
  { city: 'Mysuru', state: 'Karnataka', language: 'Kannada' },
  { city: 'Mangaluru', state: 'Karnataka', language: 'Kannada' },
  { city: 'Chennai', state: 'Tamil Nadu', language: 'Tamil' },
  { city: 'Coimbatore', state: 'Tamil Nadu', language: 'Tamil' },
  { city: 'Madurai', state: 'Tamil Nadu', language: 'Tamil' },
  { city: 'Hyderabad', state: 'Telangana', language: 'Telugu' },
  { city: 'Visakhapatnam', state: 'Andhra Pradesh', language: 'Telugu' },
  { city: 'Kochi', state: 'Kerala', language: 'Malayalam' },
  { city: 'Thiruvananthapuram', state: 'Kerala', language: 'Malayalam' },
  { city: 'Kolkata', state: 'West Bengal', language: 'Bengali' },
  { city: 'Siliguri', state: 'West Bengal', language: 'Bengali' },
  { city: 'Bhubaneswar', state: 'Odisha', language: 'Odia' },
  { city: 'Patna', state: 'Bihar', language: 'Hindi' },
  { city: 'Lucknow', state: 'Uttar Pradesh', language: 'Hindi' },
  { city: 'Kanpur', state: 'Uttar Pradesh', language: 'Hindi' },
  { city: 'Varanasi', state: 'Uttar Pradesh', language: 'Hindi' },
  { city: 'New Delhi', state: 'Delhi', language: 'Hindi' },
  { city: 'Gurugram', state: 'Haryana', language: 'Hindi' },
  { city: 'Noida', state: 'Uttar Pradesh', language: 'Hindi' },
  { city: 'Chandigarh', state: 'Chandigarh', language: 'Punjabi' },
  { city: 'Amritsar', state: 'Punjab', language: 'Punjabi' },
  { city: 'Jaipur', state: 'Rajasthan', language: 'Hindi' },
  { city: 'Jodhpur', state: 'Rajasthan', language: 'Hindi' },
  { city: 'Indore', state: 'Madhya Pradesh', language: 'Hindi' },
  { city: 'Bhopal', state: 'Madhya Pradesh', language: 'Hindi' },
  { city: 'Raipur', state: 'Chhattisgarh', language: 'Hindi' },
  { city: 'Guwahati', state: 'Assam', language: 'Assamese' },
  { city: 'Dehradun', state: 'Uttarakhand', language: 'Hindi' },
  { city: 'Panaji', state: 'Goa', language: 'Konkani' },
];

const EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'gmail.com',
  'yahoo.co.in',
  'outlook.com',
  'rediffmail.com',
];

const MEDICAL_NOTES: readonly string[] = [
  'Hypertension — on Telmisartan 40mg daily, carries her own strip.',
  'Asthmatic. Inhaler in the day pack, not the checked luggage.',
  'Type 2 diabetes, insulin twice daily. Needs a cold bag for the pens.',
  'Knee replacement in 2023 — no long flights of stairs, no unassisted descents.',
  'Peanut allergy, severe. Carries an EpiPen; leader briefed.',
  'Motion sickness on ghat roads. Wants a front seat throughout.',
  'Recovering from a fractured wrist, cast off three weeks ago.',
  'Vertigo at height. Flagged for the ropeway and the ridge sections.',
  'Pregnant, second trimester. Doctor’s fitness letter on file.',
  'On blood thinners after a stent — no adventure activity of any kind.',
  'Lactose intolerant, and reacts badly rather than mildly.',
  'Mild altitude sickness on a previous trip; Diamox prescribed by her GP.',
];

const RELATIONS_FAMILY: readonly string[] = [
  'Spouse',
  'Son',
  'Daughter',
  'Mother',
  'Father',
  'Brother',
  'Sister',
];

const RELATIONS_GROUP: readonly string[] = ['Friend', 'Colleague', 'Cousin'];

const CHANNELS: readonly (readonly [BookingChannel, number])[] = [
  ['WEBSITE', 34],
  ['PHONE', 24],
  ['WALK_IN', 14],
  ['AGENT_REFERRAL', 16],
  ['REPEAT_CLIENT', 12],
];

const MEALS: readonly (readonly [MealPreference, number])[] = [
  ['NON_VEG', 45],
  ['VEG', 40],
  ['JAIN', 10],
  ['VEGAN', 5],
];

const PAYMENT_MODES: readonly (readonly [PaymentMode, number])[] = [
  ['UPI', 40],
  ['NEFT', 35],
  ['CARD', 10],
  ['CASH', 10],
  ['CHEQUE', 5],
];

const BANK_CODES: readonly string[] = [
  'HDFC',
  'ICIC',
  'SBIN',
  'KKBK',
  'UTIB',
  'CNRB',
  'PUNB',
  'IDFB',
  'BARB',
  'FDRL',
];

const CALL_OFF_REASONS: readonly string[] = [
  'Cloudburst on the approach road and the district administration advised against tourist movement. Departure pulled rather than re-routed.',
  'Only a third of the seats sold by the cut-off date. Cheaper to refund than to run the coach half empty.',
  'The protected-area permits were not cleared in time and the transport contractor would not hold the vehicles any longer.',
  'The ground handler cancelled on us eleven days out and no replacement could be arranged at that price.',
  'A state-wide bandh was called across the departure window. Refunds processed rather than risk the group on the road.',
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface GeneratedPerson {
  firstName: string;
  surname: string;
  gender: Gender;
}

function makePerson(ctx: Context, surname?: string): GeneratedPerson {
  const gender: Gender = weighted(ctx.rng, [
    ['MALE', 48],
    ['FEMALE', 48],
    ['OTHER', 2],
    ['UNDISCLOSED', 2],
  ] as const);
  // MALE and FEMALE draw from their own pool; the other two draw from either,
  // because the CRM's gender field records what the person put on the form and
  // says nothing about what they are called.
  const firstName =
    gender === 'FEMALE'
      ? pick(ctx.rng, FEMALE_FIRST_NAMES)
      : gender === 'MALE'
        ? pick(ctx.rng, MALE_FIRST_NAMES)
        : pick(ctx.rng, [...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES]);
  return { firstName, surname: surname ?? pick(ctx.rng, SURNAMES), gender };
}

/**
 * Derived from the traveller id rather than a position in some array, so two
 * people with the same name on different departures do not collide.
 */
function emailFor(ctx: Context, person: GeneratedPerson, travellerId: string): string {
  const local = `${person.firstName}.${person.surname}`.toLowerCase().replace(/[^a-z.]/g, '');
  return `${local}${travellerId.replace(/\D/g, '').slice(-3)}@${pick(ctx.rng, EMAIL_DOMAINS)}`;
}

function buildItinerary(template: PackageTemplate, startDate: IsoDate): CrmItineraryDay[] {
  return template.days.map(([title, nightHalt], index) => ({
    dayNumber: index + 1,
    date: addDays(startDate, index),
    title,
    nightHalt,
  }));
}

/** Party sizes, weighted the way a fixed-departure manifest actually splits. */
const PARTY_SIZES: readonly (readonly [number, number])[] = [
  [1, 22],
  [2, 40],
  [3, 22],
  [4, 16],
];

/**
 * Which package goes out on a given month: the in-season one the operator has
 * run least so far, with the rotation offset breaking ties.
 *
 * Least-run-first matters more than it looks. Taking the first in-season match
 * instead puts nine of the fifty departures on one package, because July and
 * August only have five candidates between them and a forward scan keeps
 * landing on the same one. Spreading the catalogue is both what an operator
 * does and what makes the tour list worth scrolling.
 */
function selectPackage(
  rotation: number,
  month: number,
  runsSoFar: ReadonlyMap<string, number>,
): PackageTemplate {
  let best: PackageTemplate | undefined;
  let bestRuns = Number.POSITIVE_INFINITY;
  for (let step = 0; step < PACKAGES.length; step += 1) {
    const candidate = PACKAGES[(rotation + step) % PACKAGES.length];
    if (candidate === undefined || !(SELLING_MONTHS[candidate.packageCode] ?? []).includes(month)) {
      continue;
    }
    const runs = runsSoFar.get(candidate.packageCode) ?? 0;
    if (runs < bestRuns) {
      best = candidate;
      bestRuns = runs;
    }
  }
  if (best === undefined) {
    throw new Error(`no package in the catalogue sells in month ${month}`);
  }
  return best;
}

interface GeneratedDeparture {
  tour: CrmTour;
  tourStaff: CrmTourStaff[];
  bookings: CrmBooking[];
  payments: CrmPayment[];
  travellers: CrmTraveller[];
}

/**
 * One dated departure, its roster, its bookings, its receipts and its people.
 *
 * The arithmetic invariants `core.ts` states by hand are enforced here rather
 * than described: `totalMinor` is `grossMinor - discountMinor`, `receivedMinor`
 * is the sum of the IN payments less the OUT ones, `grossMinor` is
 * `paxCount * pricePerSeatMinor`, and `seatsSold` is the sum of the party
 * sizes. The CRM's outstanding-balance column is computed from those, so a
 * generated row that broke one would look like a product bug.
 */
function buildDeparture(
  ctx: Context,
  template: PackageTemplate,
  departureNumber: number,
  startDate: IsoDate,
  forcedStatus: TourStatus | null,
  leaderPool: readonly string[],
  deskPool: readonly string[],
): GeneratedDeparture {
  const { rng } = ctx;
  const duration = template.days.length;
  const endDate = addDays(startDate, duration - 1);

  const status: TourStatus =
    forcedStatus ??
    (startDate > TODAY
      ? 'CONFIRMED'
      : endDate >= TODAY
        ? 'ON_TOUR'
        : daysBetween(endDate, TODAY) > 100
          ? 'CLOSED'
          : 'RETURNED');

  const calledOff = status === 'CALLED_OFF';

  const monthCode = `${startDate.slice(2, 4)}${startDate.slice(5, 7)}`;
  const slug = template.packageCode.split('-')[0] ?? template.packageCode;
  // The trailing departure number is what keeps a generated id out of core's
  // namespace — core ids are `TR-2610-LADAKH`, never `TR-2610-LEH-03`.
  const tourId = `TR-${monthCode}-${slug}-${pad2(departureNumber)}`;

  const pricePerSeatMinor = roundToHundredRupees(template.basePriceMinor * (0.94 + rng() * 0.14));
  const seatsTotal = template.trek ? int(rng, 10, 16) : int(rng, 14, 24);
  const fillRatio = calledOff ? 0.3 + rng() * 0.3 : 0.55 + rng() * 0.45;
  const seatsTarget = Math.max(2, Math.round(seatsTotal * fillRatio));

  // --- parties -------------------------------------------------------------

  const bookings: CrmBooking[] = [];
  const payments: CrmPayment[] = [];
  const travellers: CrmTraveller[] = [];

  let seatsSold = 0;
  while (seatsSold < seatsTarget) {
    const paxCount = Math.min(seatsTarget - seatsSold, weighted(rng, PARTY_SIZES));
    seatsSold += paxCount;

    const bookedOn = earliest(
      addDays(startDate, -int(rng, 12, 150)),
      addDays(TODAY, -int(rng, 1, 3)),
    );
    const bookingRef = `STPL/${String(yearOf(bookedOn)).slice(2)}/${ctx.nextBookingSequence()}`;

    const grossMinor = pricePerSeatMinor * paxCount;
    const discountMinor = chance(rng, 0.22)
      ? roundToHundredRupees(grossMinor * (0.03 + rng() * 0.05))
      : 0;
    const totalMinor = grossMinor - discountMinor;

    // A party of three or more with a shared surname is a family; otherwise
    // they are friends who booked together, and the manifest looks different.
    const isFamily = paxCount >= 3 ? chance(rng, 0.7) : chance(rng, 0.55);
    const sharedSurname = pick(rng, SURNAMES);
    const home = pick(rng, HOME_TOWNS);

    const party: { person: GeneratedPerson; travellerId: string }[] = [];
    for (let i = 0; i < paxCount; i += 1) {
      party.push({
        person: makePerson(ctx, isFamily ? sharedSurname : undefined),
        travellerId: `TV-${ctx.nextTravellerSequence()}`,
      });
    }

    const lead = party[0];
    if (lead === undefined) {
      throw new Error('a booking was generated with no travellers on it');
    }
    const leadName = `${lead.person.firstName} ${lead.person.surname}`;

    const partyName =
      paxCount === 1
        ? leadName
        : isFamily && paxCount >= 3
          ? `${sharedSurname} family`
          : paxCount === 2 && isFamily
            ? `${lead.person.firstName} & ${party[1]?.person.firstName ?? ''} ${sharedSurname}`
            : `${leadName} + ${paxCount - 1}`;

    // --- money in, and money back out ------------------------------------

    const paymentsForBooking: CrmPayment[] = [];
    const recordPayment = (
      direction: 'IN' | 'OUT',
      amountMinor: Paise,
      paidOn: IsoDate,
      mode: PaymentMode,
    ): void => {
      const reference =
        mode === 'UPI'
          ? `UPI ${int(rng, 410_000_000_000, 429_999_999_999)}`
          : mode === 'NEFT'
            ? `UTR ${pick(rng, BANK_CODES)}0N${paidOn.replace(/-/g, '').slice(2)}${String(
                int(rng, 10_000, 99_999),
              )}`
            : mode === 'CARD'
              ? `POS auth ${int(rng, 100_000, 999_999)}, Axis terminal ${int(rng, 1, 3)}`
              : mode === 'CASH'
                ? `Cash receipt ${int(rng, 1100, 1999)}, Pune office`
                : `Cheque ${int(rng, 100_000, 999_999)}, ${pick(rng, [
                    'HDFC Bank',
                    'Bank of Baroda',
                    'State Bank of India',
                    'Kotak Mahindra',
                  ])}`;
      paymentsForBooking.push({
        paymentId: `RC-${ctx.nextPaymentSequence()}`,
        bookingRef,
        direction,
        amountMinor,
        mode,
        paidOn,
        reference,
        recordedByStaffId: pick(rng, deskPool),
        sourceUpdatedAt: ctx.stamp(paidOn),
      });
    };

    const settled = calledOff ? chance(rng, 0.4) : status === 'CONFIRMED' ? chance(rng, 0.6) : true;

    let balanceDueOn: IsoDate | undefined;
    let bookingStatus: BookingStatus;

    if (calledOff) {
      // Everything on a pulled departure was paid before it was pulled. Some
      // parties have had the money back, the rest are still waiting.
      const advanceOnly = chance(rng, 0.35);
      const paidIn = advanceOnly
        ? roundToHundredRupees(totalMinor * (0.25 + rng() * 0.2))
        : totalMinor;
      recordPayment('IN', paidIn, bookedOn, weighted(rng, PAYMENT_MODES));
      if (settled) {
        // The published cancellation policy retains ten per cent.
        const refund = roundToHundredRupees(paidIn * 0.9);
        recordPayment('OUT', refund, addDays(TODAY, -int(rng, 1, 8)), 'NEFT');
        bookingStatus = 'REFUNDED';
      } else {
        bookingStatus = 'REFUND_DUE';
      }
    } else if (settled) {
      const splitPayment = totalMinor >= 5_000_000 && daysBetween(bookedOn, TODAY) > 6;
      if (splitPayment) {
        const advance = roundToHundredRupees(totalMinor * (0.25 + rng() * 0.15));
        recordPayment('IN', advance, bookedOn, weighted(rng, PAYMENT_MODES));
        const balanceOn = latest(
          addDays(bookedOn, 4),
          earliest(addDays(startDate, -int(rng, 8, 20)), addDays(TODAY, -1)),
        );
        recordPayment('IN', totalMinor - advance, balanceOn, weighted(rng, PAYMENT_MODES));
      } else {
        recordPayment('IN', totalMinor, bookedOn, weighted(rng, PAYMENT_MODES));
      }
      bookingStatus = 'PAID_IN_FULL';
    } else {
      const advance = roundToHundredRupees(totalMinor * (0.2 + rng() * 0.25));
      recordPayment('IN', advance, bookedOn, weighted(rng, PAYMENT_MODES));
      balanceDueOn = addDays(startDate, -int(rng, 7, 21));
      bookingStatus = 'PART_PAID';
    }

    const receivedMinor = paymentsForBooking.reduce(
      (sum, payment) =>
        sum + (payment.direction === 'IN' ? payment.amountMinor : -payment.amountMinor),
      0,
    );

    const lastPaymentDate = paymentsForBooking.reduce<IsoDate>(
      (newest, payment) => latest(newest, payment.paidOn),
      bookedOn,
    );

    bookings.push({
      bookingRef,
      tourId,
      partyName,
      leadTravellerId: lead.travellerId,
      paxCount,
      channel: weighted(rng, CHANNELS),
      status: bookingStatus,
      bookedOn,
      grossMinor,
      discountMinor,
      totalMinor,
      receivedMinor,
      ...(balanceDueOn === undefined ? {} : { balanceDueOn }),
      ...(chance(rng, 0.3)
        ? {
            remarks: pick(rng, [
              'Twin sharing requested, no pairing with other parties.',
              'Wants the front seats on the coach — carsick otherwise.',
              'Booked on the strength of last year’s trip. Handle personally.',
              'Invoice to be raised in the company name, GSTIN on file.',
              'Flight lands two hours before the meeting time — arrange the pickup.',
              'Asked for a ground-floor room wherever the hotel has one.',
              'Balance promised after the salary credit on the 20th.',
              'Vegetarian kitchen only. Confirmed with every hotel on the route.',
            ]),
          }
        : {}),
      sourceUpdatedAt: ctx.stamp(lastPaymentDate),
    });

    payments.push(...paymentsForBooking);

    // --- the people on the manifest ---------------------------------------

    party.forEach((member, index) => {
      const isLead = index === 0;
      const isChild = !isLead && isFamily && chance(rng, 0.3);
      const age = isChild ? int(rng, 7, 17) : int(rng, 21, 71);
      const relationToLead = isLead
        ? 'Self'
        : isFamily
          ? pick(rng, RELATIONS_FAMILY)
          : pick(rng, RELATIONS_GROUP);
      const emergency = makePerson(ctx, member.person.surname);
      const idProofType: IdProofType = template.international
        ? 'PASSPORT'
        : weighted(rng, [
            ['AADHAAR', 60],
            ['PASSPORT', 20],
            ['DRIVING_LICENCE', 12],
            ['VOTER_ID', 8],
          ] as const);

      travellers.push({
        travellerId: member.travellerId,
        tourId,
        bookingRef,
        fullName: `${member.person.firstName} ${member.person.surname}`,
        phone: ctx.phone(),
        ...(chance(rng, 0.72) && !isChild
          ? { email: emailFor(ctx, member.person, member.travellerId) }
          : {}),
        gender: member.person.gender,
        dateOfBirth: addDays(TODAY, -(age * 365 + int(rng, 0, 364))),
        partyRole: isLead ? 'LEAD' : 'MEMBER',
        relationToLead,
        city: home.city,
        state: home.state,
        mealPreference: weighted(rng, MEALS),
        medicalNotes: chance(rng, 0.14) ? pick(rng, MEDICAL_NOTES) : null,
        idProofType,
        ...(template.permitRequired
          ? {
              permitNumber: `${slug}/${String(yearOf(startDate)).slice(2)}/${int(rng, 1000, 9999)}`,
            }
          : {}),
        emergencyContactName: `${emergency.firstName} ${emergency.surname}`,
        emergencyContactPhone: ctx.phone(),
        preferredLanguage: chance(rng, 0.55) ? home.language : 'English',
        ...(template.trek ? { fitnessCleared: chance(rng, 0.85) } : {}),
        sourceUpdatedAt: ctx.stamp(earliest(addDays(bookedOn, int(rng, 0, 20)), TODAY)),
      });
    });
  }

  // --- who runs it ---------------------------------------------------------

  const regionLeaders = leaderPool.filter((staffId) =>
    (LEADER_REGIONS[staffId] ?? []).includes(template.region),
  );
  const leadLeader = regionLeaders.length > 0 ? pick(rng, regionLeaders) : pick(rng, leaderPool);
  const assignedOn = addDays(startDate, -int(rng, 25, 70));

  const tourStaff: CrmTourStaff[] = [
    {
      tourId,
      staffId: leadLeader,
      dutyRole: 'LEAD_LEADER',
      assignedOn,
      sourceUpdatedAt: ctx.stamp(earliest(addDays(assignedOn, int(rng, 0, 30)), TODAY)),
    },
  ];

  // Big groups get a second pair of hands; small ones never do.
  if (seatsSold >= 14) {
    const assistantPool = leaderPool.filter((staffId) => staffId !== leadLeader);
    const assistant = pick(rng, assistantPool);
    const assistantOn = addDays(startDate, -int(rng, 10, 24));
    tourStaff.push({
      tourId,
      staffId: assistant,
      dutyRole: 'ASSISTANT_LEADER',
      assignedOn: assistantOn,
      sourceUpdatedAt: ctx.stamp(earliest(assistantOn, TODAY)),
    });
  }

  // Refund cases belong to the desk. Leaders do not handle money going out.
  if (calledOff) {
    const owner = pick(rng, deskPool);
    const ownedFrom = addDays(TODAY, -int(rng, 4, 20));
    tourStaff.push({
      tourId,
      staffId: owner,
      dutyRole: 'DESK_OWNER',
      assignedOn: ownedFrom,
      sourceUpdatedAt: ctx.stamp(ownedFrom),
    });
  }

  // --- the departure itself ------------------------------------------------

  const notes = calledOff
    ? 'Departure pulled. Do not resell. Refund status is per booking, not per tour.'
    : status === 'ON_TOUR'
      ? `Group is out now — day ${daysBetween(startDate, TODAY) + 1} of ${duration}. Leader reporting daily.`
      : status === 'CONFIRMED'
        ? template.permitRequired
          ? `Permit file due ${addDays(startDate, -10)}. ${seatsTotal - seatsSold} of ${seatsTotal} seats still open.`
          : `${seatsTotal - seatsSold} of ${seatsTotal} seats still open.`
        : status === 'RETURNED'
          ? 'Back home. Vendor invoices being reconciled before close-out.'
          : 'Settled and filed.';

  const tour: CrmTour = {
    tourId,
    packageCode: template.packageCode,
    title: template.title,
    destination: template.destination,
    region: template.region,
    startDate,
    endDate,
    boardingCity: template.boardingCity,
    meetingPoint: template.meetingPoint,
    timezone: template.timezone,
    // The operator bills in rupees regardless of where the tour runs, which is
    // why the three foreign packages still carry INR.
    currency: 'INR',
    status,
    style: template.trek ? 'TREK' : 'GROUP_TOUR',
    sellingMode: chance(rng, 0.12) ? 'CUSTOMISED' : 'FIXED_DEPARTURE',
    pricePerSeatMinor,
    seatsTotal,
    seatsSold,
    itinerary: buildItinerary(template, startDate),
    ...(status === 'RETURNED' ? { settlementDueOn: addDays(endDate, 21) } : {}),
    ...(calledOff
      ? {
          calledOffOn: earliest(addDays(startDate, -int(rng, 6, 25)), addDays(TODAY, -1)),
          calledOffReason: pick(rng, CALL_OFF_REASONS),
        }
      : {}),
    notes,
    sourceUpdatedAt: ctx.stamp(
      earliest(addDays(startDate, -int(rng, 0, 40)), addDays(TODAY, -int(rng, 0, 4))),
    ),
  };

  return { tour, tourStaff, bookings, payments, travellers };
}

/**
 * The core fixture plus `DEPARTURE_COUNT` generated departures.
 *
 * Departures are laid out on a fixed ladder of start dates running from
 * February 2026 to January 2027, so the status mix falls out of the calendar
 * rather than being declared: anything finished long ago is CLOSED, anything
 * finished recently is RETURNED, anything spanning `TODAY` is ON_TOUR and
 * anything ahead is CONFIRMED. Four indexes are pulled out and called off,
 * and four are pinned to straddle today, because leaving those to chance
 * would sometimes produce a dataset with none of either.
 */
export function buildBulkFixture(seed: number = DEFAULT_SEED): CrmFixture {
  const ctx = createContext(seed);

  const extraStaff: CrmStaff[] = [
    ...EXTRA_LEADERS.map((leader) => ({
      staffId: leader.staffId,
      staffCode: leader.staffCode,
      fullName: leader.fullName,
      role: 'TOUR_LEADER' as const,
      phone: leader.phone,
      loginEmail: `${leader.fullName
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .split(' ')
        .join('.')}@sharmatravels.co.in`,
      basedIn: leader.basedIn,
      languages: leader.languages,
      joinedOn: leader.joinedOn,
      active: true,
      sourceUpdatedAt: ctx.stamp(addDays(TODAY, -int(ctx.rng, 1, 120))),
    })),
    ...EXTRA_DESK,
  ];

  const staff: CrmStaff[] = [...CORE_FIXTURE.staff, ...extraStaff];
  const leaderPool = staff
    .filter((person) => person.role === 'TOUR_LEADER')
    .map((person) => person.staffId);
  const deskPool = staff
    .filter((person) => person.role === 'DESK_EXECUTIVE')
    .map((person) => person.staffId);

  /** Pinned to straddle `TODAY`, so the field surface always has live work. */
  const ON_TOUR_INDEXES = new Set([29, 30, 31, 32]);
  /** Pinned to CALLED_OFF — one historic, three ahead of today. */
  const CALLED_OFF_INDEXES = new Set([9, 35, 41, 46]);

  const tours: CrmTour[] = [];
  const tourStaff: CrmTourStaff[] = [];
  const bookings: CrmBooking[] = [];
  const payments: CrmPayment[] = [];
  const travellers: CrmTraveller[] = [];

  // How many departures of each package have gone out, so the id's trailing
  // number means what it looks like it means.
  const departuresSoFar = new Map<string, number>();

  for (let index = 0; index < DEPARTURE_COUNT; index += 1) {
    const startDate = ON_TOUR_INDEXES.has(index)
      ? addDays(TODAY, -(1 + (index - 29) * 2))
      : addDays(TODAY, -218 + index * 7 + int(ctx.rng, 0, 2));

    const template = selectPackage(index * 3, Number(startDate.slice(5, 7)), departuresSoFar);

    const departureNumber = (departuresSoFar.get(template.packageCode) ?? 0) + 1;
    departuresSoFar.set(template.packageCode, departureNumber);

    const departure = buildDeparture(
      ctx,
      template,
      departureNumber,
      startDate,
      CALLED_OFF_INDEXES.has(index) ? 'CALLED_OFF' : null,
      leaderPool,
      deskPool,
    );

    tours.push(departure.tour);
    tourStaff.push(...departure.tourStaff);
    bookings.push(...departure.bookings);
    payments.push(...departure.payments);
    travellers.push(...departure.travellers);
  }

  // Core first, deliberately: the six hand-written departures stay at the top
  // of an unsorted list, where a QA following the docs will look for them.
  return {
    agency: CORE_FIXTURE.agency,
    staff,
    tours: [...CORE_FIXTURE.tours, ...tours],
    tourStaff: [...CORE_FIXTURE.tourStaff, ...tourStaff],
    bookings: [...CORE_FIXTURE.bookings, ...bookings],
    payments: [...CORE_FIXTURE.payments, ...payments],
    travellers: [...CORE_FIXTURE.travellers, ...travellers],
  };
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

/**
 * The generated fixture if `pnpm seed:bulk` has been run, `null` otherwise.
 *
 * This is the whole interface between the bulk seed and the rest of the repo:
 * boot does `readGeneratedBulkFixture() ?? CORE_FIXTURE` and nothing else
 * changes. Deleting `fixtures/bulk.generated.json` is how you go back.
 */
export function readGeneratedBulkFixture(): CrmFixture | null {
  if (!existsSync(BULK_FIXTURE_PATH)) {
    return null;
  }
  // A file that exists but will not parse is a broken seed, not an absent one.
  // Throwing here is correct: booting on core data while the QA believes they
  // are looking at fifty departures is the worse outcome.
  return JSON.parse(readFileSync(BULK_FIXTURE_PATH, 'utf8')) as CrmFixture;
}

// ---------------------------------------------------------------------------
// `pnpm seed:bulk`
// ---------------------------------------------------------------------------

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = key(row);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

function formatRow(label: string, value: string): string {
  return `  ${label.padEnd(16)}${value.padStart(8)}`;
}

function run(): void {
  const fixture = buildBulkFixture();
  const generatedTours = fixture.tours.length - CORE_FIXTURE.tours.length;
  const generatedTravellers = fixture.travellers.length - CORE_FIXTURE.travellers.length;
  const byStatus = countBy(fixture.tours, (tour) => tour.status);

  writeFileSync(BULK_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  const lines = [
    '',
    'seed:bulk — the six core departures, plus volume',
    '',
    formatRow('departures', String(fixture.tours.length)),
    formatRow('travellers', String(fixture.travellers.length)),
    formatRow('bookings', String(fixture.bookings.length)),
    formatRow('receipts', String(fixture.payments.length)),
    formatRow('staff', String(fixture.staff.length)),
    '',
    `  ${generatedTours} departures and ${generatedTravellers} travellers were generated;`,
    `  the ${CORE_FIXTURE.tours.length} hand-written ones are untouched and still at the top of the list.`,
    '',
    `  by status      ${(['CONFIRMED', 'ON_TOUR', 'RETURNED', 'CLOSED', 'CALLED_OFF'] as const)
      .map((status) => `${status} ${byStatus[status] ?? 0}`)
      .join('   ')}`,
    '',
    `  seed ${DEFAULT_SEED} — frozen, so this file is byte-identical on every machine.`,
    `  written to ${fileURLToPath(BULK_FIXTURE_PATH)}`,
    '',
    '  Next: pnpm dev re-seeds crm.sqlite from that file and pushes all',
    `  ${fixture.tours.length} departures into your Kaafil tenant. That is ${fixture.tours.length} trip upserts,`,
    `  ${fixture.tours.length} manifests and ${fixture.tours.length} journeys to build, so give it several minutes`,
    '  and expect the trips to show up before they are usable — a trip is',
    '  not workable until journey.waitUntilReady returns for it.',
    '',
    '  Delete the generated file to go back to the six core departures.',
    '',
  ];

  console.log(lines.join('\n'));
}

// tsx passes the script it was handed as argv[1]; importing this module from
// server code must not re-run the generator.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
