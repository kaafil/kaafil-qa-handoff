/**
 * Sharma Travels' own data, straight out of SQLite.
 *
 * Nothing in this file touches Kaafil, and that is the point of the whole
 * exercise. These four routes back the CRM screens the QA finds already
 * working when they clone the repo — the departures list, a departure's
 * detail page, traveller records, the staff roster. They are the product that
 * existed before Kaafil turned up, and they must keep working untouched while
 * the QA fits the UI Kit in beside them.
 *
 *   GET /api/crm/trips        the departures list, with money rolled up
 *   GET /api/crm/trips/:id    one departure: crew, bookings, payments, manifest
 *   GET /api/crm/travellers   every traveller record
 *   GET /api/crm/staff        the staff roster and who is rostered where
 *
 * The CRM says "tour"; the routes say "trip". That mismatch is deliberate and
 * left in: `/api/crm/trips` is the URL a fifteen-year-old CRM would already
 * have, and the vocabulary gap between a partner's nouns and Kaafil's is a
 * real part of the integration, not something to tidy away in advance.
 *
 * Paths and response shapes come from `shared/crm-api.ts`, which the browser
 * imports too. Each handler below is annotated with its response type so a
 * change on either side of the wire fails to compile instead of 404-ing at
 * runtime — which is exactly how the first build of this repo shipped a client
 * calling routes that did not exist.
 */

import {
  CRM_API,
  type StaffResponse,
  type TourResponse,
  type ToursResponse,
  type TravellersResponse,
} from '../../shared/crm-api.js';
import type { CrmStore } from '../db.js';
import { HttpError, type Route } from '../http.js';

export function createCrmRoutes(store: CrmStore): readonly Route[] {
  return [
    {
      method: 'GET',
      pattern: CRM_API.tours,
      handle(): ToursResponse {
        return { agency: store.agency(), tours: store.listTours() };
      },
    },

    {
      method: 'GET',
      pattern: CRM_API.tourPattern,
      handle({ params }): TourResponse {
        const tourId = params.tourId ?? '';
        const detail = store.getTour(tourId);
        if (detail === null) {
          throw new HttpError(404, `No departure "${tourId}" in this CRM.`, 'CRM_TOUR_NOT_FOUND');
        }
        return detail;
      },
    },

    {
      method: 'GET',
      pattern: CRM_API.travellers,
      handle(): TravellersResponse {
        return { travellers: store.listTravellers() };
      },
    },

    {
      method: 'GET',
      pattern: CRM_API.staff,
      handle(): StaffResponse {
        return { staff: store.listStaff() };
      },
    },
  ];
}
