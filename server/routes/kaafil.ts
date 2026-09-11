/**
 * The three routes that are the only reason this CRM has a backend at all.
 *
 * Every one of them exists to hold `KAAFIL_API_KEY` on this side of the
 * network. The key is a partner credential: it can mint a session for ANY
 * manager in the tenant, read every trip, and erase a traveller. A browser
 * that held it would be a compromised tenant, and no amount of care in the
 * frontend fixes that — so the browser never sees it. It asks this server for
 * a credential instead, and gets back a short-lived, single-identity one.
 *
 *   POST /api/session        {managerRef}              -> a manager session
 *   POST /api/admin-session  {agencyAdminRef}          -> an agency-admin session
 *   POST /api/share-link     {tripRef, travellerRef?}  -> a traveller share token
 *
 * Which of the three the browser called decides which persona the UI Kit
 * renders. There is no `persona` prop anywhere in the UI Kit — the shape of
 * the credential IS the persona (`INGEST-CONTRACT.md`, "Browser side"):
 * `accessToken` + `refreshToken` + `agencyRef` is staff, a bare `shareToken`
 * is a traveller. That is why these are three separate routes with three
 * separate bodies rather than one `/token` with a `type` field.
 *
 * In a production CRM each of these would sit behind that CRM's own login and
 * check that the signed-in user is allowed to act as the ref they asked for.
 * There is no such check here because there is no real login here — the CRM's
 * sign-in screen is a picker over the seeded staff list. Do not copy these
 * three handlers into a real product without adding that authorization.
 */

import type { Kaafil } from 'kaafil-js';
// Paths come from the shared contract, not literals — the browser reads the
// same constant, so a rename here cannot leave the client calling a dead route.
import {
  type AgencyAdminSessionResponse,
  KAAFIL_API,
  type ManagerSessionResponse,
  type ShareLinkResponse,
} from '../../shared/crm-api.js';
import { optionalString, type Route, requireString } from '../http.js';

export interface KaafilRouteDeps {
  readonly kaafil: Kaafil;
  /** `KAAFIL_AGENCY_REF` — the UI Kit's staff credential needs it alongside the tokens. */
  readonly agencyRef: string;
  /** The engine host this server is talking to, so the browser calls the same one. */
  readonly baseUrl: string;
}

export function createKaafilRoutes(deps: KaafilRouteDeps): readonly Route[] {
  const { kaafil, agencyRef, baseUrl } = deps;

  return [
    {
      method: 'POST',
      pattern: KAAFIL_API.session,
      async handle({ body }): Promise<ManagerSessionResponse> {
        const managerRef = requireString(body, 'managerRef');
        const session = await kaafil.auth.mintManagerToken({ managerRef });

        // `KaafilResponse<T>` is `T & { meta }` — an intersection, not an
        // envelope. There is no `.data` to unwrap; the fields are right here.
        //
        // `refreshToken` is shown exactly once, on this response and at each
        // later rotation. It is forwarded to the browser, which is what the
        // UI Kit's staff credential needs, and it is never logged.
        return {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          tokenType: session.tokenType,
          expiresIn: session.expiresIn,
          expiresAt: session.expiresAt,
          agencyId: session.agencyId,
          managerId: session.managerId,
          // Your own ref for the agency, not Kaafil's `agencyId`. The UI Kit's
          // credential takes the external one.
          agencyRef,
          baseUrl,
        };
      },
    },

    {
      method: 'POST',
      pattern: KAAFIL_API.adminSession,
      async handle({ body }): Promise<AgencyAdminSessionResponse> {
        const agencyAdminRef = requireString(body, 'agencyAdminRef');
        const session = await kaafil.auth.mintAgencyAdminToken({ agencyAdminRef });

        return {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          tokenType: session.tokenType,
          expiresIn: session.expiresIn,
          expiresAt: session.expiresAt,
          agencyId: session.agencyId,
          agencyRef,
          baseUrl,
        };
      },
    },

    {
      method: 'POST',
      pattern: KAAFIL_API.shareLink,
      async handle({ body }): Promise<ShareLinkResponse> {
        const tripRef = requireString(body, 'tripRef');
        // Omit it for a whole-trip family link; pass it to scope the link to
        // one person. The two produce visibly different traveller surfaces,
        // which is worth trying both of.
        const travellerRef = optionalString(body, 'travellerRef');

        // `shareTokens.create`, not `mint` — the method is `create`.
        const link = await kaafil.shareTokens.create(
          travellerRef === undefined ? { tripRef } : { tripRef, travellerRef },
        );

        // `token` is the plaintext share token, returned on this mint response
        // and never again. It is the whole credential for the traveller
        // surface: hand it to the UI Kit as `shareToken` and nothing else.
        return {
          id: link.id,
          token: link.token,
          tripId: link.tripId,
          travellerId: link.travellerId,
          status: link.status,
          expiresAt: link.expiresAt,
          sections: link.config.sections,
          version: link.version,
          baseUrl,
        };
      },
    },
  ];
}
