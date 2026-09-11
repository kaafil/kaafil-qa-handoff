/**
 * One departure, in four tabs.
 *
 * Overview is the file the desk opens when a customer calls; Travellers is the
 * manifest they print; Payments is the ledger they reconcile; Staff is who is
 * on it. The active tab is in the query string so a desk executive can send a
 * colleague a link to the payments of a specific departure, which is most of
 * what internal links are for here.
 */

import { useCallback, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { CrmPayment, TourDetail } from './api';
import { fetchTour } from './api';
import { amount, date, dateRange, daysUntil, money, timestamp } from './format';
import { useSession } from './session';
import {
  BookingStatusChip,
  dutyLabel,
  EmptyRow,
  Failed,
  Loading,
  mealLabel,
  PageHead,
  Panel,
  Stat,
  TourStatusChip,
  TourStyleChip,
  tokenLabel,
} from './ui';
import { useResource } from './useResource';

const TABS = ['overview', 'travellers', 'payments', 'staff'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  travellers: 'Travellers',
  payments: 'Payments',
  staff: 'Staff',
};

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

export function TripDetailPage() {
  const { tourId = '' } = useParams();
  const [search, setSearch] = useSearchParams();

  const load = useCallback((signal: AbortSignal) => fetchTour(tourId, signal), [tourId]);
  const detail = useResource(load);

  const tabParam = search.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'overview';

  if (detail.state === 'loading') return <Loading what="this departure" />;
  if (detail.state === 'failed') {
    if (detail.error.status === 404) {
      return (
        <div className="crm-note crm-note--error">
          <strong>No such departure.</strong> <code>{tourId}</code> is not in the book.{' '}
          <Link to="/trips">Back to departures</Link>
        </div>
      );
    }
    return <Failed error={detail.error} />;
  }

  const { tour, crew, bookings, travellers, billedMinor, receivedMinor, outstandingMinor } =
    detail.value;
  // Receipts hang off their booking in the contract; the ledger tab reads them
  // as one dated list, so the flattening happens once, here.
  const paymentCount = bookings.reduce((total, row) => total + row.payments.length, 0);

  return (
    <>
      <div className="crm-crumbs">
        <Link to="/trips">Departures</Link>
        <span>›</span>
        {tour.tourId}
      </div>

      <PageHead
        title={tour.title}
        meta={
          <>
            {dateRange(tour.startDate, tour.endDate)} · {tour.destination} ·{' '}
            <span className="crm-mono">{tour.packageCode}</span>
          </>
        }
        actions={
          <>
            <TourStyleChip style={tour.style} /> <TourStatusChip status={tour.status} />
          </>
        }
      />

      <div className="crm-stats">
        <Stat label="Seats" value={`${tour.seatsSold}/${tour.seatsTotal}`} />
        <Stat label="Travellers" value={travellers.length} />
        <Stat label="Bookings" value={bookings.length} />
        <Stat label="Billed" value={money(billedMinor)} />
        <Stat label="Received" value={money(receivedMinor)} />
        {/* The server totals the ledger; re-deriving it here is how the two
            halves drift apart. */}
        <Stat label="Outstanding" value={money(outstandingMinor)} />
      </div>

      <nav className="crm-tabs">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === tab ? 'crm-tab is-active' : 'crm-tab'}
            onClick={() => setSearch(name === 'overview' ? {} : { tab: name }, { replace: true })}
          >
            {TAB_LABEL[name]}
            {name === 'travellers' ? (
              <span className="crm-tab__count">{travellers.length}</span>
            ) : null}
            {name === 'payments' ? <span className="crm-tab__count">{paymentCount}</span> : null}
            {name === 'staff' ? <span className="crm-tab__count">{crew.length}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <OverviewTab detail={detail.value} /> : null}
      {tab === 'travellers' ? <TravellersTab travellers={travellers} bookings={bookings} /> : null}
      {tab === 'payments' ? <PaymentsTab bookings={bookings} /> : null}
      {tab === 'staff' ? <StaffTab crew={crew} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ detail }: { detail: TourDetail }) {
  // `leadLeader` is resolved server-side from the roster, so the desk sees the
  // same person the ingest does rather than whoever this screen picks first.
  const { tour, leadLeader } = detail;
  const days = daysUntil(tour.startDate);

  return (
    <>
      <div className="crm-cols crm-cols--2">
        <Panel title="Departure">
          <dl className="crm-dl">
            <dt>Reference</dt>
            <dd className="crm-mono">{tour.tourId}</dd>
            <dt>Package</dt>
            <dd className="crm-mono">{tour.packageCode}</dd>
            <dt>Selling mode</dt>
            <dd>{tokenLabel(tour.sellingMode)}</dd>
            <dt>Dates</dt>
            <dd>
              {dateRange(tour.startDate, tour.endDate)}
              {tour.status === 'CONFIRMED' && days >= 0 ? (
                <span className="crm-muted"> · departs in {days} days</span>
              ) : null}
            </dd>
            <dt>Boarding</dt>
            <dd>
              {tour.boardingCity} — {tour.meetingPoint}
            </dd>
            <dt>Timezone</dt>
            <dd className="crm-mono">{tour.timezone}</dd>
            <dt>Price / seat</dt>
            <dd className="crm-figure">{money(tour.pricePerSeatMinor)}</dd>
            <dt>Lead leader</dt>
            <dd>
              {leadLeader === null ? (
                <span className="crm-muted">Unassigned</span>
              ) : (
                <>
                  {leadLeader.fullName} <span className="crm-mono">{leadLeader.phone}</span>
                </>
              )}
            </dd>
            <dt>Last edited</dt>
            <dd className="crm-muted">{timestamp(tour.sourceUpdatedAt)}</dd>
          </dl>
        </Panel>

        <Panel title="Desk notes">
          <div style={{ display: 'grid', gap: 8 }}>
            {tour.calledOffOn === undefined ? null : (
              <div className="crm-note crm-note--error">
                <strong>Called off {date(tour.calledOffOn)}.</strong>{' '}
                {tour.calledOffReason ?? 'No reason recorded.'}
              </div>
            )}
            {tour.settlementDueOn === undefined ? null : (
              <div>
                <span className="crm-field__label">Settlement due</span>
                <div>{date(tour.settlementDueOn)}</div>
              </div>
            )}
            <div>
              <span className="crm-field__label">Notes</span>
              <div>{tour.notes ?? <span className="crm-muted">Nothing recorded.</span>}</div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Day plan" count={`${tour.itinerary.length} days`} flush>
        <div className="crm-tablewrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Day</th>
                <th style={{ width: 130 }}>Date</th>
                <th>Programme</th>
                <th style={{ width: 200 }}>Night halt</th>
              </tr>
            </thead>
            <tbody>
              {tour.itinerary.map((day) => (
                <tr key={day.dayNumber}>
                  <td className="crm-num">{day.dayNumber}</td>
                  <td className="crm-nowrap">{date(day.date)}</td>
                  <td>{day.title}</td>
                  <td>{day.nightHalt ?? <span className="crm-muted">In transit</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/*
        The gap in this product. Sharma Travels has never had a way to see or
        touch a departure while it is running — everything on the ground reaches
        the desk as a phone call from the leader, and the travellers see nothing
        at all. The panel has sat empty in this layout for years.
      */}
      <Panel title="On the ground">
        <div className="crm-openslot">
          <div className="crm-openslot__title">Nothing connected</div>
          <p className="crm-openslot__note">
            Rooming, day-by-day progress, leader expenses and anything the travellers themselves can
            see are all handled off-system. There is no record of them here.
          </p>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Travellers
// ---------------------------------------------------------------------------

function TravellersTab({
  travellers,
  bookings,
}: {
  travellers: TourDetail['travellers'];
  bookings: TourDetail['bookings'];
}) {
  const partyOf = useMemo(() => {
    const index = new Map<string, string>();
    for (const row of bookings) index.set(row.booking.bookingRef, row.booking.partyName);
    return index;
  }, [bookings]);

  const sorted = useMemo(
    () =>
      [...travellers].sort(
        (a, b) =>
          a.bookingRef.localeCompare(b.bookingRef) ||
          (a.partyRole === b.partyRole ? 0 : a.partyRole === 'LEAD' ? -1 : 1),
      ),
    [travellers],
  );

  const flagged = sorted.filter((person) => person.medicalNotes !== null).length;

  return (
    <Panel
      title="Manifest"
      count={`${sorted.length} travellers · ${flagged} with a medical note`}
      actions={
        <button type="button" className="crm-btn crm-btn--sm" disabled>
          Print manifest
        </button>
      }
      flush
    >
      <div className="crm-tablewrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Booking</th>
              <th>Party</th>
              <th>Role</th>
              <th>Phone</th>
              <th>City</th>
              <th>Meal</th>
              <th>Language</th>
              <th>ID proof</th>
              <th>Permit</th>
              <th>Medical note</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow columns={11} message="No travellers on this departure yet." />
            ) : (
              sorted.map((person) => (
                <tr key={person.travellerId}>
                  <td className="crm-nowrap">{person.fullName}</td>
                  <td className="crm-mono">{person.bookingRef}</td>
                  <td className="crm-nowrap">{partyOf.get(person.bookingRef) ?? '—'}</td>
                  <td>{person.partyRole === 'LEAD' ? 'Lead' : person.relationToLead}</td>
                  <td className="crm-mono">{person.phone}</td>
                  <td className="crm-nowrap">{person.city}</td>
                  <td className="crm-nowrap">{mealLabel(person.mealPreference)}</td>
                  <td>{person.preferredLanguage}</td>
                  <td className="crm-nowrap">
                    {person.idProofType === undefined ? (
                      <span className="crm-muted">—</span>
                    ) : (
                      tokenLabel(person.idProofType)
                    )}
                  </td>
                  <td className="crm-mono">
                    {person.permitNumber ?? <span className="crm-muted">—</span>}
                  </td>
                  <td>
                    {person.medicalNotes ?? <span className="crm-muted">Form returned blank</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTab({ bookings }: { bookings: TourDetail['bookings'] }) {
  // Receipts are entered by whoever was at the desk, who is usually not on this
  // departure's roster — so the names come from the office-wide staff list the
  // session already holds, not from this departure's crew.
  const { roster } = useSession();

  const staffName = useMemo(() => {
    const index = new Map<string, string>();
    for (const person of roster) index.set(person.staffId, person.fullName);
    return index;
  }, [roster]);

  // The contract nests each receipt under the booking it settles; the ledger is
  // read across the whole departure, newest first.
  const sortedPayments = useMemo(() => {
    const all: CrmPayment[] = [];
    for (const row of bookings) all.push(...row.payments);
    return all.sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  }, [bookings]);

  return (
    <>
      <Panel title="Bookings" count={`${bookings.length}`} flush>
        <div className="crm-tablewrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Party</th>
                <th className="crm-num">Pax</th>
                <th>Channel</th>
                <th>Booked</th>
                <th>Status</th>
                <th className="crm-num">Gross ₹</th>
                <th className="crm-num">Discount ₹</th>
                <th className="crm-num">Total ₹</th>
                <th className="crm-num">Received ₹</th>
                <th className="crm-num">Balance ₹</th>
                <th>Due</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 ? (
                <EmptyRow columns={13} message="No bookings on this departure." />
              ) : (
                bookings.map(({ booking }) => {
                  const balance = booking.totalMinor - booking.receivedMinor;
                  return (
                    <tr key={booking.bookingRef}>
                      <td className="crm-mono">{booking.bookingRef}</td>
                      <td className="crm-nowrap">{booking.partyName}</td>
                      <td className="crm-num">{booking.paxCount}</td>
                      <td className="crm-nowrap">{tokenLabel(booking.channel)}</td>
                      <td className="crm-nowrap">{date(booking.bookedOn)}</td>
                      <td>
                        <BookingStatusChip status={booking.status} />
                      </td>
                      <td className="crm-num">{amount(booking.grossMinor)}</td>
                      <td className="crm-num">
                        {booking.discountMinor === 0 ? (
                          <span className="crm-muted">—</span>
                        ) : (
                          amount(booking.discountMinor)
                        )}
                      </td>
                      <td className="crm-num">{amount(booking.totalMinor)}</td>
                      <td className="crm-num">{amount(booking.receivedMinor)}</td>
                      <td className={balance > 0 ? 'crm-num crm-due' : 'crm-num crm-muted'}>
                        {amount(balance)}
                      </td>
                      <td className="crm-nowrap">
                        {booking.balanceDueOn === undefined ? (
                          <span className="crm-muted">—</span>
                        ) : (
                          date(booking.balanceDueOn)
                        )}
                      </td>
                      <td className="crm-clip" title={booking.remarks}>
                        {booking.remarks ?? <span className="crm-muted">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Receipts and refunds" count={`${sortedPayments.length} entries`} flush>
        <div className="crm-tablewrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Voucher</th>
                <th>Booking</th>
                <th>Date</th>
                <th>Direction</th>
                <th>Mode</th>
                <th className="crm-num">Amount ₹</th>
                <th>Reference</th>
                <th>Entered by</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayments.length === 0 ? (
                <EmptyRow
                  columns={8}
                  message="Nothing has been receipted against this departure."
                />
              ) : (
                sortedPayments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <td className="crm-mono">{payment.paymentId}</td>
                    <td className="crm-mono">{payment.bookingRef}</td>
                    <td className="crm-nowrap">{date(payment.paidOn)}</td>
                    <td>
                      {payment.direction === 'IN' ? (
                        'Received'
                      ) : (
                        <span className="crm-due">Refunded</span>
                      )}
                    </td>
                    <td>{payment.mode}</td>
                    <td className="crm-num">
                      {payment.direction === 'OUT' ? '−' : ''}
                      {amount(payment.amountMinor)}
                    </td>
                    <td>{payment.reference}</td>
                    <td className="crm-nowrap">
                      {staffName.get(payment.recordedByStaffId) ?? payment.recordedByStaffId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function StaffTab({ crew }: { crew: TourDetail['crew'] }) {
  return (
    <Panel title="Rostered on this departure" count={`${crew.length}`} flush>
      <div className="crm-tablewrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Staff code</th>
              <th>Duty</th>
              <th>Based in</th>
              <th>Phone</th>
              <th>Languages</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {crew.length === 0 ? (
              <EmptyRow columns={7} message="Nobody is rostered on this departure yet." />
            ) : (
              crew.map(({ assignment, staff }) => (
                <tr key={`${assignment.staffId}-${assignment.dutyRole}`}>
                  <td className="crm-nowrap">{staff.fullName}</td>
                  <td className="crm-mono">{staff.staffCode}</td>
                  <td className="crm-nowrap">{dutyLabel(assignment.dutyRole)}</td>
                  <td className="crm-nowrap">{staff.basedIn}</td>
                  <td className="crm-mono">{staff.phone}</td>
                  <td>{staff.languages.join(', ')}</td>
                  <td className="crm-nowrap">{date(assignment.assignedOn)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
