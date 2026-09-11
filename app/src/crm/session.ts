/**
 * Who is signed in, as far as this CRM is concerned.
 *
 * There is no password store and no auth server in this repo. Signing in means
 * picking a name off a dropdown; the choice is kept in localStorage so a reload
 * does not throw you back to the login screen. That is enough to make the
 * screens feel like a product you are logged into, and pretending otherwise
 * would mean building an identity system that nothing here would use.
 *
 * The signed-in staff member is still load-bearing: their role decides what the
 * navigation offers, and a desk executive and a tour leader are two genuinely
 * different jobs in a tour operator's office.
 */

import { createContext, useContext } from 'react';
import type { CrmStaff } from '../../../fixtures/types';

const STORAGE_KEY = 'sharma-travels.signed-in-staff-id';

export interface CrmSession {
  /** Null until somebody picks a name on /login. */
  staff: CrmStaff | null;
  /** All staff, so the login dropdown and the header share one fetch. */
  roster: readonly CrmStaff[];
  signIn: (staffId: string) => void;
  signOut: () => void;
}

export const SessionContext = createContext<CrmSession | null>(null);

export function useSession(): CrmSession {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useSession() was called outside <SessionProvider>.');
  }
  return session;
}

/**
 * localStorage throws in a browser configured to block site data, and a CRM
 * that white-screens because storage is disabled is worse than one that
 * forgets who you are.
 */
export function readStoredStaffId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredStaffId(staffId: string | null): void {
  try {
    if (staffId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, staffId);
    }
  } catch {
    // Nothing to do: the session simply does not survive a reload.
  }
}
