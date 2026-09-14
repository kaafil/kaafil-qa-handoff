# The ingest contract — verified, not remembered

Every signature below was read out of the **published** `kaafil-js@0.5.0` type
declarations — the version this repo pins. Do not invent a field, rename a
method, or "improve" a call shape. If something you need is not here, read the
installed `.d.ts` or ask the docs MCP — do not guess.

This file is the ground truth for `server/ingest.ts` and `fixtures/*`.

Optional fields are marked `?`. Every option type below also accepts
`signal?: AbortSignal`, which is not repeated on each one.

## Non-negotiables

1. **`KaafilResponse<T>` is `T & { meta }`** — an intersection. There is no
   `.data`, `.body` or `.result`. Read the resource directly:
   `session.accessToken`, `trip.name`, `anything.meta.serverTime`.
2. **Always send `sourceUpdatedAt`, carrying the *fixture's own* timestamp.**
   Never `new Date()` at call time. Defaulting it makes every write look like
   the newest write and silently defeats the engine's staleness check on
   out-of-order delivery.

   **The compiler stopped enforcing this in 0.5.0, so it is now yours to
   hold.** It is still required on `agencies.upsert`, `trips.upsert`,
   `trips.managers.upsert` and `agencyAdmins.upsert`. It is OPTIONAL on:

   - `trips.travellers.pushManifest`'s per-traveller entries — the wire made it
     optional for this one shape, and **the server stamps its own clock when
     you omit it**, which is exactly the failure above;
   - `vendors.upsert`, for the same reason;
   - `trips.managers.assign`, where it was always optional.

   Omitting it now typechecks cleanly. That is the whole hazard: a future edit
   that deletes the line from the manifest push will compile, pass review, and
   quietly switch your rows to server-stamped time.
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
  crmVersion?: number,        // accepted but NOT persisted — informational
                              // only, never used for conflict resolution
  metadata?: { [key: string]: unknown },   // free-form, echoed back verbatim
  idempotencyKey?: string,
});

// 5 — the roster
kaafil.trips.travellers.pushManifest({
  tripRef: string,            // your externalTripId or Kaafil's id
  travellers: [{
    externalTravellerId: string,
    sourceUpdatedAt?: DateTimeInput,  // OPTIONAL here — send it anyway, see
                                      // non-negotiable 2
    fullName?: string,
    phone?: string | null,
    email?: string | null,
    gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | null,
    dietary?: string | null,
    medicalFlag?: boolean,
    locale?: string | null,
    bookingStatus?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED',
    party?: {
      ref: string,
      kind?: 'FAMILY' | 'COUPLE' | 'FRIENDS' | 'CORPORATE' | 'OTHER',
      label?: string,
    } | null,
    optedOut?: { email?: boolean, sms?: boolean, whatsapp?: boolean } | null,
  }],
  mode?: 'merge' | 'replace',
  idempotencyKey?: string,
});

// 6 — staff onto trips
kaafil.trips.managers.assign({
  tripRef: string,
  managerRef: string,
  isLead?: boolean,
  role?: 'MANAGER' | 'COORDINATOR',
  sourceUpdatedAt?: DateTimeInput,   // optional, and always has been
});

// 7 — block until the journey exists
kaafil.journey.waitUntilReady({
  tripRef: string,
  timeoutMs?: number,         // ~60s default
  pollIntervalMs?: number,
});
```

**One behavioural rule about `party` that no signature shows you:** Kaafil
derives its own groupings only when **no entry in the push mentions `party` at
all**. Send it on one traveller and you have taken ownership of grouping for
that whole manifest — every other traveller is then solo unless you say
otherwise.

## Sessions and share links (used by `server/routes/`)

```ts
// Manager session — hand the pair to the browser, never the API key.
const session = await kaafil.auth.mintManagerToken({ managerRef });
session.accessToken; session.refreshToken; session.agencyId;
// Also on the response, and easy to drop on the floor:
session.expiresAt; session.expiresIn; session.tokenType; session.sessionId;

// Agency-admin session
const admin = await kaafil.auth.mintAgencyAdminToken({ agencyAdminRef });

// Traveller share link — `create`, NOT `mint`. BOTH refs are optional:
// omit `travellerRef` for a whole-trip family link.
const link = await kaafil.shareTokens.create({
  tripRef?: string,
  travellerRef?: string,
  config?: { sections?: { /* 14 keys */ } },  // NON-INHERITING: supply it and
                                              // every key you leave unset is OFF
  expiresAt?: DateTimeInput,  // mutually exclusive with ttlDays
  ttlDays?: number,           // omit both for Kaafil's own default
});
```

`refreshToken` is shown **exactly once**. Do not log it.

**Carry `expiresAt` through to the browser.** It is what both the SDK's
credential config and the UIKit's session open actually want, and a reader
following only the three fields on the line above will drop it — which is how
you end up unable to tell an expired cached credential from a broken one.

## Browser side, for the app

```ts
import { KaafilUIKitProvider } from 'kaafil-react-uikit/core';
```

Credential shape decides the persona — there is no `persona` prop:

- staff: `accessToken` + `refreshToken` + `agencyRef`
- traveller: `shareToken`
- deferred: `credentialResolver`

Subpaths only — there is **no bare `kaafil-react-uikit` export**:
`/core`, `/manager`, `/admin`, `/traveller`, `/offline`, `/styles`, `/testing`.

`import 'kaafil-react-uikit/styles'` exactly once, in the app entry.

**Set `buildShareUrl` on the provider if you touch share links.** Kaafil returns
a token, never a URL — the traveller page is on *your* domain, and without this
the desk shows operators a bare UUID:

```tsx
<KaafilUIKitProvider
  buildShareUrl={(token) => `${window.location.origin}/share/${token}`}
  {...rest}
/>
```

`/offline` is the host's half of offline, and neither piece is optional if you
want milestone 10 to work:

```ts
import {
  withCachedCredential,          // survives a reload with no network
  localStorageCredentialStore,
  installKaafilOfflineShell,     // call from your own src/sw.ts
} from 'kaafil-react-uikit/offline';
```

`withCachedCredential` falls back to the cached credential **only when the mint
request never completed** — a 401 or a 500 from a reachable server still
surfaces. It stores and restores; it never judges expiry, which reaches you
through the provider's `onSessionExpired`.
