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
| `/settle/PERIOD` | Who still owes money, for a day or a month |
| `/chase/PERIOD` | Who abandoned a booking and left a way to reach them |
| `/today` | Redirects to today — what the home-screen shortcut points at |
| `POST /booking/:id/:action` | Mark paid, seated, finished, no show, or cancel |
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

`npm test` needs no credentials. It covers the date logic, the adapter against a
stubbed transport, and the Access verification against a generated RSA keypair —
real signatures, and every way a request should be turned away.

`npm run test:mobile` drives a real browser at phone viewports: no horizontal
scroll, every tap target at least 44px, the install metadata, and the service
worker actually caching, serving offline, and — the one that matters — throwing
the cached diary away when Access stops recognising the session. It needs
`npm install`; set `CHROMIUM` to a browser binary to skip Playwright's download.

## On a phone

Samson is installed to a home screen and is expected to behave like an app.

**The cache holds guest data.** Cached pages carry names, phone numbers, email
addresses and dietary requirements, which is the price of the diary opening in a
kitchen with no signal. It is only worth paying because `public/sw.js` throws
that cache away the moment Access bounces a request to the login page. Anything
that changes caching in that file needs to keep that promise.

**An installed app updates itself.** `wrangler deploy` mints a new deployment
id, the Worker stamps it into `sw.js` as it serves it, and the changed bytes are
what make a browser install the new worker at all — a hand-bumped constant is
how a change ships to the server and never reaches a home screen. Caches are
named after that id, so a deploy retires the old ones. The page reloads on
`controllerchange`, and a phone left open on the diary all afternoon checks for
both a new version and newer bookings when it comes back into view.

**Pages are streamed in two pieces.** The title, the date and the arrows come
from the URL, so `stream()` in `src/worker.js` flushes them with a skeleton
before Wix has answered; the diary follows, behind a stylesheet that retires the
skeleton. Waiting for Wix before sending a byte left the previous screen frozen
with nothing to show for it. The consequence is that the status line is gone by
the time the body is built, so a failure after the flush is reported inside the
page rather than as a 502.

**Wix queries are POSTs, so `cf: { cacheTtl }` does nothing.** Cloudflare does
not cache POST responses, and the TTLs that used to sit on those calls were
inert — a page that needed the schedule still made five round trips, two of them
the identical experiences query. Configuration now goes through
`cachedQueryAll`, which stores the result against a synthetic GET key; a warm
page makes two calls instead of five. Reservations are never cached: they change
while somebody is looking at them.

**Navigations are network-first.** A diary that is quietly out of date is worse
than one that takes a moment. Cached pages only appear when the network fails,
and they say so in a banner rather than passing themselves off as current.

**The manifest link carries `crossorigin="use-credentials"`.** Manifests are
fetched without cookies by default; behind Access that fetch is answered with a
login page and the app silently refuses to install.

**Nothing in the calendar grid may set a width.** Seven columns on a 375px
screen means about 45px each. `grid-template-columns: repeat(7, minmax(0, 1fr))`
is what stops a wide cell pushing the page sideways — a plain `1fr` will not
shrink below its content and breaks the whole layout out of the viewport.

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
5. **Put them in `wrangler.jsonc` and deploy again.** Both are set already for
   the `plain-leaf-6898` team.

Then open `/whoami`: it returns the email Access believes you are, which
confirms the whole chain end to end.

Access authenticates at the edge; `src/access.js` verifies the assertion again
inside the Worker, because anyone reaching the origin directly would otherwise
bypass the edge entirely.

## The diary is bookings that happened

`groupIntoSittings` splits a sitting's rows in two. `sitting.bookings` is the
diary — only bookings that hold a seat. `sitting.unfinished` holds the ones
somebody gave up on, plus anything still in checkout, and the only page that
reads it is `/chase`.

This matters more than it sounds. An abandoned attempt sitting in the same list
as the guests who are actually coming reads as a real booking, and a sitting
whose rows were all abandoned used to appear on the diary with nobody in it.
Both are gone. Where a day has abandoned attempts it says so once, with a link,
rather than mixing them in.

Superseded and stale attempts are dropped everywhere; `/chase` says how many, so
it is honest about being a filtered view.

## Reading it

A few rules the views hold to, each of which was wrong once.

**A tile's number and its label must not say the same thing.** "2 / To settle on
arrival · 2 groups, 13 guests" states the two twice and wraps onto a second
line. The number is a count of groups, the label names that unit and adds the
head count: "2 / Groups to settle · 13 guests".

**A zero leads nowhere.** There is nobody behind it, so a tile at zero keeps its
place in the row but drops the chevron and the link colour that invite a tap
onto an empty page.

**Whether a heading carries a date is decided by the period, not the rows.**
A month list whose matches happen to fall on one day still needs to say which
day, and asking the rows how many days they span gets that exactly backwards.
The date is then written once, as a rule over that day's sittings — repeated per
sitting it reads as two separate days.

**The arrows belong to the title.** Pinned to the edges of the 60rem month grid
they sit a third of a window away from the thing they move. The cluster is
capped at 32rem once there is room to spare; on a phone it already fills the
width, so the targets stay where a thumb expects them.

**The h1 clips its own descenders.** The ellipsis needs `overflow: hidden`, and
that clips at the padding box, which at this line-height falls above the foot of
a "g". Padding gives the descender room and a negative margin puts the layout
back. `test/pwa.test.mjs` compares the ink box against the clip box on every
phone viewport, because computed style reports the clip as fine.

## Changing a booking

`src/actions.js` holds every write Samson can make. Three things about it:

**Wix sends the emails.** Updating a reservation can fire the site's own
automations, so a cancellation may tell the guest. Destructive actions say so
before they are confirmed, behind a second tap rather than a dialog a pocket can
dismiss.

**"Paid" is a flag, not money.** Wix sets `PAID` when the matching eCommerce
order settles. Marking it by hand records that cash changed hands in the room —
it takes no payment and reconciles against nothing. That is the right tool for a
phone booking settled on the day and the wrong one for anything else.

**The revision is read immediately before writing**, never taken from the page
the button was on. That page may be an hour old, and Wix rejects a stale
revision — rightly, since somebody else may have touched the booking since.

Actions only appear on bookings that hold a seat. An attempt still in checkout,
or one abandoned last week, shows its contact details and nothing else; offering
"mark paid" there invites recording a payment against a booking nobody made.

### Why the origin is checked

Access authenticates with a cookie, and a cookie rides along on a cross-site
form post exactly as it does on our own. The assertion alone would let any page
on the internet cancel a booking on a signed-in phone. `act()` in
`src/worker.js` refuses anything whose `Origin` isn't ours before it reads or
writes a thing, and `test/worker.test.mjs` drives that with a real assertion and
a real form post.

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
