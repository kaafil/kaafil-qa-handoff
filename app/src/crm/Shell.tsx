/**
 * The frame every signed-in screen sits inside: the blue masthead with the
 * signed-in staff member on the right, and the left navigation.
 *
 * The nav is persistent and the main region scrolls under it, which is how
 * this CRM has always worked — desk staff keep it open all day on a 1366×768
 * monitor and expect the menu to stay put.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { initials } from './format';
import { useSession } from './session';

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'crm-nav__link is-active' : 'crm-nav__link';

export function Shell() {
  const { staff, signOut } = useSession();

  return (
    <div className="crm-app">
      <header className="crm-masthead">
        <div className="crm-masthead__brand">
          <span className="crm-masthead__mark">ST</span>
          <span className="crm-masthead__name">Sharma Travels</span>
          <span className="crm-masthead__sub">Operations Admin</span>
        </div>

        <div className="crm-masthead__right">
          <span className="crm-masthead__fy">FY 2026–27</span>
          {staff === null ? null : (
            <>
              <span className="crm-whoami">
                <span className="crm-whoami__avatar">{initials(staff.fullName)}</span>
                <span>
                  <span className="crm-whoami__name">{staff.fullName}</span>
                  <span className="crm-whoami__role">
                    {staff.role === 'TOUR_LEADER' ? 'Tour leader' : 'Desk executive'} ·{' '}
                    {staff.staffCode}
                  </span>
                </span>
              </span>
              <button type="button" className="crm-signout" onClick={signOut}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="crm-nav">
        <div className="crm-nav__group">Operations</div>
        <ul className="crm-nav__list">
          <li>
            <NavLink to="/trips" className={NAV_LINK_CLASS}>
              Departures
            </NavLink>
          </li>
          <li>
            <NavLink to="/travellers" className={NAV_LINK_CLASS}>
              Traveller records
            </NavLink>
          </li>
        </ul>

        <div className="crm-nav__group">Office</div>
        <ul className="crm-nav__list">
          <li>
            <NavLink to="/staff" className={NAV_LINK_CLASS}>
              Staff
            </NavLink>
          </li>
        </ul>

        <div className="crm-nav__footer">
          Sharma Travels Admin
          <br />
          v4.2.1 · Pune
        </div>
      </nav>

      <main className="crm-main">
        <Outlet />
      </main>
    </div>
  );
}
