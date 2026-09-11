/**
 * `pnpm reset:kaafil` — rebuild the sandbox tenant to pristine.
 *
 * The CRM's own store is disposable: `pnpm dev` deletes `crm.sqlite` and
 * re-seeds it on every boot, so the CRM half of this repo is never out of
 * date. Your Kaafil tenant is not disposable in the same way, and this script
 * is the only thing in the repo that wipes it.
 *
 * ── WHY THIS IS NOT WIRED INTO BOOT ────────────────────────────────────────
 *
 * Two reasons, and the second is the one that would actually bite you.
 *
 * It is DESTRUCTIVE. `test.fixtures()` does not merge or top up — it rebuilds
 * the scenario, so anything you did by hand in the partner console, any trip
 * you added, any write a manager surface pushed while you were testing
 * offline behaviour, is gone. That is a thing to choose, not a thing that
 * happens because you pressed Ctrl-C and up-arrow.
 *
 * It is RATE LIMITED, to roughly ten calls a minute per tenant. Wire a
 * destructive rebuild into server boot and a QA who restarts the server twice
 * while fixing a typo gets a `429 RATE_LIMITED` from the third restart
 * onwards — with the failure landing on ingest, which is the one part of boot
 * that had nothing to do with it. Keeping the wipe on its own command means a
 * restart is always cheap and always safe.
 *
 * The partner console's Sandbox page does the same job with a GUI and is the
 * friendlier way to do it. This exists for when you want it in a terminal.
 *
 * ── ON A LIVE KEY ──────────────────────────────────────────────────────────
 *
 * There is no fixture rebuild on the live plane, and there should not be:
 * "wipe the tenant and rebuild it from a scenario" is not an operation a real
 * agency's real data can survive. A `kf_live_` key is refused here — by the
 * SDK before a request is even sent, and by the engine as a `404` if a key
 * somehow gets past that — and this script says so in one sentence instead of
 * printing a stack trace at you.
 *
 * Run it with `pnpm reset:kaafil`, which supplies `.env` via
 * `tsx --env-file=.env`. The API key is read here, in a Node process, and
 * never reaches the browser.
 */

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  Environment,
  isKaafilError,
  Kaafil,
  KaafilNotFoundError,
  KaafilRateLimitedError,
  TestEnvironmentRequiredError,
} from 'kaafil-js';

const KAAFIL_API_KEY = process.env.KAAFIL_API_KEY;
// Undocumented on purpose: the hosted engine is the right default for every
// QA. The override exists for local-engine development and nothing else.
const KAAFIL_BASE_URL = process.env.KAAFIL_BASE_URL;

if (!KAAFIL_API_KEY) {
  console.error(
    'KAAFIL_API_KEY is not set. Copy .env.example to .env and paste the key you created in ' +
      'the partner console, then run this again.',
  );
  process.exit(1);
}

if (KAAFIL_API_KEY.startsWith('kf_live_')) {
  console.error(
    'That is a live key, and there is no fixture rebuild on the live plane.\n' +
      '\n' +
      'This command wipes a tenant and rebuilds it from a fixed scenario, which is only ever ' +
      'safe against sandbox data. Kaafil answers 404 for the whole test.* group on a live key ' +
      'rather than offering a destructive operation to real agency data.\n' +
      '\n' +
      'If you want a resettable tenant, create a kf_test_ key in the partner console and put ' +
      'that in .env instead. Nothing else in this repo changes.',
  );
  process.exit(1);
}

if (!KAAFIL_API_KEY.startsWith('kf_test_')) {
  console.error(
    `KAAFIL_API_KEY does not look like a Kaafil partner key (it starts ` +
      `"${KAAFIL_API_KEY.slice(0, 8)}…"). It should start "kf_test_". Copy the exact value from ` +
      'the partner console.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Say what is about to happen, before it happens
// ---------------------------------------------------------------------------

console.log('About to rebuild your Kaafil sandbox tenant to pristine.');
console.log('');
console.log('  What this does   POST /api/v1/test/fixtures, scenario "default".');
console.log('                   Kaafil wipes the tenant and rebuilds the scenario, with the');
console.log('                   same external references it uses every time.');
console.log('  What you lose    Every trip, traveller, manager, booking and manager-side write');
console.log('                   currently in the tenant, including anything this CRM ingested');
console.log('                   and anything you created by hand in the console.');
console.log('  What survives    Your API key, and this repo. `pnpm dev` re-ingests the CRM');
console.log('                   fixture on its next boot, so the CRM data comes straight back.');
console.log('  Rate limit       Roughly ten calls a minute per tenant. This is why the rebuild');
console.log('                   is its own command and not part of server boot.');
console.log('');

// Non-interactive runs (CI, a piped shell) get no prompt they could never
// answer — they get the refusal, which is the safe default for a wipe.
if (!stdin.isTTY) {
  console.error(
    'Refusing to wipe a tenant without a confirmation, and this shell has no terminal to ' +
      'ask on. Run it interactively.',
  );
  process.exit(1);
}

const prompt = createInterface({ input: stdin, output: stdout });
const answer = await prompt.question('Type "reset" to go ahead, anything else to stop: ');
prompt.close();

if (answer.trim().toLowerCase() !== 'reset') {
  console.log('Stopped. Nothing was changed.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Do it
// ---------------------------------------------------------------------------

const kaafil = new Kaafil({
  apiKey: KAAFIL_API_KEY,
  environment: Environment.Test,
  ...(KAAFIL_BASE_URL === undefined ? {} : { baseUrl: KAAFIL_BASE_URL }),
});

try {
  console.log('Rebuilding…');
  const fixtures = await kaafil.test.fixtures({ scenario: 'default' });

  console.log('');
  console.log('Done. The tenant now holds Kaafil’s own default scenario:');
  console.log(`  agency      ${fixtures.agencyRef}`);
  console.log(`  trip        ${fixtures.tripRef}`);
  console.log(`  managers    ${fixtures.managerRefs.length}`);
  console.log(`  travellers  ${fixtures.travellerRefs.length}`);
  console.log('');
  console.log(
    'These references are constants — the same strings on every rebuild — so a test can name ' +
      'them directly. Run `pnpm dev` to put Sharma Travels’ own data back alongside them.',
  );
} catch (error) {
  console.error('');

  if (error instanceof TestEnvironmentRequiredError) {
    // Belt and braces: the kf_live_ guard above should have caught this, so
    // reaching here means the key was resolved rather than literal.
    console.error(
      'The SDK refused this before sending it: the test.* group only exists on the sandbox ' +
        'plane, and this client is configured for live. Use a kf_test_ key.',
    );
  } else if (error instanceof KaafilNotFoundError) {
    console.error(
      'Kaafil answered 404 for the fixture route. That is what the engine says when the key ' +
        'presented is not a sandbox key — the whole test.* group is absent on the live plane ' +
        'rather than being a destructive operation offered against real data. Check that ' +
        'KAAFIL_API_KEY in .env is the kf_test_ key you meant to use.',
    );
  } else if (error instanceof KaafilRateLimitedError) {
    console.error(
      'Kaafil answered 429: too many rebuilds in the last minute. The cap is about ten a ' +
        'minute per tenant. Wait a minute and run it again — nothing was wiped.',
    );
  } else if (isKaafilError(error)) {
    console.error(`The rebuild failed: ${error.code ?? error.kind} — ${error.message}`);
    if (error.requestId !== undefined) {
      console.error(`Quote requestId ${error.requestId} if you raise this with Kaafil.`);
    }
  } else {
    console.error(
      `The rebuild failed before Kaafil could answer: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Not `process.exit(1)`: that would skip the `finally` below and leave the
  // client's own teardown undone. Setting the code lets the process end
  // normally, non-zero, after closing.
  process.exitCode = 1;
} finally {
  kaafil.close();
}
