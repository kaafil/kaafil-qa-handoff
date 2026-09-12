# The exercise

Ten milestones. The first four are setup; the last six are the real work. You
stamp each one as you reach it, and the timings become the report.

```sh
pnpm milestone 4          # stamp milestone 4, right now
pnpm milestone report     # print everything, at the end
```

Stamp honestly and stamp *when it happens*, not in a batch at the end. A
backfilled log is worth nothing. If you get a milestone wrong, stamp the next
one anyway and say so in the report.

Everything you need is at **<https://developer.kaafil.in>**, plus the skills and
docs MCP you installed at step zero. Reading library source code is allowed but
it is a *finding* — note it.

---

## First: the one thing everybody gets wrong

Kaafil has three browser personas.

| Persona | Who they are | Where they are |
|---|---|---|
| **manager** | The tour leader travelling with the group | On a phone, in a valley, with no signal |
| **agencyAdmin** | The desk executive in the Pune office | On a desktop, on wifi |
| **share** | A traveller or their family | On a phone, not logged in to anything |

There is **no `persona` prop**. There is no `mode` prop. You cannot tell Kaafil
which persona to be.

**The shape of the credential you hand the provider decides the persona**, and
nothing else does:

```tsx
// staff — manager OR agencyAdmin
<KaafilUIKitProvider accessToken={...} refreshToken={...} agencyRef={...}>

// traveller
<KaafilUIKitProvider shareToken={...}>

// either of the above, fetched lazily
<KaafilUIKitProvider credentialResolver={async () => { /* ... */ }}>
```

Note that manager and agencyAdmin take the *identical* three fields. The
difference is inside the token itself — the provider reads it out of the access
token and configures the whole surface accordingly. So which persona you get is
decided entirely by **which server endpoint minted the token**, which is decided
by **which CRM route the browser called**. Trace that chain once, early; it
makes the rest of the exercise obvious.

This design is deliberate: a persona prop would mean a browser could ask for a
persona it was not issued, and the capability system would be advisory rather
than real.

---

## The three surfaces and where their credentials come from

Each persona has exactly one top-level component. You are not expected to
assemble screens from parts — start with the whole surface and take it apart
later if you want to.

| Persona | Import | CRM route that mints it | What the server calls |
|---|---|---|---|
| agencyAdmin | `KaafilAgencyWorkspace` from `kaafil-react-uikit/admin` | `POST /api/admin-session` | `kaafil.auth.mintAgencyAdminToken({ agencyAdminRef })` |
| manager | `KaafilManagerApp` from `kaafil-react-uikit/manager` | `POST /api/session` | `kaafil.auth.mintManagerToken({ managerRef })` |
| share | `KaafilShareView` from `kaafil-react-uikit/traveller` | `POST /api/share-link` | `kaafil.shareTokens.create({ tripRef, travellerRef })` |

Those three paths are declared in `shared/crm-api.ts` as `KAAFIL_API`, and the
server registers them from that same constant — so import it rather than
typing a path literal, and a rename can never leave you calling a route that
does not exist.

Three rules about importing that will save you an hour:

- **There is no bare `kaafil-react-uikit` import.** Only the subpaths:
  `/core`, `/manager`, `/admin`, `/traveller`, `/styles`, `/testing`. If you
  write `from 'kaafil-react-uikit'` it will simply not resolve.
- **`import 'kaafil-react-uikit/styles'` exactly once**, in your app entry. The
  CSS is opt-in and never injects itself — that is so it cannot fight with the
  CRM's own stylesheet behind your back.
- **`/core` is where the provider and all the hooks live.** Every persona uses
  the same hooks; there is no `useManagerRooming` and no `useAdminRooming`,
  just `useRooming`.

The CRM already knows who is logged in (`app/src/crm/` has a fake login and a
staff list). Sharma Travels' tour leaders are `ST-01` … `ST-04`; its desk
executives are `ST-05` and `ST-06`. Mapping a CRM staff row to the right Kaafil
session endpoint is your first real design decision.

---

## The ten milestones

### Setup — milestones 1 to 4

These measure the cost of getting to a standing start. They should be fast; if
one of them is not, that is the most interesting data in the whole exercise.

**1 — Cloned and installed.**
`pnpm install` finished without you having to fix anything.
```sh
pnpm milestone 1
```

**2 — API key in `.env`.**
You have created a key in the partner console and pasted it into `.env`.
Stamp this when the key is *in the file*, not when you first opened the console
— the gap between those two moments is part of what we are measuring, and you
should mention it in the report if it was awkward.

**3 — CRM running and seeded.**
`pnpm dev` boots, the server reports a clean re-seed, and you can browse Sharma
Travels Admin at <http://localhost:5173>: the trip list has six departures, a
trip detail page opens, the traveller and staff lists render. Still zero Kaafil
code.

**4 — Trips visible in Kaafil.**
The boot ingest completed and you have confirmed it from the *other* side — log
in to <https://platform.kaafil.in> and see Sharma Travels' six departures,
their manifests, and their assigned staff in your own tenant. Confirming it in
the console rather than trusting the server log is the point; you are checking
that the data actually landed.

### Integration — milestones 5 to 10

**5 — The desk console renders.**
A route inside the CRM (`app/src/kaafil/` is yours; wire it into the CRM's
router wherever makes sense) that:

- asks your server for an agencyAdmin session
- mounts `KaafilAgencyWorkspace` inside `KaafilUIKitProvider`
- shows the real Sharma Travels trips, not an empty state or an error

Done means: you can open a departure in the desk console and see its manifest.

**6 — The manager surface renders.**
Same again, but `KaafilManagerApp` with a *manager* session. Pick a tour leader
who actually has work to do — `ST-02` is on the Spiti departure, which is
mid-tour. Done means you can see that trip's day and its people.

This surface needs a storage adapter for its offline engine. You supply it from
the SDK's browser entry:

```tsx
import { createIndexedDbStorageAdapter } from 'kaafil-js/client';
```

`KaafilManagerApp` also takes **five required host callbacks**, and it will not
compile without all five. `KaafilAgencyWorkspace` has none, so the asymmetry is
invisible until the compiler tells you — here is the list up front, and what
each one is actually for:

| Prop | Fires when | What a `() => {}` costs you |
|---|---|---|
| `onNavigateModule(key)` | a Today card links to `manifest`, `rooming`, `checklist`, `docs` or `closing-day` | the card becomes a dead end — the UIKit ships no router (it never navigates for you), so the host owns every destination |
| `onCollectFromGroup(groupId)` | a booking group's "Collect" CTA is tapped | same — there is no group-level collect endpoint, so the host resolves a group into whatever per-traveller flow it wants |
| `onVendorSelect(tripVendorId)` | a vendor row is tapped | same — a dead row |
| `onLogExpense()` | an expense has **already been written** by the surface's own sheet | only the host's toast/analytics. The write is not yours to do |
| `onCollectPayment()` | a collection has **already been recorded** | same |

The two money ones read like they gate spending, and they do not: the FAB opens
the UIKit's own sheet, which writes through `useExpenses()` / `useCollections()`
and fires the callback *after* the write succeeds. They are completion hooks.
The first three are the ones where a stub silently breaks a manager's flow, so
wire those to something real before you judge the surface.

They are required rather than defaulted because each forwards to a child
composite's own required prop, and the surface will not stub a child's required
callback behind a no-op on your behalf.

Done also means you have **no console errors and no console warnings** at
steady state. A clean console is a product requirement, not a nicety — if you
cannot get one, that is a bug report.

**7 — A traveller share link opens.**
Your server mints a share token for a real traveller on a real trip; the
browser opens `KaafilShareView` with it, unauthenticated, ideally in a private
window to prove no staff session is involved.

Also try a token for a traveller on the *cancelled* departure
(`TR-2609-MEGHALAYA`) and one for a trip that has closed out
(`TR-2608-KERALA`), and note what you see. Then read the share-link section of
[02-what-to-look-for.md](./02-what-to-look-for.md) — a share link that shows
nothing may be behaving perfectly, and knowing the difference matters.

**8 — Branded to the CRM's palette.**
Sharma Travels Admin is corporate blue and grey with tight, dense rows and
system fonts. Make Kaafil's surfaces belong to it.

Done means the honest screenshot test: put a CRM screen next to a Kaafil screen
and show them to somebody who has not seen either. If they can point at the
seam, you are not there yet.

Do this with `--kf-*` token overrides in `@layer kaafil-ui-overrides`, and see
[02-what-to-look-for.md](./02-what-to-look-for.md) for the twelve tokens that
should get you most of the way. **If you find yourself writing a selector that
targets a Kaafil class name to force something, stop and write that down** —
each one is a gap in the theming system and is exactly the kind of finding this
exercise exists to produce.

**9 — A slot or a custom panel.**
Bend the surface, don't just skin it. One of:

- replace a section of the share view with your own rendering, using
  `renderSection`
- swap one of a surface's internal components via its `components` prop
- drop one level down the ladder: stop using the whole surface for one screen,
  call the `/core` hooks directly, and draw that screen in Sharma Travels'
  own house style

Done means the CRM shows something Kaafil does not ship, driven by Kaafil's
data. Note which rung of the ladder you had to drop to, and whether you
*wanted* to drop that far.

**10 — An offline write survives a reload.**
The one that matters most. On the manager surface:

1. Open the mid-tour Spiti departure.
2. Kill the network — DevTools → Network → Offline, or turn wifi off.
3. Do real work: tick a checklist item, log an expense, change a rooming
   assignment. Do several things, not one.
4. **Reload the page, still offline.** Your work must still be there.
5. Bring the network back. Watch it sync.
6. Reload once more, online, and confirm the server agrees.

Done means every write survived both reloads and landed server-side. If any
write is lost at step 4, stop and write that up immediately — it is the highest
severity bug this product can have, and we want it before you do anything else.

**Step 4 has two host-side prerequisites.** Neither is Kaafil's job, both were
missing from an earlier version of this document, and without them step 4 is
not merely hard but impossible — so read this before you decide you have found
a bug.

### One: the app shell

This CRM already has one, and the distinction it marks is worth understanding.

Kaafil makes your **data** survive: the write goes to a durable outbox in
IndexedDB and the read comes back from the snapshot store, both of which
outlive a reload. It does nothing about your **application** — the HTML
document, your JS, your CSS. Those come off the network like any other page.
So on a kit integration with no service worker, step 4 gets the browser's
offline error page every time, and the queued writes sit safely in IndexedDB
behind a document that will not open. The data was never lost; you just cannot
get to it.

Closing that gap is a service worker, and it belongs to the host, because it
has to cache **your** build output under **your** deploy and revalidation
strategy. The kit ships none and registers nothing, deliberately. Sharma
Travels has one at `app/public/sw.js`, registered from `app/src/main.tsx` —
read it, it is about sixty lines, and it is the whole of what the kit is
asking you to own. A real CRM would generate a better one from a config line
(`vite-plugin-pwa`, `next-pwa`, anything on Workbox).

This is pre-existing CRM infrastructure, like the login screen and the
stylesheet — not something you have to build. Sharma Travels' own staff-roster
fetch has a last-known-good fallback for the same reason (`app/src/crm/api.ts`):
the CRM renders an error page if the roster fetch fails, so without it the app
stops at "Could not reach the Sharma Travels server" and no route renders at
all, Kaafil's included.

### Two: a credential that survives the reload

This one IS yours, and it is in `app/src/kaafil/`.

Your session route mints a Kaafil token over the network. Offline, that call
fails, and the surface never opens — you get your own "could not open" chrome
with the writes sitting intact in IndexedDB behind it. The kit does not solve
this for you on purpose: **it never persists a credential**, because where a
token lives, how long it is kept and what clears it are host security
decisions, not a design system's.

So cache the minted credential and fall back to it when the mint call cannot
complete. Roughly thirty lines around your existing resolver. Two things worth
getting right, and worth saying in your report if they bit you:

- Fall back only when the request **never completed**. A 401 or a 500 from a
  reachable server is a real failure and must still surface.
- A cached access token still expires, and offline it cannot be refreshed. A
  manager who has been offline longer than the token's life will not get in.
  Note how long that window turned out to be.

### What step 4 actually looks like right now

With both in place: the page reloads offline, the CRM boots, the field surface
opens, your trip list is there, you can open the departure, and its screens
render what they last knew — the checklist with its sections, its progress
figure and every item.

That includes work you CREATE offline — a new checklist item appears the
moment you add it, survives the reload, and is swapped for the server's own
row when it lands, so it is never shown twice. Nothing about the screen should
tell you whether you were connected when you did it.

So judge step 4 by the screen. If something you did offline is missing from
it, that is a bug and we want it — not a limitation to work around.

The sync badge and the sync centre are still worth watching, because they are
what tell you the difference between "saved here" and "landed there", and
`Application → IndexedDB` in DevTools is the ground truth if you want to be
certain.

If a write is genuinely **lost** — gone from the outbox after the reload, or
never landing at step 6 — that is the severe bug above and unaffected by any of
this. Report it immediately.

### Finally

```sh
pnpm milestone report
```

This prints your timings, the versions you ran against, which plane you were on
(test or live), and a copy of the debrief template. Fill in the debrief — see
[03-report-template.md](./03-report-template.md) — and send the whole block
back privately.

---

## Ground rules

**Do not modify `app/src/crm/`.** Those screens are the existing product you
are integrating into. Fitting Kaafil around them *is* the test; changing them to
suit Kaafil is cheating, and it also quietly hides the theming problems we most
want to find. If you genuinely cannot proceed without touching a CRM file, that
is a finding — note it, then do the smallest change you can and say what it was.

**All your code goes in `app/src/kaafil/`,** which is empty on purpose, plus
three small wires into the CRM that we expect and that do not count as
modifying it:

1. the route registration in the CRM's router,
2. the single `import 'kaafil-react-uikit/styles'` in the entry file,
3. **nav entries in `app/src/crm/Shell.tsx`** so a human can actually reach
   what you built.

That third one was missing from an earlier version of these rules, and it made
them self-contradictory: registering a `<Route>` makes a URL resolve, it does
not put a door in the UI, and the nav lives in a CRM file. Following the rules
literally shipped an integration nobody could click to. Keep the nav change to
the entries themselves — adding links is wiring; restyling the sidebar is not.

**The API key stays on the server.** Session minting always goes through a CRM
route. If you ever find yourself wanting the key in the browser, you have taken
a wrong turn — and if the docs led you there, that is a serious finding.

**Restart the server by hand** after server-side changes. Boot re-runs the full
ingest.

**Get stuck for twenty minutes, then note it and move on.** The note is worth
more to us than the resolution. Use `pnpm milestone report`'s notes section, a
scratch file, anything — just capture the time and what you were trying to do.
