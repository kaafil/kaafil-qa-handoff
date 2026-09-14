# What to look for

Milestones tell you what to build. This page tells you where to **push**.

Everything here is a place where Kaafil has made a deliberate, arguable
decision. Some of those decisions will feel wrong to you. Say so — an
integrator who finds a rule annoying is a better signal than one who finds it
reasonable, and a couple of the rules below exist specifically so that breaking
them is a headline bug.

Work through this with the docs at <https://developer.kaafil.in> open. Where
this page and the docs disagree, the docs are current and this page is a
defect: tell us.

---

## 1. The customization ladder

Kaafil gives you four rungs. You are meant to start at the top and climb down
only as far as you have to.

```
  Surface     one component, whole persona, near-zero code
     ↓
  Composite   a section of a surface, mounted by you
     ↓
  Slots       your component swapped into theirs
     ↓
  Hooks       Kaafil's data, your UI, entirely
```

**Surface.** `KaafilManagerApp`, `KaafilAgencyWorkspace`, `KaafilShareView`.
One component, a credential, and you have a working persona. This is where
milestones 5–7 live.

**Composite.** The families also export the individual sections a surface is
made of — a checklist section, a close-out section, a settings screen — so you
can place one inside your own layout instead of taking the whole surface. Use
this when the CRM already has navigation and you want Kaafil inside a tab
rather than owning the page.

**Slots.** Most exported components accept a `components` prop: hand it your
own implementation of an internal part and Kaafil renders yours instead. The
share view additionally has `renderSection`, which replaces one whole section's
rendering while still handing you the section's data.

**Hooks.** `kaafil-react-uikit/core` exports the entire data layer —
`useRooming`, `useChecklists`, `useExpenses`, `useItinerary`, `useFloat`,
`useCloseout`, `useConflicts`, and around fifty more. They handle the sync,
the offline queue, the conflict handling and the capability gating; the pixels
are yours. This is the escape hatch, and it is a real one: nothing is
reachable from the surface that is not reachable from a hook.

### What we want to know

For every customization you attempted, the honest answer to two questions:

- **Which rung did you have to drop to?** If skinning a button meant dropping
  from Surface to Hooks, that is a failure of the two rungs in between.
- **Did the rung below actually have what the rung above had?** Climbing down
  should cost you convenience, never capability. If dropping to hooks meant
  losing something the surface did for free — an empty state, a loading
  skeleton, a permission check, an error message — name it.

Also tell us about anything you **could not** customize and wanted to. "I
wanted X and there was no way to get it" is one of the most useful sentences
you can write in the report.

---

## 2. Theming

### The rules

Kaafil's CSS ships inside `@layer kaafil-ui`. Your overrides go in
`@layer kaafil-ui-overrides`, which is declared to sit above it. That ordering
is the contract: anything you put in the overrides layer beats anything Kaafil
ships, regardless of selector specificity, without a single `!important`.

```css
@layer kaafil-ui-overrides {
  :root {
    --kf-accent: #1a4f8a;
    --kf-accent-hover: #143f6f;
    --kf-accent-contrast: #ffffff;
  }
}
```

Every one of Kaafil's custom properties is named `--kf-*` and every class is
named `.kf-*`, unhashed and stable across releases. They are a published API,
so you may target them — but see the warning below.

### The twelve

There is a deliberately small set of tokens that is supposed to get you a full
reskin on its own:

| Family | Tokens |
|---|---|
| Accent | `--kf-accent`, `--kf-accent-hover`, `--kf-accent-contrast` |
| Surface | `--kf-surface-base`, `--kf-surface-raised`, `--kf-surface-sunken` |
| Text | `--kf-text-primary`, `--kf-text-secondary`, `--kf-text-muted` |
| Danger | `--kf-danger` |
| Shape | `--kf-radius-control` |
| Focus | `--kf-focus-ring` |

The claim being tested at milestone 8 is: **override those twelve and nothing
else, and a non-technical reviewer should not be able to find the seam between
a Kaafil screen and a Sharma Travels screen.**

Try exactly that first. Set the twelve to the CRM's palette, look at all three
surfaces, and record how close it gets you. Then keep going with whatever else
you need — and *keep a list of every token beyond the twelve that you needed*,
and of every place you had to reach past tokens entirely.

When you need a thirteenth token, look it up in the **token reference**
(`/docs/ui-kit/customization/tokens` on the developer portal): every defined
token, its default, and the file it comes from. Do not grep the compiled
`dist/index.css` — it mixes the 436 real tokens with ~2,390 deliberately
undefined per-component override hooks, which is what made the surface look
like an unusable 2,800-name list. That reference exists because an earlier run
of this exercise had no choice but to grep.

> **The line that matters:** writing `--kf-accent: #1a4f8a` is theming working.
> Writing `.kf-manager-fab { background: #1a4f8a }` is theming **not** working.
> The second one is legal and will not break, but each time you do it you have
> found a gap in the token system. Log every single one. That list is one of
> the most valuable outputs of this whole exercise.

### Also try

- **Density.** The provider takes `density: 'compact' | 'default' | 'comfortable'`.
  Sharma Travels has tight rows; see whether `compact` matches them, and by how
  much it misses. If it is not tight enough, the token to reach for is
  **`--kf-density-row-padding-block`** — *not* `--kf-density-row-height`, which
  only sets a floor and so can make a row taller but never shorter. Note that a
  manifest row bottoms out around 36px whatever you do, because that is an
  avatar beside two lines of identity; below that you are changing what the row
  shows, not its spacing. `--kf-density-gap` is defined but read by nothing
  today, and we would rather you knew than discovered it.
- **Dark mode.** `theme: 'light' | 'dark' | 'system'`. The CRM is light-only.
  Check that `system` does not hand a dark Kaafil panel to someone using a light
  CRM on a dark-mode laptop.
- **Per-instance overrides.** Components take a `style` prop that accepts token
  overrides, for when one instance needs to differ from the rest.
- **Style isolation.** The provider takes `isolation: 'scoped' | 'shadow'`. The
  CRM has a broad, old, un-namespaced stylesheet — precisely the hostile
  environment this is for. Try both. Does the CRM's CSS leak into Kaafil? Does
  Kaafil's leak out? Does `shadow` cost you anything you noticed?

### And watch for

- Fonts. Does Kaafil inherit the CRM's font stack, or impose its own?
- Layout collisions — the CRM's own headers, sticky bars, or z-index stacking
  against Kaafil's.
- Anything that writes to the page `<head>`. The staff surfaces are supposed to
  leave `document.head` completely alone; only the traveller share page is
  allowed to own the page title and favicon. If a title or favicon changes when
  you mount the manager or desk surface inside the CRM, that is a bug.
- Anything added to `window`. There should be nothing.

---

## 3. Offline, on the manager surface

This is the product's hardest promise and its most important test.

A tour leader in Spiti is offline for most of the working day. Every write they
make must land locally, survive anything, and sync later without duplicating,
without losing, and without silently overwriting someone else's work.

### The core test — milestone 10

Kill the network. Do several different kinds of write. **Reload while still
offline.** Everything must still be there.

> **If a write is lost across that reload, that is the highest-severity bug in
> the product.** Stop, capture it precisely — what you wrote, exactly how you
> went offline, what you saw after reload, browser and version — and report it
> immediately rather than at the end of the week. Nothing else you could find
> outranks it.

### Then push harder

- **Come back online and watch the sync.** Does the UI tell you something is
  pending? Does it tell you when it is done? Can you distinguish "saved on this
  device" from "saved for everyone"? A field user who cannot tell those apart
  will re-enter work.
- **Go offline, write, reload, write again, then reconnect.** Do the writes
  land in order?
- **Create a conflict on purpose.** Change the same thing from the desk console
  (online) and the manager surface (offline), then reconnect. What happens?
  Does anyone get told? Is it the right outcome? Is it *explained*?
- **Flap the connection** — on, off, on again mid-sync. Nothing should
  duplicate.
- **Offline while loading.** Open the manager surface with the network already
  dead. You should get a sensible offline state, not a spinner forever and not
  a crash.
- **Kill the tab mid-write**, then reopen it.
- **Watch for duplicates.** Kaafil handles retry safety internally; you never
  supply an idempotency key, and no hook will let you pass one. So if a retry
  ever produces two of something, that is entirely on the product and we want
  to know.

Note any point where you, as a developer, could not tell what state the queue
was in. Field-app confidence is mostly about legibility.

---

## 4. The share link: sections are the server's decision

`KaafilShareView` renders whatever sections the backend returned for that
token — the itinerary, rooming, pickup, documents, money, the manager's
contact, and so on. **Which sections exist is decided server-side**, from the
agency's settings, the traveller's own consent, the trip's state, and what the
link was issued for.

The `sections` prop can only **narrow** that:

```tsx
<KaafilShareView token={token} sections={{ money: false }} />
```

Setting a section to `true` that the server did not return does **not** make it
appear. That is intentional: a share link is an unauthenticated URL that can be
forwarded to anyone, so the visibility decision cannot live in the browser.

What to test:

- Ask for a section that is switched off in the agency settings. Confirm you
  cannot force it on from the client. **If you can, that is a serious security
  finding.**
- Toggle a section off in the partner console and reload the link. Does the
  view adapt cleanly, or does it leave a heading with a hole under it?
- Use `renderSection` to replace a section with your own component. Was the
  data you were handed enough to render something real?
- Try a link for a cancelled trip (`TR-2609-MEGHALAYA`) and for a closed-out
  one (`TR-2608-KERALA`). See the cancelled-trip note below for what to expect.

### The share dialog shows an address, not just a token

On the desk, **Show link** displays an existing link again so you can re-send
it. Two things worth knowing before filing a bug against it:

- A link minted **before** this shipped says so plainly and points at Replace.
  That is correct, not a failure — only a hash was ever stored for those, so
  the address genuinely cannot be recovered.
- What the dialog shows is a bare token like
  `c43df6bd-ec4a-4ea3-aedf-acb3837d3358` **unless your integration sets
  `buildShareUrl`** on `KaafilUIKitProvider` — Kaafil returns a token, never a
  URL, because the traveller page is on *your* domain:

  ```tsx
  <KaafilUIKitProvider
    buildShareUrl={(token) => `${window.location.origin}/share/${token}`}
    {...rest}
  />
  ```

  Set it. A raw UUID where an operator expects a sendable link is exactly the
  confusion the last round reported. If you have not, the dialog now says so in
  as many words — it calls the value a code rather than a link and points at the
  missing setup — and the console carries a development-only warning naming the
  prop. Both are deliberate; neither appears once `buildShareUrl` is set.

### A cancelled trip's link stays alive and says so

Expect **"This trip was called off"** and nothing else — no itinerary, no
rooming, no balance, and no forms to fill in. A cancelled trip's links are not
revoked; every section on them is switched off while the link itself keeps
working, so a family who opens the link they were sent learns *why* rather than
hitting a dead page and phoning the agency.

`TR-2609-MEGHALAYA` is the case to check. It previously showed **"Upcoming ·
Starts in 5 days"**, a countdown to a departure that was not happening — the
most serious finding of the last round.

### A share link that shows nothing may still be correct

When a share link should not be readable — revoked, expired, consent
withdrawn — Kaafil deliberately renders a plain **404-shaped** page.
No heading, no explanation, no "this link has expired", no divider or gap where
something used to be. Nothing that distinguishes "this link was turned off"
from "this URL never existed".

That is on purpose. Anyone can forward a share URL, so a page that says *why*
it is dark leaks information about a real trip and a real person to whoever now
holds the link.

So: **a blank share page is not automatically a bug.** Check the token's state
in the partner console before filing one. What *is* worth reporting is the
opposite — any dark share page that leaks a signal. A traveller's name in the
tab title, a trip code in the markup, an empty section heading, a distinctive
error shape, a telltale status code. Look at the DOM, not just the pixels.

---

## 5. The 423 close-out lock

When a trip is closed out, its records are locked. Writes come back as HTTP
`423`, the UI shows the trip as locked, and that is the end of it.

**There is no override.** Not for the manager, not for the desk executive, not
for anyone. The desk console has no "unlock" button, no admin toggle, no
force-save. The only route forward is a request to Kaafil, through the unlock
flow the locked screens point you at — it is a request, not a switch.

Related, and for the same reason: **no expense component anywhere in the UI Kit
has an approve, reject, or pay control.** Expenses are recorded in Kaafil and
approved wherever your business actually approves spend. If you go hunting for
`onApprove`, `onReject` or `onPay`, you will not find them, and that is the
design.

`TR-2608-KERALA` returned twelve days ago and is the close-out case in the
fixtures. Use it.

Things to try:

- Write to a locked trip from the manager surface. Do you get a clear
  explanation, or a generic failure?
- Write to it from the desk console. Is it locked there too? It must be.
- Write to it **offline**, then reconnect. The write cannot land. Is it parked
  visibly and explained, or does it vanish, or does it retry forever?
- Go looking for an override. Every prop, every settings screen, every hook in
  `/core`.

> **If you find any way at all to write to a closed-out trip from the UI Kit —
> a prop, a hook, a settings combination, a race — that is a serious finding.**
> Report it the same day, with exact reproduction steps.

---

## 6. Capabilities and dark sections

Not every agency buys every module. A section that is not enabled for a tenant
is simply not there — no greyed-out tab, no upsell, no teaser. The hooks tell
you a capability is dark and the surfaces render accordingly.

Worth checking:

- Turn a module off in the partner console and reload. Does the surface adapt,
  or leave a dead tab?
- If you built a custom screen on hooks at milestone 9, did you handle the dark
  case, or did you assume the data would be there? (If the hooks made it easy
  to forget, say so — that is a design problem worth hearing about.)
- Does a manager ever see a control they are not permitted to use? Desk and
  field have full capability parity in what they *can* do; the difference is
  context, not permission.

---

## 7. General bug hunting

While you are in there:

- **Console.** Zero warnings and zero errors at steady state. Any is a bug.
- **Money.** Everything is integer paise internally. Check the rupee formatting
  — grouping, symbol, negatives, refunds, zero. `TR-2609-MEGHALAYA` has refunds
  and outstanding balances; `TR-2610-RISHIKESH` has three bookings with a
  balance owing. Note that `RISHIKESH` is the first departure lost to the
  sandbox's 5-trip cap after a `pnpm reset:kaafil` — if it is not in your
  tenant, use `MEGHALAYA` for these checks.
- **Dates and times.** Each trip carries its **own** timezone, not the
  viewer's. A Ladakh departure viewed from a laptop set to UTC must still show
  Ladakh times. Change your machine's timezone and look again.
- **Language.** The kit ships English and Hindi. Set `locale` on the provider
  and look for untranslated strings or layouts that break on longer text.
- **Volume.** Run `pnpm seed:bulk` and go back to the desk console. Do the
  lists stay usable? Does pagination hold? Does the browser stay responsive?
  **This needs a `kf_live_` key** — it seeds 50 departures and a sandbox tenant
  is capped at 5, so on a test key every one of them is refused. If you only
  have a sandbox key, say so in your report and skip this rather than reading
  the refusals as a bug.
- **Keyboard and screen reader.** Tab all the way through the desk console. Can
  you reach everything? Is focus visible? Does anything trap you?
- **Small screens.** The manager surface is for a phone. Use one, or emulate
  one honestly at 360px.
- **The back button.** The kit ships no router at all — navigation is callbacks
  you wire into the CRM's router. Does the browser back button do something
  sensible after you have wired it?

---

## What "a good finding" looks like

Not "the rooming screen is broken". Rather:

> On the manager surface (Chrome 141, iPhone 14 emulation), with the network
> disabled, dragging traveller `TV-1042` from room 3 to room 5 on
> `TR-2609-SPITI` shows the move immediately. After a reload — still offline —
> they are back in room 3. Reproduced four times. The expense I logged in the
> same offline session did survive the reload, so it is not the whole queue.

Repeatable, scoped, and with the boundary of the problem drawn. Screenshots and
a HAR file if you have them.

Now go and try to break it. Then write it all down in
[03-report-template.md](./03-report-template.md).
