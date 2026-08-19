# Samson

The Moore Lodge back office, at `samson.moorelodge.co.uk`.

Phase one reads the Wix data that is already there and writes nothing. The point
is to find out what the team actually needs from a dashboard while the bookings
are still Wix's problem — and to get everyone onto our tooling long before their
data moves. Deployed separately from the public site so that editing one can
never take the other down.

## What it does today

| Route | Shows |
|---|---|
| `/` | Redirects to the current month |
| `/calendar/YYYY-MM` | Month grid — sittings per day, covers against capacity |
| `/day/YYYY-MM-DD` | A day's sittings, with guests, contact details and dietary notes |
| `/whoami` | Who Cloudflare Access thinks you are. Handy while setting it up |

## The seam

`src/domain.js` defines Samson's own vocabulary — `Booking`, `Sitting`,
`Experience` — and the repository interface the rest of the app talks to.
`src/adapters/wix-bookings.js` is the only file that knows Wix exists.

That boundary is the whole point. A Wix response shape must never reach a
template. Hold that line and moving onto our own database later is a change of
adapter, made one entity at a time and reversible if something surprises us.
Let it slip and this becomes a Wix-shaped dashboard that has to be written twice.

```
views ──▶ domain types ──▶ BookingsRepository ──┬─▶ WixBookings    (today)
                                                └─▶ LodgeBookings  (later: D1 + Stripe)
```

## Running it

```
npm install -g wrangler   # if you haven't
cp .dev.vars.example .dev.vars   # then fill it in
npm run dev
npm test
```

`npm test` needs no credentials — it runs the date logic and the adapter against
a stubbed transport.

### Configuration

`WIX_API_KEY` is the only secret: `npx wrangler secret put WIX_API_KEY`.
Generate it at <https://manage.wix.com/account/api-keys> with the Reservations
permissions. Site-level calls pair it with `WIX_SITE_ID`, which lives in
`wrangler.jsonc` along with the two Access values — none of those three are
secret.

### Cloudflare Access

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` don't exist until the Access application
does, and the application needs the hostname to exist first — so the order is:

1. **Deploy the Worker.** `npm run deploy` creates the custom domain
   `samson.moorelodge.co.uk` and its DNS record. Until Access is in front of it
   the Worker is publicly reachable, but it fails closed: with no valid
   assertion every request gets the 403 page, so nothing leaks in the gap.
2. **Create the application.** Zero Trust → Access controls → Applications →
   Create new application → Self-hosted and private → Add public hostname, and
   choose `samson` on `moorelodge.co.uk`. Set a session duration — a week is
   reasonable for a phone kept in an apron pocket.
3. **Add a policy.** Applications are deny-by-default, so nobody gets in until
   an Allow policy matches. Use the Emails selector and list the staff
   addresses.
4. **Read off the two values.**
   - `ACCESS_AUD` — the application's own Overview, under **Additional
     settings**, as *Application Audience (AUD) tag*.
   - `ACCESS_TEAM_DOMAIN` — your team domain, `<team-name>.cloudflareaccess.com`.
     It's in Zero Trust → Settings, and it's also the host you get bounced to
     when Access challenges you for a login.
5. **Put them in `wrangler.jsonc` and deploy again.**

Then open `/whoami`: it returns the email Access believes you are, which
confirms the whole chain end to end.

Access authenticates at the edge; `src/access.js` verifies the assertion again
inside the Worker, because anyone reaching the origin directly would otherwise
bypass the edge entirely.

## Things learned from the live API

Worth knowing before extending the adapter — each of these cost a round trip.

**Ranges need `$and`.** `{"details.startDate": {"$gte": a, "$lt": b}}` is
rejected with "unsupported operator": the parser reads the whole object as the
operator name. Each bound has to be its own condition under `$and`.

**Sorting needs the full path.** `details.startDate` is sortable; `startDate`
fails as an unknown sort path.

**Offset paging silently lies.** `paging.offset` is accepted and ignored,
returning the first page over and over. Use `cursorPaging` — `queryAll` in
`src/wix.js` does.

**A sitting is not a record.** Wix has no sitting entity; a sitting is just the
bookings that share a start time, so `src/calendar.js` derives it.

**Custom field answers are keyed by uuid** and meaningless without the label,
which lives on the location *or* the experience form. Both are read to build the
map.

**Not every booking has a guest.** `HELD` reservations carry no `reservee` at
all, and custom fields are often present but empty.

## Time

The lodge thinks in Europe/London; the API answers in UTC. A 13:30 sitting in
August is stored as `12:30Z`, so deriving "today" from `toISOString()` would
show tomorrow's covers from 11pm on a summer evening, and a month grid built the
same way would drop a sitting at each end.

`src/time.js` goes through `Intl` instead, which knows when the clocks change.
The tests cover both changeover days — the 23-hour day in March and the 25-hour
day in October.

## What's next

Phase two adds writes, one at a time, each tested against a far-future date:
phone bookings, edits, cancellations, no-shows, then experiences, the schedule
builder and refunds.

Refunds are possible even though a reservation carries no order number — every
paid booking creates an eCommerce order whose `catalogReference.catalogItemId`
is the reservation id, so the payment behind a booking can be found and put back
through the proper channel.

The one thing the Wix API cannot do is originate a payment. That costs nothing
here: phone bookings are already recorded unpaid, exactly as the Wix app records
them.
