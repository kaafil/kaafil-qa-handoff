/**
 * The routing table, in one list, in match order.
 *
 * Two groups, and the split is the whole architecture of this repo: the
 * `/api/crm/*` routes serve the CRM's own SQLite store and never touch
 * Kaafil, and the three routes above them hold the API key so the browser
 * never has to. Nothing else exists.
 */

import type { CrmStore } from '../db.js';
import type { Route } from '../http.js';
import { createCrmRoutes } from './crm.js';
import { createKaafilRoutes, type KaafilRouteDeps } from './kaafil.js';

export interface RouteDeps extends KaafilRouteDeps {
  readonly store: CrmStore;
  /** `test` or `live`, surfaced on `/api/health` so the app can say which plane it is on. */
  readonly environment: string;
}

export function createRoutes(deps: RouteDeps): readonly Route[] {
  const health: Route = {
    method: 'GET',
    pattern: '/api/health',
    handle() {
      return {
        ok: true,
        service: 'sharma-travels-admin',
        environment: deps.environment,
        agencyRef: deps.agencyRef,
        // A public host, not a credential — the traveller surface needs it to
        // build a share-token client without first opening a staff session.
        baseUrl: deps.baseUrl,
        crm: deps.store.counts,
      };
    },
  };

  return [health, ...createKaafilRoutes(deps), ...createCrmRoutes(deps.store)];
}

export type { Route } from '../http.js';
