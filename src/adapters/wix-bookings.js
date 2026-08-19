/**
 * The Wix implementation of `BookingsRepository`.
 *
 * This is the only file in Samson that knows what a Wix reservation looks like.
 * Everything it returns is in the vocabulary of `domain.js`.
 */

import { WixClient } from '../wix.js';
import { STATUS, PAYMENT } from '../domain.js';

const RESERVATIONS_QUERY = '/table-reservations/reservations/v1/reservations/query';
const RESERVATION = '/table-reservations/reservations/v1/reservations';
const EXPERIENCES_QUERY = '/table-reservations/experiences/v1/experiences/query';
const LOCATIONS_QUERY = '/table-reservations/reservation-locations/v1/reservation-locations/query';

// The schedule and the experiences barely change; reservations change while
// somebody is looking at them, so they are never served from cache.
const CONFIG_TTL = 600;

/** When no experience says otherwise. A table is two hours. */
const DEFAULT_MINUTES = 120;

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
  constructor(env, ctx) {
    this.wix = new WixClient(env);
    this.ctx = ctx;
    this.customFieldLabels = null;
    this.rawExperiences = null;
  }

  /**
   * Both the experience list and the custom-field labels are built from the
   * same query, and every page needs both. Fetching it once per request — and
   * from the edge cache between requests — is most of the difference between a
   * page that takes five round trips and one that takes two.
   */
  experienceRecords() {
    this.rawExperiences ||= this.wix.cachedQueryAll(
      EXPERIENCES_QUERY, {}, 'experiences', { ttl: CONFIG_TTL, key: 'all', ctx: this.ctx },
    );
    return this.rawExperiences;
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
    );

    const labels = await this.fieldLabels();
    return reservations
      .map((reservation) => toBooking(reservation, labels))
      .sort((a, b) => a.startsAt - b.startsAt || a.guestName.localeCompare(b.guestName));
  }

  /**
   * Applies a change to one reservation.
   *
   * The revision is read immediately beforehand rather than taken from the page
   * the button was on: that page may have been rendered an hour ago, and Wix
   * rejects a stale revision — correctly, since somebody else may have touched
   * the booking since. Reading it fresh turns "your screen is out of date" into
   * a non-event.
   */
  /** The location every reservation belongs to. One lodge, one location. */
  async locationId() {
    if (this.location) return this.location;
    const locations = await this.wix.cachedQueryAll(LOCATIONS_QUERY, {}, 'reservationLocations',
      { ttl: CONFIG_TTL, key: 'all', ctx: this.ctx });
    const first = locations[0];
    if (!first?.id) throw new Error('This site has no reservation location.');
    this.location = first.id;
    return this.location;
  }

  /**
   * Writes a booking somebody took over the phone.
   *
   * `OFFLINE` is Wix's own word for it — "made by a restaurant employee, for
   * example when a customer calls" — and it is why a phone number and a first
   * name are not optional here: any source but `WALK_IN` is rejected without
   * them. Status is left unset so Wix decides between RESERVED and REQUESTED
   * by the location's own approval setting rather than us asserting one.
   */
  async create(draft) {
    const [locationId, experiences] = await Promise.all([this.locationId(), this.experiences()]);
    // experiences() is a Map keyed by id, not a list.
    const experience = draft.experienceId ? experiences.get(draft.experienceId) || null : null;

    const minutes = experience?.durationMins || DEFAULT_MINUTES;
    const endsAt = new Date(draft.startsAt.getTime() + minutes * 60_000);

    const created = await this.wix.post(RESERVATION, {
      reservation: {
        details: {
          reservationLocationId: locationId,
          ...(experience ? { experienceId: experience.id } : {}),
          startDate: draft.startsAt.toISOString(),
          endDate: endsAt.toISOString(),
          partySize: draft.partySize,
        },
        reservee: {
          firstName: draft.firstName,
          ...(draft.lastName ? { lastName: draft.lastName } : {}),
          phone: draft.phone,
          ...(draft.email ? { email: draft.email } : {}),
        },
        source: 'OFFLINE',
        ...(draft.teamMessage ? { teamMessage: draft.teamMessage } : {}),
      },
    });

    const reservation = created.reservation;
    if (!reservation) throw new Error('Wix accepted that but returned no booking.');
    return toBooking(reservation, await this.fieldLabels());
  }

  async apply(id, changes, allowed = null) {
    const current = await this.wix.get(`${RESERVATION}/${encodeURIComponent(id)}?fieldsets=FULL`);
    const reservation = current.reservation;
    if (!reservation) throw new Error('That booking no longer exists.');

    // The read that fetches the revision is also the read that says what this
    // booking is, so the caller can rule the change out before it is written
    // without paying for a second round trip. Which matters: the page decides
    // what to offer, and a form post does not have to come from the page.
    if (allowed && !allowed(toBooking(reservation, await this.fieldLabels()))) {
      throw new Error('That is not something you can do to this booking.');
    }

    const updated = await this.wix.patch(`${RESERVATION}/${encodeURIComponent(id)}`, {
      reservation: { id, revision: reservation.revision, ...changes },
    });
    return toBooking(updated.reservation || reservation, await this.fieldLabels());
  }

  /** Experiences by id, so a sitting can show what it is and how full it is. */
  async experiences() {
    const experiences = await this.experienceRecords();

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
      this.wix.cachedQueryAll(LOCATIONS_QUERY, {}, 'reservationLocations',
        { ttl: CONFIG_TTL, key: 'all', ctx: this.ctx }),
      this.experienceRecords(),
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
    revision: reservation.revision,
    experienceId: details.experienceId || null,
    createdAt: new Date(reservation.createdDate),
    status: STATUS_FROM_WIX[reservation.status] || reservation.status,
    payment: PAYMENT_FROM_WIX[reservation.paymentStatus] || PAYMENT.unpaid,
    source: SOURCE_FROM_WIX[reservation.source] || 'online',
    archived: reservation.archived === true,
  };
}

function pricePence(policy) {
  const amount = policy?.perGuestOptions?.price ?? policy?.perReservationOptions?.price;
  return amount == null ? null : Math.round(Number(amount) * 100);
}
