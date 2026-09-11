/**
 * Sharma Travels Admin — the CRM's backend.
 *
 * `node:http`, no framework, about two hundred lines. A QA reading it should
 * be able to find the three Kaafil calls in under a minute without first
 * learning anyone's middleware conventions.
 *
 * Boot does three things, in this order, and the order is load-bearing:
 *
 *   1. delete `crm.sqlite` and rebuild it from `fixtures/core.ts`
 *   2. push that same data into the QA's Kaafil tenant (`server/ingest.ts`)
 *   3. listen
 *
 * Ingest runs before `listen` rather than in the background because a CRM
 * whose screens are already serving trips that do not exist in Kaafil yet is
 * exactly the confusing half-state this exercise must not start in. Boot is
 * slower by a few seconds; what the QA sees when it finishes is consistent.
 *
 * ONE `Kaafil` client is constructed here and shared by every route that
 * needs it. It holds the connection pool, the retry ladder and the idempotency
 * machinery, and a second instance would quietly duplicate all three.
 *
 * `KAAFIL_API_KEY` lives in this process and nowhere else. `pnpm dev:app`
 * starts Vite without it, so there is no path by which it can reach a browser
 * bundle — see the note in `.env.example`.
 */

import { createServer } from 'node:http';
import { Environment, Kaafil, resolveBaseUrl } from 'kaafil-js';
import { readGeneratedBulkFixture } from '../fixtures/bulk.js';
import { CORE_FIXTURE } from '../fixtures/core.js';
import { openStore } from './db.js';
import { matchRoute, readJsonBody, sendJson, serializeError } from './http.js';
import { runIngest } from './ingest.js';
import { createRoutes } from './routes/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const KAAFIL_API_KEY = process.env.KAAFIL_API_KEY;
const KAAFIL_AGENCY_REF = process.env.KAAFIL_AGENCY_REF;
// Undocumented on purpose: the environment's own default host is right for
// every real deployment and no integrator should be told to set this. The
// override stays, unadvertised, for engine development against a local build.
const KAAFIL_BASE_URL = process.env.KAAFIL_BASE_URL;
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
/** Where `pnpm dev:app` serves the CRM. The only origin allowed to call this. */
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';

function refuse(message: string): never {
  console.error(`\n  Cannot start.\n\n  ${message}\n`);
  process.exit(1);
}

if (
  KAAFIL_API_KEY === undefined ||
  KAAFIL_API_KEY === '' ||
  KAAFIL_API_KEY === 'kf_test_replace_me'
) {
  refuse(
    'KAAFIL_API_KEY is not set. Copy .env.example to .env and paste a key from the\n' +
      '  partner console (Settings -> API keys -> Create key; the secret is shown once).\n' +
      '  There is no offline mode to fall back to — this CRM talks to a real engine.',
  );
}

if (KAAFIL_AGENCY_REF === undefined || KAAFIL_AGENCY_REF === '') {
  refuse(
    'KAAFIL_AGENCY_REF is not set. It is your own id for the agency these trips\n' +
      '  belong to — any stable string. `sharma-travels` is the sensible default and is\n' +
      '  already in .env.example.',
  );
}

// Both are `string` from here down — bound to their own names so nothing
// below has to re-establish that the `refuse()` calls above already ran.
const apiKey: string = KAAFIL_API_KEY;
const agencyRef: string = KAAFIL_AGENCY_REF;

// The `Kaafil` constructor makes this same check itself, against `environment`.
// Repeating it here buys a failure message that names THIS server's env var
// and tells the QA where the key comes from.
let environment: Environment;
if (apiKey.startsWith('kf_test_')) {
  environment = Environment.Test;
} else if (apiKey.startsWith('kf_live_')) {
  environment = Environment.Live;
} else {
  refuse(
    `KAAFIL_API_KEY does not look like a Kaafil partner key — it starts "${apiKey.slice(0, 8)}".\n` +
      '  A real key begins `kf_test_` or `kf_live_`. Copy the exact value out of the\n' +
      '  partner console; a trimmed or re-typed one will not authenticate.',
  );
}

const kaafil = new Kaafil({
  apiKey,
  environment,
  ...(KAAFIL_BASE_URL !== undefined ? { baseUrl: KAAFIL_BASE_URL } : {}),
});

// The browser makes its own direct calls to the engine once it holds a session,
// so it needs the same host this process resolved rather than a hardcoded one.
const engineBaseUrl = KAAFIL_BASE_URL ?? resolveBaseUrl(environment);

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

const RULE = '─'.repeat(74);

function banner(line: string): void {
  console.log(line);
}

/**
 * Printed once, only for a `kf_live_` key, before anything is pushed anywhere.
 *
 * Using a live key here is allowed — a QA who wants to see the real plane
 * should be able to — so this neither blocks nor nags. It exists so that the
 * choice cannot be made by accident, because the two things it costs are
 * both invisible until you go looking for them.
 */
function warnAboutLivePlane(): void {
  banner('');
  banner('  YOU ARE ON THE LIVE PLANE.');
  banner('');
  banner(
    '  Your key begins kf_live_, so this CRM is pointed at real data rather than the\n' +
      '  sandbox. Two things change, and neither announces itself later: the sandbox\n' +
      '  toolkit is simply not there — `kaafil.test.*` (the simulated clock, the fixture\n' +
      '  rebuild, the tenant quota) answers 404 on this plane, which also means\n' +
      '  `pnpm reset:kaafil` cannot clean up after you — and everything the ingest below\n' +
      '  is about to push (the agency, its staff, its departures and every manifest) is\n' +
      '  being written into your live tenant, alongside whatever is already in it, under\n' +
      '  ids that are then yours to remove by hand. Nothing here will stop you and the\n' +
      '  exercise works perfectly well this way. If it was not deliberate, stop now, put\n' +
      '  a kf_test_ key in .env, and start again.',
  );
  banner('');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  banner('');
  banner(RULE);
  banner('  Sharma Travels Admin — CRM backend');
  banner(RULE);

  if (environment === Environment.Live) {
    warnAboutLivePlane();
  }

  // 1 — the CRM's own store. Deleted and rebuilt every boot so a QA who
  // restarts twenty times sees the identical starting state twenty times.
  //
  // `pnpm seed:bulk` writes fixtures/bulk.generated.json; if it is there, boot
  // on it. Without this the command wrote a file nothing ever read — a QA
  // would have run it, seen the same six departures, and reasonably concluded
  // the bulk seed was broken. Delete that file to go back to the core seed.
  const storeStartedAt = Date.now();
  const bulk = readGeneratedBulkFixture();
  const store = openStore(bulk ?? CORE_FIXTURE);
  const { tours, bookings, travellers, staff } = store.counts;
  banner(
    `  store     crm.sqlite deleted and rebuilt from ` +
      `${bulk === null ? 'fixtures/core.ts' : 'fixtures/bulk.generated.json'} ` +
      `in ${Date.now() - storeStartedAt}ms`,
  );
  banner(
    `            ${tours} departures · ${bookings} bookings · ` +
      `${travellers} travellers · ${staff} staff`,
  );

  banner(
    `  kaafil    ${environment} plane · key kf_${environment}_… (server-only) · ` +
      `agency "${agencyRef}"`,
  );
  banner(`            ${engineBaseUrl}`);

  // 2 — the same data, translated into Kaafil's vocabulary and pushed into
  // the QA's tenant. This is the job a paying partner does on day one, and
  // `server/ingest.ts` is the one place in this repo that knows how. It
  // narrates its own seven steps, so this prints nothing until it is done.
  banner('');
  const ingestStartedAt = Date.now();
  const ingest = await runIngest(kaafil, { agencyRef, fixture: store.snapshot() });
  const ingestSeconds = ((Date.now() - ingestStartedAt) / 1000).toFixed(1);
  banner('');
  banner(
    `  ingest    ${ingest.tripRefs.length} trips (${ingest.readyTripRefs.length} with a built ` +
      `journey) · ${ingest.travellersPushed} travellers · ` +
      `${ingest.managerRefs.length} managers · ${ingest.agencyAdminRefs.length} admins · ` +
      `${ingestSeconds}s`,
  );
  if (ingest.failures.length > 0) {
    // Ingest collects failures rather than throwing, so the CRM still comes
    // up and the QA can see which parts landed. Repeat the count here: the
    // per-failure detail has already scrolled past by the time boot finishes.
    banner(
      `  ingest    ${ingest.failures.length} push(es) failed — codes and requestIds are in the ` +
        `[ingest] lines above`,
    );
  }

  // 3 — serve.
  const routes = createRoutes({
    kaafil,
    agencyRef,
    baseUrl: engineBaseUrl,
    store,
    environment,
  });

  const server = createServer((req, res) => {
    void (async () => {
      // The CRM is served by Vite on another port in development, so every
      // call from it is cross-origin. One origin, not `*` — this server mints
      // credentials, and a wildcard would let any page in the browser ask it
      // for one.
      res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      const matched = matchRoute(routes, req.method ?? 'GET', url.pathname);
      if (matched === null) {
        sendJson(res, 404, {
          error: {
            source: 'crm',
            code: 'CRM_NO_ROUTE',
            status: 404,
            message: `No route for ${req.method} ${url.pathname}.`,
          },
        });
        return;
      }

      try {
        const body = req.method === 'POST' ? await readJsonBody(req) : {};
        const data = await matched.route.handle({
          req,
          url,
          params: matched.params,
          body,
        });
        sendJson(res, 200, data);
      } catch (error) {
        const { status, body } = serializeError(error);
        sendJson(res, status, body);
      }
    })();
  });

  const shutdown = (signal: string): void => {
    banner(`\n  stopping  (${signal})`);
    server.close();
    store.close();
    void kaafil.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(PORT, () => {
    banner(`  ready     http://localhost:${PORT}`);
    banner(`            the CRM itself is at ${APP_ORIGIN}`);
    banner(RULE);
    banner('');
  });
}

main().catch((error: unknown) => {
  const { body } = serializeError(error);
  const detail = body.error;
  console.error('\n  Boot failed.\n');
  console.error(`  ${String(detail.message)}`);
  if (detail.code !== null && detail.code !== undefined) {
    console.error(`  code       ${String(detail.code)}`);
  }
  if (detail.status !== null && detail.status !== undefined) {
    console.error(`  status     ${String(detail.status)}`);
  }
  if (detail.requestId !== null && detail.requestId !== undefined) {
    // Quote this when you report the failure — it is how the engine's own
    // logs are found for this exact call.
    console.error(`  requestId  ${String(detail.requestId)}`);
  }
  console.error(
    '\n  A 401 or 403 here almost always means the key in .env is not the one the\n' +
      '  partner console issued for this tenant. A 404 on the sandbox toolkit means\n' +
      '  a kf_live_ key. Anything else is worth reporting.\n',
  );
  process.exit(1);
});
