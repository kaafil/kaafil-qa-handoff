/**
 * The handful of presentational pieces every CRM screen repeats: a status
 * chip, a panel, a page heading, and the two states a table can be in before
 * it has rows.
 */

import type { ReactNode } from 'react';
import type {
  BookingStatus,
  DutyRole,
  MealPreference,
  StaffRole,
  TourStatus,
  TourStyle,
} from '../../../fixtures/types';
import type { CrmApiError } from './api';
import { humanise } from './format';

type ChipTone = 'green' | 'amber' | 'red' | 'slate' | 'teal' | 'blue';

export function Chip({ tone, label }: { tone: ChipTone; label: string }) {
  return <span className={`crm-chip crm-chip--${tone}`}>{label}</span>;
}

/**
 * The colour a departure gets in the list. ON_TOUR is the only one the desk
 * actively watches, so it is the only one that gets a hue nothing else uses.
 */
const TOUR_STATUS_TONE: Record<TourStatus, ChipTone> = {
  CONFIRMED: 'blue',
  ON_TOUR: 'teal',
  RETURNED: 'amber',
  CLOSED: 'slate',
  CALLED_OFF: 'red',
};

const TOUR_STATUS_LABEL: Record<TourStatus, string> = {
  CONFIRMED: 'Confirmed',
  ON_TOUR: 'On tour',
  RETURNED: 'Returned',
  CLOSED: 'Closed',
  CALLED_OFF: 'Called off',
};

export function TourStatusChip({ status }: { status: TourStatus }) {
  return <Chip tone={TOUR_STATUS_TONE[status]} label={TOUR_STATUS_LABEL[status]} />;
}

const BOOKING_STATUS_TONE: Record<BookingStatus, ChipTone> = {
  PAID_IN_FULL: 'green',
  PART_PAID: 'amber',
  REFUND_DUE: 'red',
  REFUNDED: 'slate',
};

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PAID_IN_FULL: 'Paid in full',
  PART_PAID: 'Part paid',
  REFUND_DUE: 'Refund due',
  REFUNDED: 'Refunded',
};

export function BookingStatusChip({ status }: { status: BookingStatus }) {
  return <Chip tone={BOOKING_STATUS_TONE[status]} label={BOOKING_STATUS_LABEL[status]} />;
}

const STYLE_LABEL: Record<TourStyle, string> = {
  GROUP_TOUR: 'Group tour',
  TREK: 'Trek',
};

export function TourStyleChip({ style }: { style: TourStyle }) {
  return <Chip tone={style === 'TREK' ? 'teal' : 'slate'} label={STYLE_LABEL[style]} />;
}

const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  TOUR_LEADER: 'Tour leader',
  DESK_EXECUTIVE: 'Desk executive',
};

export function StaffRoleChip({ role }: { role: StaffRole }) {
  return <Chip tone={role === 'TOUR_LEADER' ? 'teal' : 'blue'} label={STAFF_ROLE_LABEL[role]} />;
}

const DUTY_LABEL: Record<DutyRole, string> = {
  LEAD_LEADER: 'Lead leader',
  ASSISTANT_LEADER: 'Assistant leader',
  DESK_OWNER: 'Desk owner',
};

export function dutyLabel(duty: DutyRole): string {
  return DUTY_LABEL[duty];
}

const MEAL_LABEL: Record<MealPreference, string> = {
  VEG: 'Veg',
  JAIN: 'Jain',
  NON_VEG: 'Non-veg',
  VEGAN: 'Vegan',
};

export function mealLabel(meal: MealPreference): string {
  return MEAL_LABEL[meal];
}

/** Anything else that arrives as an upper-snake token. */
export function tokenLabel(token: string): string {
  return humanise(token);
}

export function PageHead({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="crm-pagehead">
      <div>
        <h1 className="crm-pagehead__title">{title}</h1>
        {meta === undefined ? null : <div className="crm-pagehead__meta">{meta}</div>}
      </div>
      {actions === undefined ? null : <div>{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  count,
  actions,
  flush,
  children,
}: {
  title: string;
  count?: ReactNode;
  actions?: ReactNode;
  /** Set on a panel whose body is a table, which brings its own padding. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="crm-panel">
      <header className="crm-panel__head">
        <span>
          {title}
          {count === undefined ? null : <span className="crm-panel__count"> — {count}</span>}
        </span>
        {actions === undefined ? null : <span>{actions}</span>}
      </header>
      <div
        className={flush === true ? 'crm-panel__body crm-panel__body--flush' : 'crm-panel__body'}
      >
        {children}
      </div>
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="crm-stat">
      <div className="crm-stat__label">{label}</div>
      <div className="crm-stat__value">{value}</div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="crm-note">Loading {what}…</div>;
}

export function Failed({ error }: { error: CrmApiError }) {
  return (
    <div className="crm-note crm-note--error">
      <strong>Could not load this page.</strong> {error.message}
    </div>
  );
}

export function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td className="crm-table__empty" colSpan={columns}>
        {message}
      </td>
    </tr>
  );
}
