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
| `/calendar/YYYY-MM` | Month grid — sittings per day, covers against capacity, rooms let per night |
| `/day/YYYY-MM-DD` | A day's sittings, with guests, contact details and dietary notes — and which rooms are occupied, arriving or to be turned round |
| `/settle/PERIOD` | Who still owes money, for a day or a month |
| `/chase/PERIOD` | Who abandoned a booking and left a way to reach them |
| `/called-off/PERIOD` | Cancellations and no shows, each with a way back |
| `/today` | Redirects to today — what the home-screen shortcut points at |
| `/new/DATE` | The form for a booking taken over the phone |
| `POST /new` | Writes it |
| `POST /booking/:id/:action` | Mark paid, seated, finished, no show, cancel, or put back |
| `/whoami` | Who Cloudflare Access thinks you are. Handy while setting it up |

## The seam

`src/domain.js` defines Samson's own vocabulary — `Booking`, `Sitting`,
`Experience` for the dining room, `Room` and `RoomDay` for upstairs — and the
repository interfaces the rest of the app talks to. `src/adapters/` holds the
only two files that know where any of it came from.

That boundary is the whole point. A Wix response shape must never reach a
template. Hold that line and moving onto our own database later is a change of
adapter, made one entity at a time and reversible if something surprises us.
Let it slip and this becomes a Wix-shaped dashboard that has to be written twice.

The rooms are what that boundary was for. They arrived as a second source with
nothing in common with the first, and no view had to learn a thing about
freetobook to show them.

```
views ──▶ domain types ──┬─▶ BookingsRepository ──┬─▶ WixBookings      (today)
                         │                        └─▶ LodgeBookings    (later: D1 + Stripe)
                         └─▶ RoomsRepository ─────┬─▶ FreetobookRooms  (today: availability)
                                                  └─▶ FreetobookStays  (later: named guests)
```

## The rooms

The month grid carries a bed count per night and the day page lists what is
happening to each room — arriving, staying, departed this morning. It comes from
freetobook's public availability feed, the same one `moorelodge.co.uk` prices a
stay from, proxied in `src/freetobook.js` and mapped in
`src/adapters/freetobook-rooms.js`.

**It is occupancy, not bookings.** The feed says a room is taken. It does not
say by whom, for how long, or when they are expected. That is enough for
housekeeping to know a bed is being slept in, and it is the whole of what the
screen claims — the page says so itself, at the bottom of the room list, because
somebody planning a morning off it needs to know where it stops.

Three limits are worth knowing, and all three are the feed's, not the code's:

- **Back-to-back stays read as one.** One party out and another in on the same
  day looks identical to a two-night stay, so that changeover is not shown.
  Rooms that go empty are always right; rooms that turn round are not always
  visible.
- **A cancellation just reappears as free.** Nothing marks it as having gone.
- **It only answers for today onwards.** Ask for a night that has passed and
  freetobook does not say no — it answers `200` with a couple of unrelated
  dates, which is far worse than an error because it looks like an answer.
  `inRange` therefore clamps to today and reports only the nights it genuinely
  knows; a night it was not told about renders as nothing at all rather than as
  an empty house. A past month's grid carries no bed counts, and says `—`.

The clamp costs one thing: today has no night before it to compare against, so
this morning's changeovers cannot be seen and an arrival cannot be told from a
stay in progress. Today's occupied rooms therefore read "In use", and the page
says why. Every other date in the range has its predecessor and is exact.

**Exclusive use is spread back over the bedrooms.** freetobook sells the whole
house as a unit of its own and books it without touching the eight bedrooms, so
a house full of one wedding party would otherwise read as eight empty rooms —
the one misreading of this feed that could send nobody upstairs at all. A booked
exclusive-use night marks every bedroom let, and the day page says which it is.

**freetobook is never allowed to take the diary down.** The rooms are fetched
alongside Wix, not in front of it, and a failure is caught in `upstairs()` and
turned into a null the views know how to say out loud. Nothing about a
freetobook outage should cost anybody a booking.

Catching a failure is not the same as bounding a wait, so each call carries an
`AbortSignal.timeout` of 2.5 seconds. Cold calls measure around a second; the
deadline is there for the one that never comes back, which would otherwise hold
the streamed page open behind its skeleton with the diary already answered and
waiting on it.

Named guests need freetobook's private per-booking feed, which is a paid option
on their account and a different adapter behind the same `RoomsRepository`
interface. Nothing in the views would change.

### freetobook credentials

Widget ID `50366`, property `55682`. The widget token in `src/freetobook.js` is
not a secret — it appears in every "Book Now" link on the public site and in
freetobook's own client bundle. `FREETOBOOK_WIDGET_TOKEN` overrides it, so a
rotated token is a config change rather than a deploy.

## Running it

```
npm install -g wrangler   # if you haven't
cp .dev.vars.example .dev.vars   # then fill it in
npm run dev
npm test
```

`npm test` needs no credentials. It covers the date logic, both adapters against
stubbed transports, and the Access verification against a generated RSA keypair
— real signatures, and every way a request should be turned away. The rooms
tests pin "today" so the clamp on past nights is exercised rather than dodged.

`node tools/card.mjs` redraws the link preview card. It needs the same browser
`test:mobile` does.

`npm run test:mobile` drives a real browser at phone and tablet viewports: no
horizontal scroll, every tap target at least 44px, the install metadata, and the
service worker actually caching, serving offline, and — the one that matters —
throwing the cached diary away when Access stops recognising the session,
whether that arrives as a page reload or as a tap the page handled itself.
`test/touch.test.mjs` holds the stubbed Wix open on purpose, so everything it
asserts about a tap is measured in the window where a real Samson would still be
waiting. It needs `npm install`; set `CHROMIUM` to a browser binary to skip
Playwright's download.

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

The skeleton's pieces are direct children of `main`, not one wrapper. On a
landscape tablet `main` *is* the grid, and only a direct child can be placed in
it — a wrapper put the whole skeleton in the first column and the page jumped
from one column to two the moment Wix answered. That is also why the stylesheet
that retires it uses `!important`: `main.split > .planner` outweighs a bare
class, and a retired skeleton standing beside the real thing is worse.

**A tap is answered before the network is.** Two things were wrong on a tablet
and they compounded. The tap highlight is off across the whole app, and the
`:active` rules that were meant to replace it are withheld by iOS until it has
ruled out a scroll — so a control did nothing at all for the first fraction of a
second. And a navigation then held the page somebody had just left on screen for
the whole round trip to Cloudflare and on to Wix. Nothing moved, twice over.

So the press is a class set on `pointerdown` rather than a pseudo-class, and
every control dips under the finger and springs back: quick going in, slower and
slightly past itself coming out. It is held for a minimum of 90ms so the
quickest tap still shows it, and let go of the instant a `pointercancel` or a
scroll says the touch was the start of a drag. The `:active` rules stay, for a
mouse and for the moment before the script runs.

**And the view switches on the tap.** A tap on a link is handled in the page:
the shape of the destination goes up immediately out of what the URL alone says,
and the server's two flushes land into it as they arrive — the real title ahead
of the diary, exactly as on a fresh load. The request itself starts on
`pointerdown`, a beat before the finger lifts. Three things make this safe
rather than a small framework:

- The client knows only what shape a path is — a month grid or a day — and
  nothing else about the page. Every byte on screen was rendered by the server.
- The fetch carries `x-samson-nav`, which is how `sw.js` knows to treat it as
  the navigation it is. Without that the diary would stop being cached for
  offline the moment the page stopped reloading itself, and — far worse — an
  expired Access session would stop purging it.
- It asks for `redirect: "manual"`, so an Access bounce comes back as an opaque
  redirect and is handed straight to the browser. Following it in the page would
  fail CORS at best. `test/access-cache.test.mjs` covers the tap as well as the
  reload, because that is the promise about guest data.

A build stamp that has moved, an answer that is not HTML, and the redirects at
`/` and `/today` all fall back to letting the browser do it.

**The rooms come from the month, whichever page asked.** A day page fetches the
whole month from freetobook even though it shows one night of it, because the
month view asks the identical question — so both answer off one copy in the edge
cache, and a day reached from its month costs nothing. It is two calls either
way: the unit list, cached an hour, and the nights, cached five minutes.

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

**The day sits beside its month on a landscape tablet and up.** `main` itself
is the grid, which is what lets the title and its arrows move into the left
column with the calendar they drive while still going out with the first flush —
they are already inside `main`, so nothing had to move into the body to get
there. Below 62rem the planner is not rendered at all: a 40px cell is a poor tap
target, and the month view is one tap away regardless.

Two things about that grid are load-bearing, and both were wrong first. The rows
are `auto auto 1fr`, because the detail column spans all three and a spanning
item distributes its height across every *auto* track it covers — with three
autos it pushed the title and the nav a third of the day's length apart. And the
planner needs `align-self: start`: a grid item stretches to its area, so its own
box became the full height of the row, which is taller than a landscape tablet
and therefore the one shape a sticky element cannot keep wholly on screen.

**The day query asks for the month.** It costs the same single round trip —
`queryAll` pages at 100 and a month does not come close — so one query fills
both columns rather than the phone paying for a second one it will not show.

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

### Signing in with Google

The identity provider is not the access mechanism. Access is the authorisation
layer; how somebody proves who they are is pluggable underneath it, and out of
the box that is a one-time code emailed to them. Swapping in Google is a Zero
Trust change and touches no code here: `src/access.js` verifies a signature
against the team's JWKS and checks `iss` and `aud`, and Access mints the same
assertion from the same issuer whichever provider fed it.

1. **Add the provider.** Zero Trust → Settings → Authentication → Login methods.
   Google needs an OAuth client from Google Cloud — a client id, a secret, and
   `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` as the
   authorised redirect URI. Google Workspace additionally wants an admin address
   and the domain, and gives group membership back in return.
2. **Scope the policy.** The Allow policy's *Emails* selector becomes *Emails
   ending in* `@langholmgroup.com` — or, with Workspace, a group.
3. **Restrict how they get in, if that is the point.** Leaving one-time PIN
   enabled means an address at the domain can still sign in with an emailed code
   without ever touching Google. That is the same thing as mailbox access, so it
   is only worth turning off if Google is carrying something the mailbox is not,
   like enforced 2FA. The application's own authentication settings are where
   the provider list is narrowed.

**A domain rule is wider than the list it replaces.** The policy today names
individual people. Everyone at Langholm Group is a larger set than everyone who
should read a guest's phone number, allergies and dietary notes, and the rule
does not know the difference. A Workspace group is the version of this that
stays as tight as the list — and a policy can carry more than one rule, so an
address that is not on the domain does not have to be shut out to get there.

It does nothing for the link preview. Access still challenges at the edge, and
an unfurler still arrives without a cookie whichever provider is behind it.

### Making the sign-in look like Samson

A stark Cloudflare page in front of a carefully made app reads as the wrong
place, or as something worth being suspicious of. Two settings fix most of it.

**Brand the page.** Zero Trust → Settings → Custom Pages carries a logo, a
background and header text for the login screen. The values are Samson's own:
cream `#F7F4EC` for the ground and burgundy `#521033` for the type, with the
stacked lockup in burgundy.

**The logo cannot live here.** A logo served from `samson.moorelodge.co.uk` is a
logo behind the Access application somebody is in the middle of signing in to,
so the login page asks for it, gets challenged, and shows nothing. It has to be
somewhere public — `moorelodge.co.uk` is the obvious home.

**One provider means one tap.** Access shows a "how would you like to sign in"
chooser only when more than one login method is enabled. With Google as the only
method it redirects straight through, so the whole journey is: tap Samson, pass
through a branded page, land on Google's account picker, arrive. Signed in to
Google already and it is closer to no taps at all. Turning off one-time PIN is
what buys this, which is a second reason to do it beyond the one above.

**The account picker is Google's.** Nothing on any plan changes that — AuthKit
would bounce to the same screen. Branding stops at the edges of it.

**Session length is the real lever.** The screen nobody sees is the best-looking
one. The application's session duration decides how often staff meet any of
this; a phone in an apron pocket signing in once a month is a different product
from one signing in every morning.

**On an installed phone, expiry is not free.** Signing in means leaving our
origin, and a standalone home-screen app sent cross-origin can hand the journey
to a browser sheet rather than keeping it in the app. It resolves, but it does
not feel like the app did a moment earlier — another argument for a long
session, and worth watching on a real handset after any change here.

Access authenticates at the edge; `src/access.js` verifies the assertion again
inside the Worker, because anyone reaching the origin directly would otherwise
bypass the edge entirely.

`isPublicAsset()` in the Worker is that second check being skipped, not a hole
in the first. Fonts, icons and the manifest carry no guest data, so the Worker
does not re-verify them — but the Access application in front still challenges
them, which is exactly why the manifest link needs `use-credentials`. Nothing in
`public/` is reachable without a session unless a Bypass policy says so.

### The link preview

`public/icons/card.png` is the mark with "Samson" underneath, generated by
`node tools/card.mjs` from the real woff2 so the card's wordmark is the same
Romie Light as the header's. `test/pwa.test.mjs` reads the IHDR of the served
file, because a card at the wrong size is dropped or letterboxed without
complaint.

**The card is fixed, and per-page cards would be a mistake.** An unfurl is
cached at the moment somebody shares it, so "6 August · 20 guests" would be
frozen at whatever the diary said then and go on asserting it — and it would put
covers in front of anyone holding the link. Every page sends the same tags.

**It will not appear until Access is told to let an unfurler through.** Access
challenges at the edge, so a preview fetch — which carries no cookie and never
will — is answered with the login page rather than ours. Nothing in the Worker
can change that. Sharing a deep link and getting a preview are mutually
exclusive here, and that is the right trade: a Bypass policy broad enough to
unfurl `/day/2026-08-06` is a Bypass policy that makes the diary public.

What can be had without giving anything away is a preview on the bare hostname:
a Bypass policy on one path that holds nothing but the mark and a way in. That
is a Zero Trust change plus a route, and it is not built — the tags and the
image are, so the day the path exists it is already wired.

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

There is a third bucket. `sitting.calledOff` holds the bookings a *person* took
off the diary — cancelled, declined, marked a no show — and it exists because
those are the only dead bookings that can be put back. They never pass through
`sitting.bookings`, not even briefly: `classify` reads anything in there holding
no seat as an unfinished attempt, so a cancellation from last week would come
back out of it labelled "abandoned — chase". Archived ones are dropped, because
archiving is Wix's way of saying somebody has already dealt with it.

A sitting that exists only because everything at it was called off is not
counted as a sitting. It was never one anybody ran, and counting it would put
its seats in the denominator and quietly drop the month's occupancy.

## Reading it

A few rules the views hold to, each of which was wrong once.

**A tile's number and its label must not say the same thing.** "2 / To settle on
arrival · 2 groups, 13 guests" states the two twice and wraps onto a second
line. The number is a count of groups, the label names that unit and adds the
head count: "2 / Groups to settle · 13 guests".

**One disclosure, one label.** Every booking's contacts, reference and actions
sit behind a single `<summary>`, which said "Contact details" or "Reference"
depending on whether there was a phone number to show. Both undersell what is
behind it now that the actions are there too, and the branch existed only to
avoid lying about the contacts. It says "Details".

A closed `<summary>` is a button, and that one is the most-tapped control in the
app — it gates every write. The tap-target check queried `a[href], button` and
so never measured it; it had been 40px the whole time.

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

**Every one-way door has a way back.** "No show" and "Cancel booking" take a
booking off the diary and out of every count, and until recently that was the
end of it: the status left `LIVE`, so `availableFor` returned nothing *and* the
booking vanished from the diary and `/chase` alike. A mis-tap did not just lose
the booking, it lost any way to find it again short of the Wix dashboard — and
on a phone that tap is easy to make. `/called-off` is where those bookings live
now, and `restore` writes the status back to `RESERVED`.

`restore` is the only action with no second tap. Friction on a recovery path is
friction in exactly the wrong place, and a booking put back by accident can
simply be cancelled again.

**Which side of the diary an action works on is declared, not inferred.** Each
action carries `calledOff: true` or nothing, and `availableFor` matches that
against the booking before any `when` runs. Left to their own predicates, "mark
paid" would match a cancelled booking — it is unpaid by any reading — and invite
recording money against somebody who is not coming. That is the same mistake as
offering actions on an abandoned attempt, which is why an attempt still in
checkout, or one abandoned last week, still gets none: it shows its contact
details and nothing else.

### Notes are the team's, not the guest's

`teamMessage` is editable from the day. The guest's own answers above it are
not, and that is the point of the distinction: those are what somebody said
about their own allergies, and a back office that can quietly rewrite them is
one that can put words in a guest's mouth about the thing on this page most
likely to hurt somebody. A change phoned in later goes in the team note, beside
what they originally said rather than over it.

It is the only action whose change comes from the page rather than from
`actions.js`, so it is the only one with a `from(form)`. Trimmed, capped at
`NOTE_LIMIT`, and allowed on a cancellation too — why something was called off
is exactly what somebody wants a week later.

### The page decides what to offer; the route decides what to do

`availableFor` dresses a page. `permits` is what the route asks before it
writes, and they are different questions: a form post need not have come from a
page we rendered, so "the button was not there" is not a control. Without that
check a hand-made post could mark a cancelled booking paid — every `when` and
`calledOff` rule lived in the view layer only.

The check is free. `apply` already reads the booking to get the revision it must
write against, so the read that proves the write is safe is the read that was
already happening.

## Taking a booking over the phone

`src/draft.js` reads the form. It is its own file because it is the part with
rules, and rules want testing without a browser or a network — what comes out is
a `BookingDraft` and what it knows about Wix is nothing.

**The sittings come from the schedule, not the diary.** They used to be "times
that already have bookings that day", which made a quiet Tuesday look identical
to a Tuesday the lodge is shut, gave the first caller of the week nothing to
choose from, and hid any experience nobody had booked yet. `scheduledSlots`
reads `Get Scheduled Time Slots` instead: slots come from the experience's own
`businessSchedule`, which overrides the location's, and that endpoint never
returns a slot outside opening hours — so a date with no slots is a date nothing
runs, and one call over the chip week answers both "which days" and "which
sittings" at once.

`partySize` is asked for by that API and is deliberately given as 1. It is a
probe for what is running, not a filter: a sitting that will not fit the party
is still worth showing, because somebody on the phone may decide to squeeze
them in.

**Capacity informs; it never blocks.** A full sitting says Full and stays
selectable. A day the experience does not run is dashed and says so, and remains
a link. Staff can seat eleven at a table for ten, and the form's job is to tell
them what they are deciding rather than to decide it — which is also why nothing
on that page is ever `disabled`.

**The experience chips only appear when there are two.** Choosing from a list of
one is a decision nobody should be asked to make, so with a single experience it
is simply what a booking is for.

**Three taps before any typing.** When, which sitting, how many — chips, not
pickers. A native date or time control on a phone is a modal wheel somebody has
to aim at one-handed, and the form used to open two of them before it asked
anything about the guest. What is left to type is a name and a number, which is
what a caller actually dictates. Everything down to the phone number fits one
screen, which is what makes it possible to read the booking back before hanging
up; `test/pwa.test.mjs` measures that rather than trusting it.

**The sitting chips carry seats remaining**, because mid-call the useful
sentence is "12:30 is full, I can do you 13:30" — a form that only records the
answer cannot help somebody find it.

**A chip reveals its own escape hatch.** Choosing "Another time" is what shows
the time field, via `:has()`. A `<details>` there cost a whole 48px row to say
what the chip beside it already said.

**One name field.** "Ann Blair" is one thing somebody says, so it is one thing
they type; `splitName` breaks at the first space. That makes "Mary Jane Watson"
a Ms Jane Watson, which is wrong about her middle name, right about how she is
greeted, and much better than asking somebody to choose a box mid-call.

**The date picker is its own form, outside the booking form.** A form inside a
form is invalid, and the parser resolves it by closing the outer one early —
which quietly puts most of the booking outside the form that submits it. That
shipped for exactly one commit and is now a test.

**A first name and a phone number are not optional.** Wix rejects any source but
`WALK_IN` without them, so the form says so in its own words rather than letting
the API say it in Wix's.

**`source: OFFLINE`** is Wix's own term: "made by a restaurant employee, for
example when a customer calls." **No `status` is sent** — unset, Wix picks
`RESERVED` or `REQUESTED` from the location's approval setting, and asserting
one over that setting would quietly bypass it.

**Half twelve is 11:30Z in August and 12:30Z in January.** `localToInstant`
measures the offset rather than assuming one: read the candidate back in local
time and shift it by however far off it reads, twice, because the shift can
itself cross a changeover. The loop stops when the *reading matches*, not when
some offset is zero — that version walks an hour further away on every pass, and
it was the first one written.

**A rejected form is re-rendered, not redirected.** The one place this app does
not use post-redirect-get, because the alternative is putting somebody's typing
in a query string, and retyping a booking mid-phone-call is how the call goes
badly. Nothing was written, so a refresh repeats nothing. Wix's own refusals —
a pacing conflict, a full sitting — go on the form in its words, since they are
worth reading.

**A booking is not idempotent, and Wix is not instant.** The second tap somebody
makes while wondering whether the first one landed would book the same party
twice, and nobody would notice until someone read the diary. Two guards: the
submit button disables itself and says what it is doing, and — because that only
covers the tap, not a back button or two people taking the same call — `create`
first asks whether a booking with the same phone number, at the same minute,
already exists, and says so instead of writing a second one.

**None of this has run against the live API.** The key was revoked, so the
create path is proved against a stub that pins the request body and nothing
more. Wix may email a guest the moment it succeeds. Take one booking on a
far-future date and look at it in the Wix dashboard before anybody uses it in
front of a caller.

### Why the origin is checked

Access authenticates with a cookie, and a cookie rides along on a cross-site
form post exactly as it does on our own. The assertion alone would let any page
on the internet cancel a booking on a signed-in phone. `act()` in
`src/worker.js` refuses anything whose `Origin` isn't ours before it reads or
writes a thing, and `test/worker.test.mjs` drives that with a real assertion and
a real form post.

## Things learned from the live API

Worth knowing before extending either adapter — each of these cost a round trip.

### Wix

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

### freetobook

**A past `from_date` is answered, not refused.** Ask for a range starting before
today and the call returns `200` with two or three dates that bear no relation
to what was asked for — the same two, whatever range you send. There is nothing
downstream that could tell that from a real answer, which is why the clamp lives
in `inRange` and not in a view.

**A month at a time is fine.** `from_date`/`to_date` spanning forty nights comes
back in one response of about 80KB, so there is no paging to do and no reason to
fetch a day at a time.

**Occupancy hangs off `pseudoUnitAvailabilities`, not the unit.** `allocation`
and `isClosedOut` describe what is for sale; `isBooked` on the pseudo-unit is
what says somebody is in it. Every unit here has an allocation of one, so it
reads as a boolean — but it is counted rather than tested, because a unit sold
as several identical rooms would otherwise report one bed made when four were
slept in.

**Its WAF wants a browser-shaped User-Agent** and Workers send none by default,
so an unadorned `fetch` gets a 403. The same lesson as the public site's
`worker.js`, and the same `Mozilla/5.0 (compatible; MooreLodge/1.0; …)` answer.

**`cf: { cacheEverything }` fails where the Cache API works.** With it set the
origin request is made by Cloudflare's caching layer rather than by the Worker,
and the WAF answers 403 — in production only. `src/freetobook.js` makes the
request itself and caches the response afterwards.

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
