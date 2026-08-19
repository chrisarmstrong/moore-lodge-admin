/**
 * The Wix implementation of `BookingsRepository`.
 *
 * This is the only file in Samson that knows what a Wix reservation looks like.
 * Everything it returns is in the vocabulary of `domain.js`.
 */

import { WixClient } from '../wix.js';
import { STATUS, PAYMENT } from '../domain.js';

const RESERVATIONS_QUERY = '/table-reservations/reservations/v1/reservations/query';
const EXPERIENCES_QUERY = '/table-reservations/experiences/v1/experiences/query';
const LOCATIONS_QUERY = '/table-reservations/reservation-locations/v1/reservation-locations/query';

// Reservations move; the schedule and the experiences barely do.
const RESERVATIONS_TTL = 30;
const CONFIG_TTL = 600;

const STATUS_FROM_WIX = {
  HELD: STATUS.held,
  PAYMENT_INFORMATION_PENDING: STATUS.awaitingPayment,
  REQUESTED: STATUS.requested,
  RESERVED: STATUS.confirmed,
  SEATED: STATUS.seated,
  FINISHED: STATUS.finished,
  CANCELED: STATUS.cancelled,
  DECLINED: STATUS.declined,
  NO_SHOW: STATUS.noShow,
};

const PAYMENT_FROM_WIX = {
  PAID: PAYMENT.paid,
  PARTIALLY_PAID: PAYMENT.partial,
  NOT_PAID: PAYMENT.unpaid,
  REFUNDED: PAYMENT.refunded,
};

const SOURCE_FROM_WIX = {
  ONLINE: 'online',
  OFFLINE: 'phone',
  WALK_IN: 'walk-in',
};

export class WixBookings {
  constructor(env) {
    this.wix = new WixClient(env);
    this.customFieldLabels = null;
  }

  /**
   * Every reservation starting inside a UTC window.
   *
   * Two things about this query were learned the hard way against the live API:
   *
   * 1. A range cannot be written as one object. `{$gte: a, $lt: b}` is rejected
   *    with "unsupported operator" — the parser reads the whole object as the
   *    operator name. Each bound has to be its own condition under `$and`.
   * 2. The sortable path is `details.startDate`, not `startDate`. The short
   *    form fails as an unknown sort path.
   */
  async inRange({ start, end }) {
    const reservations = await this.wix.queryAll(
      RESERVATIONS_QUERY,
      {
        filter: {
          $and: [
            { 'details.startDate': { $gte: start.toISOString() } },
            { 'details.startDate': { $lt: end.toISOString() } },
          ],
        },
        sort: [{ fieldName: 'details.startDate', order: 'ASC' }],
      },
      'reservations',
      { cacheTtl: RESERVATIONS_TTL },
    );

    const labels = await this.fieldLabels();
    return reservations
      .map((reservation) => toBooking(reservation, labels))
      .sort((a, b) => a.startsAt - b.startsAt || a.guestName.localeCompare(b.guestName));
  }

  /** Experiences by id, so a sitting can show what it is and how full it is. */
  async experiences() {
    const experiences = await this.wix.queryAll(
      EXPERIENCES_QUERY,
      {},
      'experiences',
      { cacheTtl: CONFIG_TTL },
    );

    return new Map(experiences.map((experience) => {
      const config = experience.configuration || {};
      const online = config.onlineReservations || {};
      return [experience.id, {
        id: experience.id,
        name: config.displayInfo?.name || 'Experience',
        pricePence: pricePence(config.paymentPolicy),
        seatsPerSitting: online.maxGuests?.number ?? null,
        partyMin: online.partySize?.min ?? null,
        partyMax: online.partySize?.max ?? null,
        durationMins: online.businessSchedule?.durationInMinutes ?? null,
        visible: config.visible !== false && !experience.archived,
      }];
    }));
  }

  /**
   * Custom questions are stored against a uuid, and the answer is meaningless
   * without the label. Both the location and each experience define their own,
   * so the map is built from both.
   */
  async fieldLabels() {
    if (this.customFieldLabels) return this.customFieldLabels;

    const labels = new Map();
    const collect = (form) => {
      for (const field of form?.customFieldDefinitions || []) {
        if (field.id) labels.set(field.id, field.name || 'Note');
      }
    };

    const [locations, experiences] = await Promise.all([
      this.wix.queryAll(LOCATIONS_QUERY, {}, 'reservationLocations', { cacheTtl: CONFIG_TTL }),
      this.wix.queryAll(EXPERIENCES_QUERY, {}, 'experiences', { cacheTtl: CONFIG_TTL }),
    ]);

    for (const location of locations) collect(location.configuration?.reservationForm);
    for (const experience of experiences) collect(experience.configuration?.reservationForm);

    this.customFieldLabels = labels;
    return labels;
  }
}

function toBooking(reservation, labels) {
  const details = reservation.details || {};
  const reservee = reservation.reservee || {};
  const startsAt = new Date(details.startDate);
  const endsAt = details.endDate ? new Date(details.endDate) : startsAt;

  const name = [reservee.firstName, reservee.lastName].filter(Boolean).join(' ').trim();

  return {
    id: reservation.id,
    // Wix has no short reference, so the tail of the id is the next best thing
    // to read down a telephone.
    reference: (reservation.id || '').slice(-6).toUpperCase(),
    startsAt,
    endsAt,
    partySize: details.partySize || 0,
    guestName: name || 'No name given',
    email: reservee.email || null,
    phone: reservee.phone || null,
    notes: Object.entries(reservee.customFields || {})
      .filter(([, value]) => value != null && String(value).trim() !== '')
      .map(([id, value]) => ({
        // Staff write these questions as sentences — "Please confirm any
        // allergies." — and the view adds its own colon after the label.
        label: (labels.get(id) || 'Note').trim().replace(/[.:\s]+$/, ''),
        value: String(value).trim(),
      })),
    teamMessage: reservation.teamMessage || null,
    experienceId: details.experienceId || null,
    createdAt: new Date(reservation.createdDate),
    status: STATUS_FROM_WIX[reservation.status] || reservation.status,
    payment: PAYMENT_FROM_WIX[reservation.paymentStatus] || PAYMENT.unpaid,
    source: SOURCE_FROM_WIX[reservation.source] || 'online',
  };
}

function pricePence(policy) {
  const amount = policy?.perGuestOptions?.price ?? policy?.perReservationOptions?.price;
  return amount == null ? null : Math.round(Number(amount) * 100);
}
