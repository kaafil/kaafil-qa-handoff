# The ingest contract — verified, not remembered

Every signature below was read out of the **published** `kaafil-js@0.1.0-beta.7`
type declarations. Do not invent a field, rename a method, or "improve" a
call shape. If something you need is not here, read the installed `.d.ts`
or ask the docs MCP — do not guess.

This file is the ground truth for `server/ingest.ts` and `fixtures/*`.

## Non-negotiables

1. **`KaafilResponse<T>` is `T & { meta }`** — an intersection. There is no
   `.data`, `.body` or `.result`. Read the resource directly:
   `session.accessToken`, `trip.name`, `anything.meta.serverTime`.
2. **`sourceUpdatedAt` is required on every upsert** and must carry the
   *fixture's own* timestamp. Never `new Date()` at call time. Defaulting it
   makes every write look like the newest write and silently defeats the
   engine's staleness check on out-of-order delivery. The only exception is
   `trips.managers.assign`, where it is genuinely optional.
3. **Money is an integer count of paise** in a `*Minor` field. No floats.
4. **Creating a trip is `upsert`.** There is no `createTrip`.
5. **The API key never leaves the server.** No `VITE_` prefix, ever.

## Order matters

Each step depends on the one above it.

```
1  agencies.upsert
2  trips.managers.upsert        ← manager entities. NOT trip-scoped,
                                  despite living under `trips`.
3  agencyAdmins.upsert
4  trips.upsert
5  trips.travellers.pushManifest
6  trips.managers.assign
7  journey.waitUntilReady        ← a trip is NOT workable until this returns
```

## Signatures

```ts
// 1 — the agency the trips belong to
kaafil.agencies.upsert({
  agencyRef: string,          // YOUR id for the agency
  name: string,
  sourceUpdatedAt: DateTimeInput,
});

// 2 — manager entities (POST /api/v1/managers; not trip-scoped)
kaafil.trips.managers.upsert({
  externalAgencyId: string,
  fullName: string,
  externalManagerId?: string,
  phone?: string | null,
  sourceUpdatedAt: DateTimeInput,
});

// 3 — desk staff
kaafil.agencyAdmins.upsert({
  externalAgencyId: string,
  fullName: string,
  externalAgencyAdminId?: string,
  phone?: string | null,
  sourceUpdatedAt: DateTimeInput,
});

// 4 — the trip itself
kaafil.trips.upsert({
  externalTripId: string,     // YOUR id — the trip's identity
  externalAgencyId: string,
  code: string,
  name: string,
  startDate: DateTimeInput,
  endDate: DateTimeInput,
  sourceUpdatedAt: DateTimeInput,
  eventType?: 'TRIP' | 'TREK',
  tripMode?: 'GROUP' | 'PERSONALIZED',
  status?: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'POSTPONED' | 'CANCELLED',
  timezone?: string,          // the trip's OWN timezone, not the viewer's
  currency?: string,
  segments?: readonly UpsertTripSegmentInput[],
  idempotencyKey?: string,
});

// 5 — the roster
kaafil.trips.travellers.pushManifest({
  tripRef: string,            // your externalTripId or Kaafil's id
  travellers: [{
    externalTravellerId: string,
    sourceUpdatedAt: string,
    fullName?: string,
    phone?: string | null,
    email?: string | null,
    gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | null,
    dietary?: string | null,
    medicalFlag?: boolean,
    locale?: string | null,
  }],
  mode?: 'merge' | 'replace',
});

// 6 — staff onto trips
kaafil.trips.managers.assign({
  tripRef: string,
  managerRef: string,
  isLead?: boolean,
  role?: 'MANAGER' | 'COORDINATOR',
  sourceUpdatedAt?: DateTimeInput,   // optional HERE only
});

// 7 — block until the journey exists
kaafil.journey.waitUntilReady({ /* WaitUntilJourneyReadyOptions */ });
```

## Sessions and share links (used by `server/routes/`)

```ts
// Manager session — hand the pair to the browser, never the API key.
const session = await kaafil.auth.mintManagerToken({ managerRef });
session.accessToken; session.refreshToken; session.agencyId;

// Agency-admin session
const admin = await kaafil.auth.mintAgencyAdminToken({ agencyAdminRef });

// Traveller share link — `create`, NOT `mint`.
const link = await kaafil.shareTokens.create({ tripRef, travellerRef });
```

`refreshToken` is shown **exactly once**. Do not log it.

## Browser side, for the app

```ts
import { KaafilUIKitProvider } from 'kaafil-react-uikit/core';
```

Credential shape decides the persona — there is no `persona` prop:

- staff: `accessToken` + `refreshToken` + `agencyRef`
- traveller: `shareToken`
- deferred: `credentialResolver`

Subpaths only — there is **no bare `kaafil-react-uikit` export**:
`/core`, `/manager`, `/admin`, `/traveller`, `/styles`, `/testing`.

`import 'kaafil-react-uikit/styles'` exactly once, in the app entry.
