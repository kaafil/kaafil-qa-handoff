/**
 * Staff — the two halves of the office, side by side.
 *
 * Tour leaders and desk executives are split into separate tables rather than
 * filtered in one, because they are different jobs with different columns: a
 * leader is defined by where they are based and what they speak, an executive
 * by what they are holding at the desk. Keeping them in one table would mean a
 * row of blanks for whichever half you are not looking at.
 *
 * The roster route already answers "what is this person rostered onto" —
 * `StaffRecord.assignments` carries the tour id, its title and the duty role.
 * So this screen reads `/api/crm/staff` alone: pulling the departures list too
 * and re-deriving the rostering in the browser would be a second round trip to
 * rebuild something the server already sent, and it could only ever see the
 * lead leader, never an assistant.
 */

import { Link } from 'react-router-dom';
import { fetchStaff, type StaffRecord } from './api';
import { date } from './format';
import { dutyLabel, EmptyRow, Failed, Loading, PageHead, Panel, StaffRoleChip, Stat } from './ui';
import { useResource } from './useResource';

const loadOffice = async (signal: AbortSignal) => {
  const { staff } = await fetchStaff(signal);
  return staff;
};

export function StaffPage() {
  const office = useResource(loadOffice);

  if (office.state === 'loading') return <Loading what="the staff list" />;
  if (office.state === 'failed') return <Failed error={office.error} />;

  const records = office.value;
  const leaders = records.filter((record) => record.staff.role === 'TOUR_LEADER');
  const desk = records.filter((record) => record.staff.role === 'DESK_EXECUTIVE');
  const committed = leaders.filter((record) => record.assignments.length > 0).length;

  return (
    <>
      <PageHead
        title="Staff"
        meta={`${records.length} on the books · ${leaders.length} in the field, ${desk.length} at the desk`}
        actions={
          <button type="button" className="crm-btn crm-btn--primary" disabled>
            Add staff
          </button>
        }
      />

      <div className="crm-stats">
        <Stat label="Tour leaders" value={leaders.length} />
        <Stat label="Desk executives" value={desk.length} />
        <Stat label="Leaders out or committed" value={committed} />
      </div>

      <Panel title="Tour leaders" count={`${leaders.length}`} flush>
        <div className="crm-tablewrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Staff code</th>
                <th>Based in</th>
                <th>Languages</th>
                <th>Mobile</th>
                <th>Login</th>
                <th>Joined</th>
                <th>Leading</th>
              </tr>
            </thead>
            <tbody>
              {leaders.length === 0 ? (
                <EmptyRow columns={8} message="No tour leaders on the books." />
              ) : (
                leaders.map((record) => (
                  <StaffRow key={record.staff.staffId} record={record} showTours />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Desk executives" count={`${desk.length}`} flush>
        <div className="crm-tablewrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Staff code</th>
                <th>Based in</th>
                <th>Languages</th>
                <th>Mobile</th>
                <th>Login</th>
                <th>Joined</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {desk.length === 0 ? (
                <EmptyRow columns={8} message="No desk executives on the books." />
              ) : (
                desk.map((record) => <StaffRow key={record.staff.staffId} record={record} />)
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function StaffRow({ record, showTours }: { record: StaffRecord; showTours?: boolean }) {
  const { staff: person, assignments } = record;

  return (
    <tr>
      <td className="crm-nowrap">
        {person.fullName}
        {person.active ? null : <span className="crm-muted"> (inactive)</span>}
      </td>
      <td className="crm-mono">{person.staffCode}</td>
      <td className="crm-nowrap">{person.basedIn}</td>
      <td className="crm-nowrap">{person.languages.join(', ')}</td>
      <td className="crm-mono">{person.phone}</td>
      <td className="crm-mono">{person.loginEmail}</td>
      <td className="crm-nowrap">{date(person.joinedOn)}</td>
      <td>
        {showTours === true ? (
          assignments.length === 0 ? (
            <span className="crm-muted">Nothing rostered</span>
          ) : (
            assignments.map((assignment, index) => (
              <span key={`${assignment.tourId}:${assignment.dutyRole}`}>
                {index > 0 ? ', ' : ''}
                <Link to={`/trips/${encodeURIComponent(assignment.tourId)}`}>
                  {assignment.tourTitle}
                </Link>
                {/* A leader can also ride along as an assistant, and the desk
                    needs to see which hat they are wearing on that departure. */}
                {assignment.dutyRole === 'LEAD_LEADER' ? null : (
                  <span className="crm-muted"> ({dutyLabel(assignment.dutyRole)})</span>
                )}
              </span>
            ))
          )
        ) : (
          <StaffRoleChip role={person.role} />
        )}
      </td>
    </tr>
  );
}
