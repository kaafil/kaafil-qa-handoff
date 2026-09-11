/**
 * The sign-in screen.
 *
 * There is no password field because there is no password store: you pick a
 * name off the roster and you are that person for the rest of the session.
 * The screen says so plainly rather than showing a decorative password box
 * that accepts anything, which is the kind of detail that costs somebody ten
 * minutes of wondering what the credentials are.
 */

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './session';

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const { staff, roster, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Defaults to a desk executive: they see the whole book of business, so it is
  // the identity that makes the first screen after login worth looking at.
  const [picked, setPicked] = useState<string>(
    () =>
      roster.find((person) => person.role === 'DESK_EXECUTIVE')?.staffId ??
      roster[0]?.staffId ??
      '',
  );

  if (staff !== null) {
    return <Navigate to="/trips" replace />;
  }

  const state = location.state as LoginLocationState | null;
  const destination = state?.from ?? '/trips';

  const leaders = roster.filter((person) => person.role === 'TOUR_LEADER');
  const desk = roster.filter((person) => person.role === 'DESK_EXECUTIVE');

  return (
    <div className="crm-login">
      <form
        className="crm-login__card"
        onSubmit={(event) => {
          event.preventDefault();
          if (picked === '') return;
          signIn(picked);
          navigate(destination, { replace: true });
        }}
      >
        <div className="crm-login__head">
          <div className="crm-login__title">Sharma Travels Admin</div>
          <div className="crm-login__sub">Operations back office · Pune</div>
        </div>

        <div className="crm-login__body">
          {/*
            A CLICKABLE ROSTER, not a <select>. Chrome on macOS draws a select's
            options as a native OS menu, and on a wide window it can land
            detached in a corner of the screen instead of under the field. That
            is an OS rendering quirk rather than anything wrong with this page,
            but it is the FIRST screen a QA sees, and a control that looks
            broken here costs their trust and earns us a bug report about
            something that is not Kaafil.

            A roster you click is also the more honest period detail: back
            offices of this vintage list their people and you pick one.
          */}
          <fieldset className="crm-login__roster">
            <legend className="crm-field__label">Signed in as</legend>
            {[
              { heading: 'Desk', people: desk, detail: (p: (typeof desk)[number]) => p.staffCode },
              {
                heading: 'Tour leaders',
                people: leaders,
                detail: (p: (typeof leaders)[number]) => p.basedIn,
              },
            ].map((group) => (
              <div key={group.heading} className="crm-login__group">
                <div className="crm-login__group-head">{group.heading}</div>
                {group.people.map((person) => (
                  <label key={person.staffId} className="crm-login__person">
                    <input
                      type="radio"
                      name="crm-login-staff"
                      value={person.staffId}
                      checked={picked === person.staffId}
                      onChange={() => setPicked(person.staffId)}
                    />
                    <span className="crm-login__person-name">{person.fullName}</span>
                    <span className="crm-login__person-detail">{group.detail(person)}</span>
                  </label>
                ))}
              </div>
            ))}
          </fieldset>

          <button type="submit" className="crm-btn crm-btn--primary" disabled={picked === ''}>
            Sign in
          </button>

          <p className="crm-login__note">
            This installation has no password store. Pick a staff member to open the office with
            their identity; the choice is remembered until you sign out.
          </p>
        </div>

        <div className="crm-login__version">Sharma Travels Admin v4.2.1</div>
      </form>
    </div>
  );
}
