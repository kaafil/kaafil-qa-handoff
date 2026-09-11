/**
 * Traveller records — every person on every manifest, in one table.
 *
 * The desk uses this exactly one way: someone rings up, gives half a name or a
 * mobile number, and the executive has to find them without knowing which
 * departure they are on. So the search box matches across name, phone, email,
 * booking reference and city, and the departure is a column rather than a
 * prerequisite.
 *
 * `/api/crm/travellers` hands back a TravellerRecord: the person's own row
 * under `.traveller`, with only the departure facts the desk needs to read a
 * name off the list bolted on beside it. Nothing here reaches for a field the
 * envelope does not carry — the departure's start date and the booking's
 * payment state are not part of that contract, so the table does not claim to
 * show them.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTravellers, type TravellerRecord } from './api';
import {
  EmptyRow,
  Failed,
  Loading,
  mealLabel,
  PageHead,
  Stat,
  TourStatusChip,
  tokenLabel,
} from './ui';
import { useResource } from './useResource';

const loadTravellers = (signal: AbortSignal) => fetchTravellers(signal);

type MedicalFilter = 'ALL' | 'FLAGGED' | 'BLANK';

export function TravellerDirectoryPage() {
  const travellers = useResource(loadTravellers);
  const [query, setQuery] = useState('');
  const [tourId, setTourId] = useState('ALL');
  const [medical, setMedical] = useState<MedicalFilter>('ALL');

  const rows: readonly TravellerRecord[] =
    travellers.state === 'ready' ? travellers.value.travellers : [];

  const tours = useMemo(() => {
    const index = new Map<string, string>();
    for (const row of rows) index.set(row.traveller.tourId, row.tourTitle);
    return [...index].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => tourId === 'ALL' || row.traveller.tourId === tourId)
      .filter((row) => {
        if (medical === 'ALL') return true;
        return medical === 'FLAGGED'
          ? row.traveller.medicalNotes !== null
          : row.traveller.medicalNotes === null;
      })
      .filter((row) => {
        if (needle === '') return true;
        const person = row.traveller;
        return (
          person.fullName.toLowerCase().includes(needle) ||
          person.phone.includes(needle) ||
          (person.email ?? '').toLowerCase().includes(needle) ||
          person.bookingRef.toLowerCase().includes(needle) ||
          person.city.toLowerCase().includes(needle) ||
          person.travellerId.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.traveller.fullName.localeCompare(b.traveller.fullName));
  }, [rows, query, tourId, medical]);

  if (travellers.state === 'loading') return <Loading what="traveller records" />;
  if (travellers.state === 'failed') return <Failed error={travellers.error} />;

  const flagged = rows.filter((row) => row.traveller.medicalNotes !== null).length;
  const travelling = rows.filter((row) => row.tourStatus === 'ON_TOUR').length;

  return (
    <>
      <PageHead
        title="Traveller records"
        meta={`${rows.length} people across ${tours.length} departures`}
      />

      <div className="crm-stats">
        <Stat label="On file" value={rows.length} />
        <Stat label="Out right now" value={travelling} />
        <Stat label="Medical notes" value={flagged} />
        <Stat label="Departures" value={tours.length} />
      </div>

      <div className="crm-filters">
        <label className="crm-field" htmlFor="crm-traveller-search">
          <span className="crm-field__label">Search</span>
          <input
            id="crm-traveller-search"
            className="crm-input"
            type="search"
            placeholder="Name, mobile, email, booking ref"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ minWidth: 260 }}
          />
        </label>

        <label className="crm-field" htmlFor="crm-traveller-tour">
          <span className="crm-field__label">Departure</span>
          <select
            id="crm-traveller-tour"
            className="crm-select"
            value={tourId}
            onChange={(event) => setTourId(event.target.value)}
            style={{ minWidth: 240 }}
          >
            <option value="ALL">All departures</option>
            {tours.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>

        <label className="crm-field" htmlFor="crm-traveller-medical">
          <span className="crm-field__label">Medical form</span>
          <select
            id="crm-traveller-medical"
            className="crm-select"
            value={medical}
            onChange={(event) => setMedical(event.target.value as MedicalFilter)}
          >
            <option value="ALL">Any</option>
            <option value="FLAGGED">Has a note</option>
            <option value="BLANK">Returned blank</option>
          </select>
        </label>

        <span className="crm-filters__spacer" />
        <span className="crm-filters__result">
          Showing {filtered.length} of {rows.length}
        </span>
        <button
          type="button"
          className="crm-btn"
          onClick={() => {
            setQuery('');
            setTourId('ALL');
            setMedical('ALL');
          }}
        >
          Clear
        </button>
      </div>

      <div className="crm-panel">
        <div className="crm-panel__body crm-panel__body--flush">
          <div className="crm-tablewrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Record</th>
                  <th>Mobile</th>
                  <th>City</th>
                  <th>Departure</th>
                  <th>Tour status</th>
                  <th>Booking</th>
                  <th>Party</th>
                  <th>In party</th>
                  <th>Meal</th>
                  <th>Medical note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <EmptyRow columns={11} message="No traveller matches this search." />
                ) : (
                  filtered.map((row) => <TravellerRow key={row.traveller.travellerId} row={row} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function TravellerRow({ row }: { row: TravellerRecord }) {
  const person = row.traveller;
  return (
    <tr>
      <td className="crm-nowrap">{person.fullName}</td>
      <td className="crm-mono">{person.travellerId}</td>
      <td className="crm-mono">{person.phone}</td>
      <td className="crm-nowrap">{person.city}</td>
      <td className="crm-nowrap">
        <Link to={`/trips/${encodeURIComponent(person.tourId)}?tab=travellers`}>
          {row.tourTitle}
        </Link>
      </td>
      <td>
        <TourStatusChip status={row.tourStatus} />
      </td>
      <td className="crm-mono">{person.bookingRef}</td>
      <td className="crm-nowrap">{row.partyName}</td>
      {/* The lead is who the desk rings; a member is reached through them. */}
      <td className="crm-nowrap">{tokenLabel(person.partyRole)}</td>
      <td>{mealLabel(person.mealPreference)}</td>
      <td className="crm-clip" title={person.medicalNotes ?? undefined}>
        {person.medicalNotes ?? <span className="crm-muted">Returned blank</span>}
      </td>
    </tr>
  );
}
