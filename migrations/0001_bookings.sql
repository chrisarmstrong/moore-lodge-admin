-- Samson's own booking store.
--
-- The other side of the seam in `src/domain.js`. Everything here exists to be
-- read back out as a `Booking`, `Sitting` or `Experience` by a `LodgeBookings`
-- adapter, so that no view ever learns this schema exists — the same promise
-- the Wix adapter keeps today.
--
-- Four decisions are baked in, and `docs/bookings.md` argues each one:
--
--   1. A booking is a list of lines, not a party size against one experience.
--   2. Money is a ledger. Payment status is derived, never stored.
--   3. A voucher is a payment method, so it settles through that same ledger.
--   4. Sittings are generated rows, not a recurrence rule read at query time.
--
-- Money is integer pence throughout. Prices are what the guest pays — VAT
-- inclusive, because we swallow it — with the rate carried alongside so that
-- an old booking is never recomputed at a new rate.
--
-- Instants are ISO 8601 UTC text, which sorts lexicographically in the order it
-- sorts chronologically, and which can be read in the D1 console without a
-- conversion. Local dates and times are stored beside them: a 13:00 sitting is
-- 13:00 on both sides of a clock change, and `src/time.js` already knows how to
-- put those two facts together.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- catalogue

-- One row for a long time. It is here from the first migration because adding
-- a tenant column to a live booking system is a weekend nobody enjoys, and
-- Langholm Group is a group.
CREATE TABLE venue (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'Europe/London',
  vat_number  TEXT,                      -- printed on every receipt
  created_at  TEXT NOT NULL
);

-- Where a sitting happens, and how many it seats when it does.
--
-- There is one kitchen, so a sitting's capacity is complete on the sitting
-- itself and no pool row is needed. If tea ever runs in two rooms at once the
-- pass becomes the constraint rather than the room, and that arrives as a new
-- table joined to `sitting` — nothing here has to move for it.
CREATE TABLE space (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT NOT NULL REFERENCES venue(id),
  name         TEXT NOT NULL,            -- 'Orangery', 'Dining Room'
  seats        INTEGER NOT NULL,         -- realisable covers, not the fire limit
  sort_order   INTEGER NOT NULL DEFAULT 0,
  retired_at   TEXT
);

-- The marketed idea. 'Afternoon Tea'.
CREATE TABLE experience (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT NOT NULL REFERENCES venue(id),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  summary      TEXT,
  description  TEXT,
  visible      INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  retired_at   TEXT,
  UNIQUE (venue_id, slug)
);

-- A priced variant of it. 'Classic', 'Champagne', 'Little Lodgers'.
--
-- `kind` is what separates a seat from a thing sold alongside one. A seat
-- consumes capacity; an add-on does not, which is the whole of the difference
-- and the reason upsells need no second structure.
CREATE TABLE offering (
  id             TEXT PRIMARY KEY,
  experience_id  TEXT NOT NULL REFERENCES experience(id),
  name           TEXT NOT NULL,
  description    TEXT,
  kind           TEXT NOT NULL DEFAULT 'seat'
                 CHECK (kind IN ('seat', 'addon')),
  price_pence    INTEGER NOT NULL,       -- gross, what the guest pays
  vat_rate_bp    INTEGER NOT NULL DEFAULT 2000,  -- basis points; 2000 = 20%
  seats_used     INTEGER NOT NULL DEFAULT 1,     -- 0 for an add-on
  per_guest      INTEGER NOT NULL DEFAULT 1,     -- a cake is per booking
  lead_time_mins INTEGER,                        -- a cake needs 48 hours
  duration_mins  INTEGER NOT NULL DEFAULT 120,
  party_min      INTEGER,
  party_max      INTEGER,
  visible        INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  retired_at     TEXT
);

CREATE INDEX offering_by_experience ON offering (experience_id, kind);

-- How sittings get made. A generator, never consulted at query time.
CREATE TABLE schedule_rule (
  id            TEXT PRIMARY KEY,
  offering_id   TEXT NOT NULL REFERENCES offering(id),
  space_id      TEXT NOT NULL REFERENCES space(id),
  weekdays      TEXT NOT NULL,           -- '5,6,0' — ISO weekday numbers
  local_times   TEXT NOT NULL,           -- '12:00,14:30,17:00'
  seats         INTEGER,                 -- overrides the space's own count
  price_pence   INTEGER,                 -- overrides the offering's
  starts_on     TEXT NOT NULL,           -- YYYY-MM-DD
  ends_on       TEXT,
  created_at    TEXT NOT NULL,
  retired_at    TEXT
);

-- A dated instance, and the row every seat is counted against.
--
-- `taken` is maintained only by the conditional UPDATE in the booking path:
--
--   UPDATE sitting SET taken = taken + :n
--    WHERE id = :id AND taken + :n <= seats + overbook_allowance;
--
-- D1 is SQLite and a single statement is atomic, so that is the whole oversell
-- guard. `changes() = 0` means it did not fit. `overbook_allowance` is the
-- feature rather than a hack: the public checkout always passes zero, and the
-- phone form can pass more behind a warning and an audit row.
CREATE TABLE sitting (
  id                  TEXT PRIMARY KEY,
  venue_id            TEXT NOT NULL REFERENCES venue(id),
  offering_id         TEXT NOT NULL REFERENCES offering(id),
  space_id            TEXT NOT NULL REFERENCES space(id),
  rule_id             TEXT REFERENCES schedule_rule(id),
  starts_at           TEXT NOT NULL,     -- ISO 8601 UTC
  local_date          TEXT NOT NULL,     -- YYYY-MM-DD, as the diary reads it
  local_time          TEXT NOT NULL,     -- HH:MM, unchanged by a clock change
  duration_mins       INTEGER NOT NULL,
  seats               INTEGER NOT NULL,
  taken               INTEGER NOT NULL DEFAULT 0,
  overbook_allowance  INTEGER NOT NULL DEFAULT 0,
  price_pence         INTEGER NOT NULL,  -- captured, so a rise cannot reach back
  vat_rate_bp         INTEGER NOT NULL DEFAULT 2000,
  state               TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (state IN ('scheduled', 'closed', 'cancelled')),
  note                TEXT,              -- why it was closed or called off
  created_at          TEXT NOT NULL,
  CHECK (taken >= 0)
);

CREATE INDEX sitting_by_date  ON sitting (venue_id, local_date, local_time);
CREATE INDEX sitting_by_start ON sitting (venue_id, starts_at);
CREATE UNIQUE INDEX sitting_once_per_slot
  ON sitting (offering_id, space_id, starts_at);

-- ------------------------------------------------------------------- terms

-- Cancellation terms are flexible today and staff discretion is the mechanism:
-- nothing here forfeits money on its own. It is versioned and snapshotted onto
-- the booking anyway, so that tightening the terms later can never change what
-- somebody agreed to last November.
CREATE TABLE policy (
  id                TEXT PRIMARY KEY,
  venue_id          TEXT NOT NULL REFERENCES venue(id),
  version           INTEGER NOT NULL,
  free_before_mins  INTEGER,             -- full refund beyond this. NULL = always
  terms             TEXT NOT NULL,       -- the words the guest was shown
  effective_from    TEXT NOT NULL,
  UNIQUE (venue_id, version)
);

-- ------------------------------------------------------------------ trade

-- The person, kept across bookings so a regular reads as one.
--
-- Recognition is by email and phone rather than by name — the live Wix diary
-- has the same guest booking as both 'Jacqui' and 'Bridget' on one address.
-- `contactKeys()` in `src/domain.js` already does the matching.
CREATE TABLE guest (
  id            TEXT PRIMARY KEY,
  venue_id      TEXT NOT NULL REFERENCES venue(id),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  email_key     TEXT,                    -- lowercased, trimmed
  phone_key     TEXT,                    -- last nine digits
  marketing_ok  INTEGER NOT NULL DEFAULT 0,   -- never gates a confirmation
  created_at    TEXT NOT NULL,
  purge_after   TEXT                     -- guest detail goes; the ledger stays
);

CREATE INDEX guest_by_email ON guest (venue_id, email_key);
CREATE INDEX guest_by_phone ON guest (venue_id, phone_key);

-- The order. It carries no money of its own: what has been paid is a question
-- for `ledger_entry`, and `PAYMENT` in `src/domain.js` is derived from it.
--
-- A hold is a booking in status 'held' with `holds_until` set, rather than a
-- table of its own. Wix works the same way, which is why `HOLD_MINUTES` and the
-- whole `DISPOSITION` vocabulary already exist and carry over unchanged.
CREATE TABLE booking (
  id                TEXT PRIMARY KEY,
  venue_id          TEXT NOT NULL REFERENCES venue(id),
  reference         TEXT NOT NULL,       -- short, quotable down a phone
  guest_id          TEXT NOT NULL REFERENCES guest(id),
  status            TEXT NOT NULL
                    CHECK (status IN ('held', 'awaiting-payment', 'requested',
                                      'confirmed', 'seated', 'finished',
                                      'cancelled', 'declined', 'no-show')),
  source            TEXT NOT NULL DEFAULT 'online'
                    CHECK (source IN ('online', 'phone', 'walk-in', 'import')),
  holds_until       TEXT,                -- set while status is held
  team_message      TEXT,                -- ours, never the guest's own words
  policy_id         TEXT REFERENCES policy(id),
  policy_snapshot   TEXT,                -- the terms as shown, frozen
  access_token      TEXT,                -- signs the guest's manage-my-booking link
  archived          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  cancelled_at      TEXT,
  wix_ref           TEXT,                -- set by the importer, never after
  UNIQUE (venue_id, reference)
);

CREATE INDEX booking_by_guest  ON booking (guest_id);
CREATE INDEX booking_by_status ON booking (venue_id, status, created_at);
CREATE INDEX booking_expiring  ON booking (holds_until) WHERE holds_until IS NOT NULL;
CREATE UNIQUE INDEX booking_wix_once ON booking (wix_ref) WHERE wix_ref IS NOT NULL;

-- One row per thing sold. This is the decision the schema turns on.
--
-- A party of four wanting two Classic, one Champagne and a children's tea is
-- four lines, not a party size of four. Mixed parties, upsells, packages and
-- refunding a single guest all fall out of that; none of them need anything
-- added here. A package is expanded into lines at checkout rather than being a
-- bookable of its own, so it inherits every rule the lines already obey.
--
-- Price and VAT are captured at sale. A rise cannot reach back, and a rate
-- change cannot recompute a receipt somebody already has.
CREATE TABLE booking_line (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  sitting_id    TEXT REFERENCES sitting(id),   -- null for a booking-wide add-on
  offering_id   TEXT NOT NULL REFERENCES offering(id),
  quantity      INTEGER NOT NULL DEFAULT 1,
  seats_used    INTEGER NOT NULL DEFAULT 1,    -- captured; zero for an add-on
  price_pence   INTEGER NOT NULL,              -- gross, per unit, as sold
  vat_rate_bp   INTEGER NOT NULL,
  bundle_ref    TEXT,                          -- lines a package generated together
  voided_at     TEXT,                          -- amendments void, never delete
  created_at    TEXT NOT NULL,
  CHECK (quantity > 0)
);

CREATE INDEX line_by_booking ON booking_line (booking_id);
CREATE INDEX line_by_sitting ON booking_line (sitting_id) WHERE voided_at IS NULL;

-- Who is actually sitting there, and what they cannot eat.
--
-- Allergy information is health data and is treated as special category under
-- UK GDPR, which is why it hangs off a person rather than a booking and why
-- `guest.purge_after` exists. A table of eight with one coeliac needs the
-- allergen attached to a plate, not to the party.
CREATE TABLE booking_guest (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  line_id      TEXT REFERENCES booking_line(id),
  name         TEXT,
  dietary      TEXT,
  given_at     TEXT
);

CREATE INDEX booking_guest_by_booking ON booking_guest (booking_id);

-- ---------------------------------------------------------------- vouchers

-- A voucher is a payment method, not a discount. It settles through
-- `ledger_entry` like a card does, which is why a voucher covering half a
-- booking, several vouchers on one booking, and a refund returning value to the
-- voucher before the card all work without anything further being built.
--
-- The three kinds share one table because they differ only in what they hold.
-- An entitlement keeps both a balance and the thing it was sold as, so that
-- honouring 'Afternoon Tea for Two' at a risen price stays a policy decision
-- taken at redemption rather than a different data structure.
--
-- The code is a bearer instrument. It is high-entropy and the redemption
-- endpoint is rate limited, because a system that allows ten thousand attempts
-- gives away teas.
CREATE TABLE voucher (
  id                TEXT PRIMARY KEY,
  venue_id          TEXT NOT NULL REFERENCES venue(id),
  code              TEXT NOT NULL,
  kind              TEXT NOT NULL
                    CHECK (kind IN ('monetary', 'entitlement', 'complimentary')),
  original_pence    INTEGER NOT NULL,
  balance_pence     INTEGER NOT NULL,
  presented_as      TEXT,                -- 'Afternoon Tea for Two'
  face_offering_id  TEXT REFERENCES offering(id),
  source            TEXT NOT NULL
                    CHECK (source IN ('sold', 'gift', 'charity', 'goodwill',
                                      'wix-import')),
  purchase_booking_id TEXT REFERENCES booking(id),  -- when we sold it
  buyer_guest_id    TEXT REFERENCES guest(id),
  recipient_name    TEXT,
  recipient_email   TEXT,
  deliver_at        TEXT,                -- a voucher can be sent on a date
  issued_at         TEXT NOT NULL,
  expires_at        TEXT,
  voided_at         TEXT,
  wix_ref           TEXT,
  UNIQUE (venue_id, code),
  CHECK (balance_pence >= 0 AND balance_pence <= original_pence)
);

CREATE INDEX voucher_by_balance ON voucher (venue_id, balance_pence)
  WHERE voided_at IS NULL;

-- --------------------------------------------------------------- the ledger

-- Every movement of value against a booking, in one place.
--
-- Payments, refunds and voucher redemptions are kinds rather than tables,
-- because the question worth answering fast is always "what is this booking
-- worth now" and that should be one SUM. A deposit, a part-payment, a voucher
-- covering half, a goodwill refund of one line and a chargeback are all rows.
--
-- `PAYMENT.paid | partial | unpaid | refunded` in `src/domain.js` is computed
-- from this against the live lines. It is never written down, because a status
-- somebody has to remember to keep in step is a status that drifts.
CREATE TABLE ledger_entry (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL REFERENCES booking(id),
  line_id        TEXT REFERENCES booking_line(id),   -- when it refunds one line
  kind           TEXT NOT NULL
                 CHECK (kind IN ('payment', 'refund', 'redemption',
                                 'adjustment', 'chargeback')),
  method         TEXT NOT NULL
                 CHECK (method IN ('card', 'voucher', 'cash', 'transfer', 'comp')),
  amount_pence   INTEGER NOT NULL,       -- positive in, negative out
  vat_rate_bp    INTEGER,                -- null where VAT does not apply
  voucher_id     TEXT REFERENCES voucher(id),
  provider       TEXT,                   -- 'stripe'
  provider_ref   TEXT,                   -- payment intent, refund, dispute
  taken_at       TEXT NOT NULL,          -- the VAT tax point, not the sitting
  taken_by       TEXT,                   -- the Access identity, for a manual one
  note           TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX ledger_by_booking ON ledger_entry (booking_id);
CREATE INDEX ledger_by_taken   ON ledger_entry (taken_at);
CREATE UNIQUE INDEX ledger_provider_once
  ON ledger_entry (provider, provider_ref, kind)
  WHERE provider_ref IS NOT NULL;

-- Every webhook and every retryable write passes through here first. Stripe
-- retries, cron overlaps and guests double-tap; without this a retried webhook
-- sends a second confirmation or releases a hold twice.
CREATE TABLE idempotency (
  key         TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  result      TEXT,
  created_at  TEXT NOT NULL
);

-- ----------------------------------------------------------------- outbox

-- Nothing is ever sent from inside the request that took the money. A row is
-- written and cron sends it, which is what buys scheduling, retries, and an
-- answer when a guest says they never got it.
--
-- A reminder exists from the moment the booking does, with `scheduled_for` set,
-- and is voided when the booking is cancelled — otherwise we remind somebody
-- about a tea they called off a fortnight ago.
CREATE TABLE notification (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL REFERENCES venue(id),
  booking_id      TEXT REFERENCES booking(id) ON DELETE CASCADE,
  voucher_id      TEXT REFERENCES voucher(id),
  template        TEXT NOT NULL,         -- 'confirmation', 'reminder', …
  channel         TEXT NOT NULL DEFAULT 'email'
                  CHECK (channel IN ('email', 'sms')),
  recipient       TEXT NOT NULL,
  transactional   INTEGER NOT NULL DEFAULT 1,   -- marketing rides a separate lane
  payload         TEXT,
  scheduled_for   TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'sent', 'failed', 'void')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  sent_at         TEXT,
  provider_ref    TEXT,
  last_error      TEXT,
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (idempotency_key)
);

CREATE INDEX notification_due ON notification (state, scheduled_for)
  WHERE state = 'pending';

-- --------------------------------------------------------------- waitlist

CREATE TABLE waitlist_entry (
  id            TEXT PRIMARY KEY,
  sitting_id    TEXT NOT NULL REFERENCES sitting(id),
  guest_id      TEXT NOT NULL REFERENCES guest(id),
  party_size    INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'waiting'
                CHECK (state IN ('waiting', 'offered', 'converted', 'expired')),
  offered_at    TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX waitlist_by_sitting ON waitlist_entry (sitting_id, state, created_at);

-- ------------------------------------------------------------------ audit

-- Append-only. Nothing in this database is deleted; everything is superseded.
-- This is the evidence in a chargeback and the answer when two people disagree
-- about what happened to a booking. Access already knows who everyone is.
CREATE TABLE audit_entry (
  id            TEXT PRIMARY KEY,
  venue_id      TEXT NOT NULL REFERENCES venue(id),
  subject_kind  TEXT NOT NULL,           -- 'booking', 'sitting', 'voucher'
  subject_id    TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor         TEXT NOT NULL,           -- an email, 'guest', or 'system'
  detail        TEXT,                    -- what changed, as JSON
  at            TEXT NOT NULL
);

CREATE INDEX audit_by_subject ON audit_entry (subject_kind, subject_id, at);
