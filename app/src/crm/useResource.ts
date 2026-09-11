/**
 * One loader for every screen.
 *
 * Each CRM page reads one endpoint once and renders it. There is no cache, no
 * revalidation and no retry: the data is re-seeded from fixtures on every boot
 * of the server, so the only way it changes under you is a restart, and a
 * restart is a reload.
 */

import { useEffect, useState } from 'react';
import { CrmApiError } from './api';

export type Resource<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'failed'; error: CrmApiError };

/**
 * `load` is the request AND its identity: the effect re-runs whenever the
 * function changes. Pass a module-level function for a screen that always
 * reads the same URL, or a useCallback keyed on the id for one that does not.
 * An inline arrow would refetch on every render.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setResource({ state: 'loading' });

    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResource({ state: 'ready', value });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResource({
          state: 'failed',
          error:
            error instanceof CrmApiError
              ? error
              : new CrmApiError(error instanceof Error ? error.message : String(error), 0),
        });
      },
    );

    return () => controller.abort();
  }, [load]);

  return resource;
}
