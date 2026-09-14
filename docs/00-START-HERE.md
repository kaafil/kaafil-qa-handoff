# Start here

You have been given a repo, a partner account, and roughly a week. Nobody
expects you to know anything about Kaafil yet. This page tells you what it is,
what you are holding, and exactly what to type.

Read it once, top to bottom, before you run anything.

---

## What Kaafil is

Kaafil runs the **operations of a trip that has already been sold**.

Somebody bought a ten-day Spiti tour. Money changed hands, seats are held, the
customer has an invoice. Kaafil starts *after* that moment and handles
everything between "sold" and "everyone got home":

- who is rooming with whom, and who is sitting where on the bus
- the pickup list for 6 a.m. on day one, and who actually showed up
- the day-by-day itinerary as it really ran, not as the brochure promised
- the cash float the tour leader is carrying, and what they spent it on
- the checklists that have to be ticked before a departure can be closed out
- the vendor bills, the documents, the photos, the feedback
- a link the traveller's family can open to see where the group is

It is **not a booking engine** — it never sells anything, never takes a card.
It is **not a CRM** — it does not hold your customer list, your leads, your
invoices, or your accounting. It sits behind whatever system you already use
for those and takes over once a departure becomes a real thing with real people
on it.

Two more things worth knowing on day one:

**Kaafil is never used directly.** There is no "log in to Kaafil" for an agency.
A partner system — their CRM, their back office — pushes trips into Kaafil and
mints short-lived sessions for its own staff. The staff see Kaafil's screens
inside the product they already use, under that product's brand. That is the
job you are about to do.

**The field half is offline-first.** A tour leader in Spiti has no signal for
six hours a day. Everything they do on the manager surface is written locally
first and synced when the network comes back. This is the single most important
behaviour in the product, and testing it is milestone 10.

Everything about the product lives at **<https://developer.kaafil.in>**. That
site is your primary source. If you cannot find an answer there, that is a
finding and we want to hear about it.

---

## What this repo is

This repo is **Sharma Travels Admin** — a completely fake, but completely
working, back-office CRM for a fifteen-year-old tour operator in Pune. It has
its own database, its own screens, its own dated blue-and-grey house style, and
its own vocabulary (it calls departures *tours* and people *staff*; Kaafil calls
them *trips* and *managers*).

It knows nothing about Kaafil. That is the whole point.

```
server/     a tiny node:http server + SQLite. On boot it wipes its own
            database, re-seeds it from fixtures, and pushes that data into
            YOUR Kaafil tenant. Your API key lives here and only here.
fixtures/   Sharma Travels' book of business: 6 departures, 62 travellers,
            28 bookings, every state a real operator has.
app/
  src/crm/    the existing CRM screens. Do not rewrite these.
  src/kaafil/ EMPTY. This is where you work.
tools/      the milestone stamper.
docs/       you are here.
```

**Your job is to put Kaafil's three screens inside this CRM**, as a partner
engineer would on their first week. Not to build a demo from scratch — to fit
something into a product that already exists and already has opinions about how
it looks.

We are measuring four things while you do it:

1. How long it takes, split between setup and real integration.
2. How far Kaafil's customization bends before it breaks.
3. Whether the product itself has bugs.
4. Whether the documentation is enough, for someone who started where you did.

Number four matters as much as the others. **Every time you have to ask a human
or read library source code instead of the docs, that is a defect** — write it
down, with a timestamp.

---

## Setup

### Step zero — the AI tooling (do this first, really)

```sh
npx kaafil-skills add
claude mcp add --transport http kaafil-docs https://developer.kaafil.in/api/mcp
```

The first command installs Kaafil's agent skills into your editor's AI
assistant: task recipes for the things you are about to do, with the correct
call shapes baked in. The second connects your assistant directly to the live
documentation, so it can look things up instead of guessing.

This exercise **assumes you have both**. A large part of what we are testing is
whether an engineer plus a well-informed assistant can integrate Kaafil without
talking to us, so skipping step zero measures the wrong thing. Do it before you
open the repo.

### Step one — install

```sh
git clone <this repo>
cd kaafil-qa-handoff
pnpm install
```

Node 20.11 or newer, and pnpm. Nothing else.

### Step two — get an API key

Go to the partner console at **<https://platform.kaafil.in>** and sign in with
the account you were given. Then:

> **API keys** in the left nav → **Create key**

It is a top-level nav item, not buried under Settings. If you land on
**Get started** first, that is the console's own onboarding and worth a
minute of your time.

Copy the secret **at creation time** — the console shows it exactly once.

Keys come in two flavours and the prefix tells you which:

| Prefix | What it means |
|---|---|
| `kf_test_` | Sandbox. Recommended. You get a controllable clock and can rebuild your fixture data whenever you like. **Capped at 5 trips and 50 travellers per trip.** |
| `kf_live_` | Real. Also fine, and we will not stop you — but there is no sandbox clock, no fixture rebuild, and the sandbox-only endpoints return `404`. No trip cap. |

Either works for this exercise. The server prints which one it detected at boot
and what the choice costs you, so the decision at least stops being accidental.

> **The 5-trip cap is worth understanding before you hit it.** This fixture has
> **six** departures, so on a sandbox key the last one is refused with
> `TEST_TRIP_LIMIT`. Worse, `pnpm reset:kaafil` plants one fixture trip of
> Kaafil's own first, which leaves **four** free slots.
>
> This is a real product limit, not a broken seed, and we have left it in place
> rather than papering over it. What the repo does instead is push the
> departures in order of how much the exercise needs them, so everything
> milestones 5, 6, 7 and 10 name still lands. The ingest says out loud which
> trips it lost. See [01-the-exercise.md](./01-the-exercise.md) for exactly
> what that costs you, and note it in your report if it got in your way.
>
> One thing the cap genuinely blocks: **`pnpm seed:bulk` needs a `kf_live_`
> key.** It seeds 50 departures.

### Step three — the .env file

```sh
cp .env.example .env
```

Open `.env` and paste your key into `KAAFIL_API_KEY`. Leave
`KAAFIL_AGENCY_REF=sharma-travels` unless you have a reason not to — it is just
the CRM's own name for the agency, and Kaafil stores it as an external
reference.

> **The API key is server-only.** Never rename it to anything starting with
> `VITE_`, never import it from `app/`. Vite inlines every `VITE_`-prefixed
> variable straight into the browser bundle, and a partner API key in a browser
> bundle is a compromised tenant. The browser only ever holds a short-lived
> session token that the server mints for it. This is not a style preference;
> it is the security model.

### Step four — run it

```sh
pnpm dev
```

On boot, in this order, the server will:

1. delete `crm.sqlite` and re-create it from the fixtures — a clean slate every
   single time, so nothing you break can persist
2. push the agency, the staff, the six departures, the manifests and the staff
   assignments into **your** Kaafil tenant
3. wait for each trip to become workable, then serve Sharma Travels Admin

The CRM comes up on <http://localhost:5173>. Click around it. Look at the trip
list, open a departure, look at the traveller records and the staff list. This
is the product you are embedding into — get a feel for its layout and its
colours before you add anything, because matching them is milestone 8.

The dev server deliberately does **not** hot-restart on server file changes:
every boot re-runs the whole ingest, and a file watcher would replay that on
each keystroke and burn your rate limit. Restart it by hand.

### Two commands you will want later

```sh
pnpm reset:kaafil   # wipe and rebuild your Kaafil-side data (sandbox keys only)
pnpm seed:bulk      # add a large volume of extra trips, for pagination and perf
```

`reset:kaafil` is separate from `pnpm dev` on purpose — the rebuild is
destructive and rate-limited, so wiring it to boot would lock out anyone who
restarts twice. The partner console's Sandbox page does the same thing with
buttons if you prefer.

---

## Then what

Open **[01-the-exercise.md](./01-the-exercise.md)**. It has the ten milestones,
what "done" means for each, and how to stamp them.

Stamp milestone 1 now, while you are thinking about it:

```sh
pnpm milestone 1
```

Then, in rough order:

- **[01-the-exercise.md](./01-the-exercise.md)** — the ten milestones and the
  three personas.
- **[02-what-to-look-for.md](./02-what-to-look-for.md)** — where to push hard,
  and which bugs are the serious ones. Skim it early; read it properly around
  milestone 6.
- **[03-report-template.md](./03-report-template.md)** — the debrief. Glance at
  it now so you know what you will be asked, and keep notes as you go. Nobody
  reconstructs a week accurately from memory.

One more time, because it is the habit that makes this exercise worth running:
**keep a running note of every moment you were stuck, what unstuck you, and how
long it took.** That log is the most valuable thing you will hand back.
