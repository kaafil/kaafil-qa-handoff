/**
 * Sharma Travels Admin — routes and the fake session.
 *
 * The staff roster is fetched once here rather than per screen, because both
 * the login dropdown and the masthead need it and neither should be the one
 * that owns it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { fetchStaff } from './api';
import { LoginPage } from './LoginPage';
import { Shell } from './Shell';
import { StaffPage } from './StaffPage';
import { readStoredStaffId, SessionContext, useSession, writeStoredStaffId } from './session';
import { TravellerDirectoryPage } from './TravellerDirectoryPage';
import { TripDetailPage } from './TripDetailPage';
import { TripListPage } from './TripListPage';
import { Failed, Loading } from './ui';
import { useResource } from './useResource';

const loadStaff = (signal: AbortSignal) => fetchStaff(signal);

export function App() {
  const roster = useResource(loadStaff);
  const [staffId, setStaffId] = useState<string | null>(() => readStoredStaffId());

  const signIn = useCallback((id: string) => {
    writeStoredStaffId(id);
    setStaffId(id);
  }, []);

  const signOut = useCallback(() => {
    writeStoredStaffId(null);
    setStaffId(null);
  }, []);

  // /api/crm/staff returns each person wrapped with their departure assignments
  // (`StaffRecord`). The session is an identity, not a roster screen: unwrapping
  // to `CrmStaff` here keeps every consumer — the login dropdown, the masthead,
  // the crew name index — reading a person directly instead of `.staff.` first.
  // The assignments are dropped on purpose; /staff refetches them where it needs
  // them, and caching them in the session would be a second copy to keep true.
  const people = useMemo(
    () => (roster.state === 'ready' ? roster.value.staff.map((record) => record.staff) : []),
    [roster],
  );

  // A staff id left in localStorage from an earlier seed may no longer exist,
  // and a header rendering a name that is not on the roster is worse than one
  // that sends you back to the login screen.
  const staff = useMemo(
    () => people.find((person) => person.staffId === staffId) ?? null,
    [people, staffId],
  );

  useEffect(() => {
    if (roster.state === 'ready' && staffId !== null && staff === null) {
      writeStoredStaffId(null);
      setStaffId(null);
    }
  }, [roster.state, staffId, staff]);

  const session = useMemo(
    () => ({ staff, roster: people, signIn, signOut }),
    [staff, people, signIn, signOut],
  );

  if (roster.state === 'loading') {
    return (
      <div className="crm-login">
        <Loading what="Sharma Travels Admin" />
      </div>
    );
  }

  if (roster.state === 'failed') {
    return (
      <div className="crm-login">
        <Failed error={roster.error} />
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireStaff />}>
          <Route element={<Shell />}>
            <Route path="/trips" element={<TripListPage />} />
            <Route path="/trips/:tourId" element={<TripDetailPage />} />
            <Route path="/travellers" element={<TravellerDirectoryPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="*" element={<Navigate to="/trips" replace />} />
          </Route>
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}

/** Nobody signed in means the login screen, remembering where they were headed. */
function RequireStaff() {
  const location = useLocation();
  const { staff } = useSession();

  if (staff === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
