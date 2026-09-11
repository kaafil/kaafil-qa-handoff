/**
 * Departures — the screen the desk lives on.
 *
 * It is a single dense table with a filter strip above it. The columns are the
 * ones that actually get argued about in the morning meeting: when it leaves,
 * who is running it, how many seats are gone, and how much money is still out.
 *
 * Every row is a `TourSummary` from `shared/crm-api.ts`: the departure record
 * itself nested under `.tour`, with the rollups the desk needs alongside it.
 * The nesting is worth keeping straight — `row.tour` is the stored departure,
 * everything beside it is computed by the server over bookings and payments.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTours, type TourSummary } from './api';
import { amount, dateRange, daysUntil, money } from './format';
import { EmptyRow, Failed, Loading, PageHead, Stat, TourStatusChip, TourStyleChip } from './ui';
import { useResource } from './useResource';

const loadTours = (signal: AbortSignal) => fetchTours(signal);

type StatusFilter = 'ALL' | TourSummary['tour']['status'];

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'ON_TOUR', label: 'On tour' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CALLED_OFF', label: 'Called off' },
];

export function TripListPage() {
  const tours = useResource(loadTours);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [region, setRegion] = useState('ALL');

  const rows: readonly TourSummary[] = tours.state === 'ready' ? tours.value.tours : [];

  const regions = useMemo(
    () => [...new Set(rows.map((row) => row.tour.region))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => status === 'ALL' || row.tour.status === status)
      .filter((row) => region === 'ALL' || row.tour.region === region)
      .filter((row) => {
        if (needle === '') return true;
        const { tour } = row;
        return (
          tour.title.toLowerCase().includes(needle) ||
          tour.tourId.toLowerCase().includes(needle) ||
          tour.packageCode.toLowerCase().includes(needle) ||
          tour.destination.toLowerCase().includes(needle) ||
          (row.leadLeader?.fullName ?? '').toLowerCase().includes(needle)
        );
      })
      .slice()
      .sort((a, b) => a.tour.startDate.localeCompare(b.tour.startDate));
  }, [rows, query, status, region]);

  // The server computes `outstandingMinor` per departure; summing it is the one
  // arithmetic the desk still owns, and re-deriving it from billed less received
  // would quietly disagree with the server on refund-bearing departures.
  const outstanding = filtered.reduce((total, row) => total + row.outstandingMinor, 0);
  const travelling = rows.filter((row) => row.tour.status === 'ON_TOUR').length;
  const upcoming = rows.filter((row) => row.tour.status === 'CONFIRMED').length;

  if (tours.state === 'loading') return <Loading what="departures" />;
  if (tours.state === 'failed') return <Failed error={tours.error} />;

  return (
    <>
      <PageHead
        title="Departures"
        meta={`${rows.length} on file · ${upcoming} selling · ${travelling} out right now`}
        actions={
          <button type="button" className="crm-btn crm-btn--primary" disabled>
            New departure
          </button>
        }
      />

      <div className="crm-stats">
        <Stat label="Departures" value={rows.length} />
        <Stat label="Seats sold" value={rows.reduce((n, row) => n + row.tour.seatsSold, 0)} />
        <Stat label="Pax booked" value={rows.reduce((n, row) => n + row.paxBooked, 0)} />
        <Stat label="Outstanding (filtered)" value={money(outstanding)} />
      </div>

      <div className="crm-filters">
        <label className="crm-field" htmlFor="crm-trip-search">
          <span className="crm-field__label">Search</span>
          <input
            id="crm-trip-search"
            className="crm-input"
            type="search"
            placeholder="Title, code, destination, leader"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <label className="crm-field" htmlFor="crm-trip-status">
          <span className="crm-field__label">Status</span>
          <select
            id="crm-trip-status"
            className="crm-select"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="crm-field" htmlFor="crm-trip-region">
          <span className="crm-field__label">Region</span>
          <select
            id="crm-trip-region"
            className="crm-select"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            <option value="ALL">All regions</option>
            {regions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
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
            setStatus('ALL');
            setRegion('ALL');
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
                  <th>Departure</th>
                  <th>Code</th>
                  <th>Dates</th>
                  <th>Region</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Lead leader</th>
                  <th className="crm-num">Seats</th>
                  <th className="crm-num">Pax</th>
                  <th className="crm-num">Billed ₹</th>
                  <th className="crm-num">Received ₹</th>
                  <th className="crm-num">Outstanding ₹</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <EmptyRow columns={12} message="No departure matches these filters." />
                ) : (
                  filtered.map((row) => <TourRow key={row.tour.tourId} row={row} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function TourRow({ row }: { row: TourSummary }) {
  const { tour } = row;
  const days = daysUntil(tour.startDate);

  return (
    <tr>
      <td className="crm-nowrap">
        <Link to={`/trips/${encodeURIComponent(tour.tourId)}`}>{tour.title}</Link>
      </td>
      <td className="crm-mono">{tour.tourId}</td>
      <td className="crm-nowrap">
        {dateRange(tour.startDate, tour.endDate)}
        {tour.status === 'CONFIRMED' && days >= 0 ? (
          <span className="crm-muted"> · in {days}d</span>
        ) : null}
      </td>
      <td className="crm-nowrap">{tour.region}</td>
      <td>
        <TourStyleChip style={tour.style} />
      </td>
      <td>
        <TourStatusChip status={tour.status} />
      </td>
      <td className="crm-nowrap">
        {row.leadLeader ? row.leadLeader.fullName : <span className="crm-muted">Unassigned</span>}
      </td>
      <td className="crm-num">
        {tour.seatsSold}/{tour.seatsTotal}
      </td>
      <td className="crm-num">{row.paxBooked}</td>
      <td className="crm-num">{amount(row.billedMinor)}</td>
      <td className="crm-num">{amount(row.receivedMinor)}</td>
      <td className={row.outstandingMinor > 0 ? 'crm-num crm-due' : 'crm-num crm-muted'}>
        {amount(row.outstandingMinor)}
      </td>
    </tr>
  );
}
