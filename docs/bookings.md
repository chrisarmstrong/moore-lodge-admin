# Taking the bookings off Wix

Phase two, written before any of it is built. The point of writing it first is to
find the edges while they are still cheap — a schema decision costs an afternoon
now and a migration later.

Companion to this document, laid out for reading:
<https://claude.ai/code/artifact/27c74f89-19c4-469c-bcc9-59f70a5d6876>

## Decisions taken

Four of the eight open questions are settled, and each one takes something out
of the build.

**VAT registered, and we swallow it.** Every price stored is gross — what the
guest pays — with the rate carried beside it so an old booking is never
recomputed at a new one. Net and VAT are derived. Three consequences are not
obvious and all three are in the schema:

- **The tax point is the payment, not the sitting.** VAT on an August payment
  for a December tea falls in the August return, while the revenue is deferred
  until the tea is served. The two reports disagree on purpose:
  `ledger_entry.taken_at` answers the VAT question and the sitting's date
  answers the revenue one, off the same table.
- **The confirmation email is a VAT receipt.** It needs the VAT number and
  either the VAT amount or the rate; below £250 a simplified invoice is enough.
  `venue.vat_number` exists for this.
- **Vouchers get harder rather than easier.** If everything we sell is standard
  rated, our vouchers are probably *single-purpose*, which means VAT falls due
  when the voucher is sold rather than when it is redeemed — and the VAT on one
  that is never redeemed is not recovered. That is a different cashflow shape
  from the one most people assume. Worth ruling on before the first sale.

**Cancellation is flexible.** So there is no policy engine: one permissive
policy row, versioned and snapshotted onto the booking so that tightening the
terms later cannot reach back. Nothing in the system forfeits money on its own.
Flexible means staff discretion with an audit row, not an absent policy —
`policy.free_before_mins` is nullable and stays that way until it isn't.

That combination — full prepayment with flexible cancellation — is real
exposure, and the answer to it is architectural rather than contractual. Two
things get more valuable: **the waitlist**, because a late cancellation is
resellable within hours if somebody is waiting, and **amendments**, because
"we can move you" keeps both the money and the cover where a refund loses both.
Offer the move before the refund. It is the reason amendments have come up the
list.

**Entitlement vouchers honour the experience.** 'Afternoon Tea for Two' buys two
teas whenever it is redeemed, and we absorb a price rise. `voucher` keeps both
the balance and the offering it was sold against, so the generous reading is a
policy applied at redemption rather than something baked in — and the money is
still there to report as a liability.

**Full prepayment now, deposits later.** The ledger already supports a deposit;
nothing is being built for one. When private events want it, it is a second
`payment` row against the same booking and a balance to chase, not a change of
shape.

**Two horizons, not one.** Teas are set about a month ahead, but Christmas and
one-off events want to be sellable much further out. So the generator runs a
rolling window for the recurring schedule and leaves dated one-offs alone — and
the schema already allows it, because `sitting.rule_id` is nullable. A Christmas
sitting in September is a row with no rule behind it, priced and capped on its
own, and the rolling generator will not touch it.

Worth saying plainly, though it is a trading decision rather than an
architectural one: a month is short. People book Christmas in September and
anniversaries further out than that, and every one of those is a booking the
current window turns away. The system will not care which you choose.

**One kitchen.** So a sitting's capacity is complete on the sitting itself and
there is no pool table to build — one fewer table at cutover. The constraint is
the pass rather than the room, and if tea ever runs in two rooms at once a pool
joins to `sitting` without anything above it moving.

**Covers, not tables.** `sitting.seats` is a count and a line takes some of it.
One thing to be deliberate about: covers-only makes capacity theoretical rather
than realisable, because selling the last two of twenty-four to a pair can
strand seats at a four-top. So set `seats` to what the room genuinely seats
across a normal mix of parties, not to the fire limit, and let
`overbook_allowance` carry the squeeze. `offering.party_max` still matters
separately — fourteen covers free is not the same as a party of fourteen being
seatable. Tables remain addable later as an assignment from a line, changing
nothing above them.

## The seam already exists

`src/domain.js` defines `BookingsRepository` in Samson's own vocabulary, with
`WixBookings` behind it and the README already naming what goes in the same
slot. Every view speaks `Booking`, `Sitting`, `Experience`. No template knows
what `details.partySize` is.

That buys three things, and all three change what this plan has to be.

**The back office is already written.** The month grid, the day sheet, settle,
chase, called-off, the phone form, the actions — all of it is fed by an
interface. A second adapter lights them up unchanged.

**Two adapters can run at once.** Not as a sync — as a read. Samson can show the
new store's bookings and Wix's old ones on one diary, which is what makes a
clean cutover possible without losing the history.

**The vocabulary is most of the schema.** `STATUS`, `PAYMENT`, `DISPOSITION`,
and the abandoned/superseded/stale distinction were learned off real Wix data.
They carry over.

What is genuinely new is everything Wix was doing that Samson never had to
model: selling. A public checkout, a payment that is money rather than a flag, a
voucher that is a liability, and a mailbox that has to be right.

**The rule that keeps this cheap:** the new adapter satisfies
`BookingsRepository` before it grows a method of its own. The moment a view
imports something D1-shaped the seam is gone, and phase one was built the way it
was for nothing.

## The model

Three levels of catalogue, not Wix's two.

- **`experience`** — the marketed idea. Afternoon Tea.
- **`offering`** — a priced variant. Classic £45, Champagne £58, Little Lodgers £22.
- **`sitting`** — a dated instance: this offering, in this space, at 13:00 on 4
  October, with this many seats.

**And a booking is a list of lines, not a party size.** This is the decision the
whole architecture turns on. Wix records "a reservation for 4 against one
experience". Model it that way and a party of four wanting two Classic, one
Champagne and one child's tea cannot be sold. Model a booking as lines — each a
quantity of an offering at a captured price — and mixed parties, upsells,
packages, part-refunds and per-guest allergens all fall out of one structure
instead of each needing its own.

```
experience ──▶ offering ──▶ sitting ◀── space
                                ▲
booking ──▶ booking line ───────┘   holds a seat in
              │
              └─▶ offering            priced as

ledger: payment · redemption · refund   ──▶ booking
voucher ──▶ redemption                      draws down
```

### Sittings are rows, not a rule evaluated at read time

The shortcut is to store "runs Fri–Sun at 12:00, 14:30, 17:00" and compute the
calendar. Don't. The moment you cancel one Saturday, raise December's price,
close the Orangery for a wedding or add a fourth sitting for Mother's Day, a
computed calendar has nowhere to put the exception — and you end up with a rules
table, an overrides table, and logic reconciling them.

Keep `schedule_rule` as a *generator*. A job materialises sittings a rolling
twelve months ahead. Once a sitting is a row it can be priced, capped,
cancelled, renamed and booked against. Regeneration only fills gaps forward and
never touches a sitting with a booking on it.

### Capacity that isn't in the room

A sitting draws seats from a `space`. Two reasons that is a table rather than a
number on the sitting:

- **The kitchen is the constraint, not the room.** There is one, so today a
  sitting's seat count is the whole answer and no pool is built. Tea in the
  Orangery and tea in the Dining Room at 13:00 would be two seat counts and one
  pass — a pool row both sittings draw on, joined to `sitting`, added without
  disturbing anything above it.
- **Exclusive use eats the building.** freetobook sells the house as a unit and
  Samson already spreads that back over the bedrooms. The same night has to
  close the dining sittings, or we sell an afternoon tea into a wedding.

## Availability, and two people after one last table

The only genuinely hard technical problem here, and worth getting right on day
one because the failure mode is a guest arriving to no seat.

The reflex on Cloudflare is a Durable Object per sitting. We don't need it, and
taking it costs a second source of truth that can disagree with the database
about how many seats are sold — worse than the problem it solves.

**D1 is SQLite, and a single UPDATE is atomic.** That is the whole mechanism:

```sql
UPDATE sitting SET taken = taken + :n
 WHERE id = :sitting
   AND taken + :n <= capacity + overbook_allowance;
```

`changes() == 0` means it didn't fit. No lock, no actor, no race. Where a
kitchen pool applies the same conditional update runs against the pool row in
the same D1 batch, and either both land or neither does.

**A hold takes the seat immediately** — ten-minute expiry, swept on cron. This
is what Wix does, which is why `HOLD_MINUTES` and the whole `DISPOSITION`
vocabulary already exist here. `/chase` keeps working unchanged.

**Staff must be able to break the rule.** A rigid capacity is the most common
way a booking system gets resented: somebody phones, it's a regular, there is a
chair. `overbook_allowance` is the feature, not a hack — the public flow always
passes zero, the phone form can pass more behind a visible warning and an audit
entry. Wix cannot do this, and the team will prefer our version for it.

## Money is a ledger, not a status column

Today `PAYMENT` is a flag, and the README is honest that marking a phone booking
paid "takes no payment and reconciles against nothing". Once we are the
merchant that stops being acceptable, and the temptation is to make the flag
more elaborate. Don't.

**Store the events; derive the state.** Payments, voucher redemptions and
refunds are rows against a booking — amount in pence, timestamp, method,
provider reference. `paid`/`partial`/`unpaid`/`refunded` become a function of
that ledger. Deposits, part-payments, a voucher covering half, a goodwill refund
of one line and a chargeback are all entries; none need a schema change.

### Stripe, at the level actually needed

- **Hosted Checkout for v1.** 3-D Secure, Apple Pay, Google Pay, receipts, and
  no PCI scope beyond SAQ-A. Elements is a fair phase-three swap and is not
  worth blocking the cutover on.
- **The webhook is the truth, not the redirect.** A guest closing the tab after
  paying must still get a confirmed booking. `checkout.session.completed` writes
  the payment row; the success page is a courtesy.
- **Every Stripe event id is stored unique.** Stripe retries. Without it a
  retried webhook sends a second confirmation or releases a hold twice.
- **Phone bookings never touch a card in Samson.** Generate a payment link and
  text it. Staff typing card numbers into a back office drags us out of SAQ-A
  into a regime we cannot honestly claim to meet.
- **Full prepayment for tea.** Deposits are real for private events and a
  distraction at £45. Build the ledger so deposits are possible; don't build
  them yet.

**Money taken for a future date is a liability.** Every August payment for a
December sitting is deferred income until the tea is served, and so is every
unredeemed voucher. Both are trivial off a ledger and nearly impossible to
reconstruct from a flag. The accountant will ask.

### Refunds

Partial refunds against a payment intent are straightforward. Three rules are
not obvious and all three bite.

- **Refund to source, in order.** A booking part-paid by voucher and part by
  card returns value to the voucher first. Otherwise we have converted a voucher
  into cash.
- **The house cancelling is a bulk action.** A boiler failure on a Saturday is
  thirty refunds and thirty guests told, in one operation with one audit entry.
- **A refund after a chargeback is a double refund.** Store the dispute, block
  the manual path, and make Samson say why.

## Vouchers — later than they look, and still the last gate

Vouchers read like a nice-to-have. They are the opposite: they decide *when* Wix
can be switched off. Every voucher Wix has sold is an outstanding promise, and
we cannot turn off the system holding those balances until ours honours them.

What the per-path redirect buys is the right to do them second rather than not
at all. Tea can come home while `/gift-card` still points at Wix, so vouchers
stop blocking the first switch — but nothing closes the Wix account until they
are done.

**A voucher is a payment method, not a discount.** As a payment method it drops
into the ledger — a £50 redemption against a £90 booking, card takes £40, the
balance falls by £50, and the refund path already knows what to do. Partial
redemption, several vouchers on one booking, and a voucher paying for an upsell
all work without further thought. Model it as a discount and it gets rewritten.

Three kinds, one table:

| Kind | Sold as | Holds | Problem it creates |
|---|---|---|---|
| Monetary | "£100 gift voucher" | A balance | Expiry and liability only |
| Entitlement | "Afternoon Tea for Two" | A balance *and* what it was sold as | Prices rise. Two teas, or the £90 paid? |
| Complimentary | Charity raffle, apology, staff | A balance with no money behind it | Never revenue, still reportable |

Store all three as a balance plus a `presented_as` label and an optional
`face_offering`. Honouring an entitlement at today's price is then a policy
decision at redemption rather than a different data structure. My
recommendation is to honour the entitlement and eat the difference — explaining
a price rise to somebody holding a gift is not a conversation worth having — but
store enough to change our minds.

**Codes get guessed.** A voucher code is a bearer instrument. High-entropy
codes, rate limiting on redemption, and a lockout. A system that allows ten
thousand attempts gives away teas.

**Two things to get ruled on before the first sale.** UK VAT splits
single-purpose vouchers (VAT at sale) from multi-purpose (VAT at redemption),
and which ours are depends on whether they can only ever buy one rate of thing —
that changes what the ledger must record and is painful to backfill. And a
dated service is generally outside the fourteen-day distance-selling
cancellation right; an undated voucher is not obviously so. Both are twenty
minutes of proper advice rather than a guess in a schema.

## Add-ons and packages are both just lines

An add-on is a line whose product is a bottle of fizz, a cake, flowers, a
photographer. Three attributes cover nearly everything:

- **Per guest or per booking.** Champagne is per guest; a cake is per booking.
- **Lead time.** A cake needs forty-eight hours, so it drops out of the checkout
  inside its window and stays in Samson so staff can still promise it.
- **Its own stock, sometimes.** Six vases is the kitchen pool pointed at a
  different thing.

**A package is a line generator, not a bookable thing.** "Tea for Two with Fizz"
expands at checkout into two Classic lines, two champagne lines and a bundle
adjustment. Make it first-class and it needs a parallel availability engine that
knows a package occupies two seats — the corner most systems paint themselves
into. As a generator it inherits every rule the lines already obey.

**Tea plus a bedroom is not one basket.** Rooms are freetobook's, with their own
inventory, payments and terms. Selling both in one transaction means becoming
their reseller or holding a bedroom we cannot guarantee. Sell the tea, hand off
— the public site already proxies freetobook and can carry a promo code. Written
down here so nobody quietly attempts it later.

## Amendments

Not on the original list, and the majority of what actually happens: *can we
move to the Sunday, can we make it six instead of four, can we swap one to the
children's tea.*

As cancel-and-rebook each of those is a refund, a fresh payment, a sitting lost
to somebody else in between, two confirmation emails, and a guest who thinks
they have been charged twice. As a diff against the lines:

- **Party grows** — add lines, take the difference, keep the reference.
- **Party shrinks** — void lines, apply policy: refund, credit, or nothing
  inside the window.
- **Date moves** — release the old sitting's seats and take the new one's
  atomically. A price difference is a balancing line.

The reference never changes, the ledger records what moved, the audit log says
who did it. Build the staff-side version for cutover; let guests do it later.

**Resist a rules engine for policy.** Terms are flexible today, so v1 is a
single permissive policy row — refund freely, at staff discretion, with a reason
and an audit entry — **snapshotted onto the booking when it is made**. Never
resolve an old booking against today's terms: in a dispute in March what we need
is what they agreed to in November, which is also what makes tightening the
terms later a new policy version rather than a migration.

Flexibility is why the move matters more than the refund. A guest who cannot
come on the Saturday is offered the Sunday first; the money stays, the cover is
not wasted, and the ledger records what moved. A refund is the second answer,
not the first, and the interface should say so.

## Notifications are an outbox, not a send

The architecture point is smaller and more important than the message list:
**never send from inside the request that took the money.** Write a row; cron
sends it. Scheduling, retries and a record of what went out all come free, and
"the guest says they never got it" becomes answerable.

| Message | To | When |
|---|---|---|
| Confirmation and receipt | Guest | On payment |
| New booking | Staff | On payment |
| Dietary chase | Guest | T−7 days, if none given |
| Reminder and arrival notes | Guest | T−48 hours |
| Tomorrow's sittings | Kitchen, front of house | Daily, 16:00 |
| Cancellation and refund | Guest | On the action |
| We have had to cancel | Guest, in bulk | On a sitting being called off |
| A seat has come free | Waitlist | On a release |
| Voucher, to buyer and recipient | Both | On purchase, or a chosen date |
| Thank you, and a review | Guest | T+1 day |

- **Deliverability is DNS work.** SPF, DKIM and DMARC, sending from
  `mail.moorelodge.co.uk` so a confirmation-reputation problem can never take
  down the mailbox people reply to.
- **Every row carries an idempotency key.** Sending a confirmation twice is the
  one unforgivable bug, and cron plus retries makes it easy.
- **A reminder is scheduled, not swept for.** The row exists from the moment the
  booking does, with `scheduled_for` set, and is voided when the booking is
  cancelled — otherwise we remind somebody about a tea they cancelled a
  fortnight ago.
- **Transactional is not marketing.** Separate lanes, separate consent. Mixing
  them puts confirmations behind an unsubscribe.
- **Texts cut no-shows more than emails do.** Not for cutover, but keep the
  number and the consent field so it is a provider away.

Cloudflare's free mail route for Workers closed some time ago. Budget for a
provider; Resend and Postmark are both a plain HTTP call from a Worker.

## The edges not on the original list

Roughly ordered by how much they would hurt to retrofit.

### Would hurt a lot

- **A waitlist.** Sold-out Saturdays are the best revenue lever here and the
  cheapest feature — a row, a release trigger, one email. It also turns the
  disappointment of a full sitting into a captured contact.
- **Per-guest dietary detail.** Notes hang off the booking today. A table of
  eight with one coeliac needs the allergen attached to a *person* or the kitchen
  is guessing which plate. It also changes the legal weight: allergy information
  is health data, which UK GDPR treats as special category — so it wants a
  retention rule and a deliberate lawful basis, particularly since Samson caches
  it onto phones offline.
- **Guest self-service.** A signed link in the confirmation that allows view,
  add dietary notes, and cancel within policy. No accounts, no passwords. It
  removes most of the phone calls and it is a capability guests have today.
- **An audit trail.** Who cancelled this, when, why. Access already knows who
  everyone is. Append-only; nothing deleted, everything superseded. It is the
  evidence in a chargeback and the answer when two staff disagree.

### Would be missed within a month

- **Operational paper.** Kitchen sheet, front-of-house running order, dietary
  summary per sitting, tomorrow's covers. Samson has the diary, not the
  printouts a service runs on.
- **Reconciliation.** Stripe pays out net of fees in batches matching no single
  booking. Unbuilt, this becomes a monthly evening with a spreadsheet.
- **Promo and comp codes, distinct from vouchers.** A percentage off is not a
  stored balance. Small table, different thing, easy to conflate.
- **Seasons.** Christmas is a different menu at a different price with different
  terms and forty sittings. Absent from the model, it becomes forty hand-edited
  sittings every year.

### Quiet failure modes

- **What the site does when Stripe or D1 is down.** Booking is revenue; the
  fallback is a phone number and a sentence, never a 500. `book.html` already
  does exactly this when freetobook's availability fails.
- **Card testing.** A public payment endpoint attracts it. Radar plus Cloudflare
  rate limiting, configured before launch rather than after the first bill.
- **Turning up with five when four were booked.** Needs a way to take money on
  the day and correct the covers, or the kitchen count drifts from the ledger.
- **Right to erasure against six-year accounting retention.** These conflict.
  Purge guest detail on a schedule, keep the financial record — as designed
  behaviour, not something discovered when somebody asks.

## The cutover: build clean, never sync

A sync means Wix stays authoritative, every booking taken here has to be pushed
back, and every bug becomes a data-integrity bug across a boundary we don't
control. We would spend the build debugging the bridge and then throw it away.

**What is worth building early is the importer** — one-way, idempotent,
re-runnable. Not to run in production alongside Wix, but to point at a scratch
database weekly during the build. That gives real bookings, real names and real
dietary chaos to design against, and it turns the cutover from a one-shot
operation into something already rehearsed thirty times. Most of the mapping is
written: the Wix adapter already turns reservations into `Booking`s.

```
        one-way import, rehearsed weekly
        bookings dated ≥ D · guests · every voucher balance
        ╭─────────────────────────────▶
  Wix sells and holds   │freeze│   Samson sells and holds
  ──────────────────────┼──────┼──────────────────────────
                        ▲
                    cutover · D
```

The two systems never own the same dates. Wix keeps everything before D; Samson
owns everything from it. Samson reads both through the adapter interface it
already has, so one diary spans the seam. We never run two live booking systems
— one live system and one read-only archive.

**What must come across:**

- **Bookings dated on or after D**, with payment state. These people have paid;
  they must not notice anything happened.
- **Every voucher balance**, and the codes as issued. Old codes work
  indefinitely — they are printed on cards in people's kitchen drawers. Check
  whether Wix exposes gift card balances over its API; if not, export from the
  dashboard. Either way, during the freeze, so nothing is spent in the gap.
- **Guest records and history**, so a regular is still a regular.
- **The URLs.** `moorelodge.co.uk/experience-details` and `/gift-card` are live
  Wix pages, linked from the new site and indexed. Redirects on the day.

**Wix's confirmation emails told guests to manage their booking through Wix.**
Those links die at cutover for anyone holding an old one. One email to everybody
with a future booking, on the day, is the difference between a smooth switch and
a fortnight of confused phone calls.

## Three switches, not one

The launch and the migration are separable, and the redirect that makes the
launch possible splits the migration in half as well.

`/experience-details` and `/gift-card` are two independent paths. Each can come
home on its own day. That takes vouchers off the critical path for the tea
cutover, which was the single thing making the first switch large.

### Switch one — the website goes live

Wix moves to `book.moorelodge.co.uk`, the site Worker redirects both paths to
it, the new site takes the apex. **Nothing about the booking system has to be
finished.** Wix keeps selling teas and vouchers exactly as it does today, behind
links that still work — including the ones Google has indexed and the ones in
every confirmation email Wix has already sent.

This is a DNS change and a deploy. The only ordering rule is that the subdomain
must resolve and take a real booking before the Worker ships, because deploying
first takes the tea offline.

### Switch two — tea comes home

`/experience-details` stops redirecting and starts serving our own checkout.
Wix stays alive on the subdomain, unlinked except for gift cards.

| Capability | Why it is here |
|---|---|
| Experiences, offerings, schedule rules, sitting generation | Nothing sells without a calendar |
| Public checkout, full prepayment through Stripe | The journey Wix owns today |
| Holds, the oversell guard, the sweeper | Correctness. Not retrofittable under load |
| Ledger, refunds, policy snapshot | We are the merchant from this day |
| Confirmation, reminder, cancellation, staff notice | A booking nobody is told about is not a booking |
| Guest self-service link | Replaces a capability guests already have |
| Amendments — date, party, offering | Flexible terms make the move the first answer |
| Phone bookings and staff actions on the new store | The forms exist; they need the adapter |
| Audit log, importer for bookings dated on or after D | The switch itself |

### Switch three — vouchers come home, and Wix goes dark

`/gift-card` stops redirecting. Every outstanding Wix balance is imported and
every old code keeps working indefinitely — they are printed on cards in
people's kitchen drawers. Only after this can the Wix account actually be
closed, which is why vouchers were never optional, only later than they looked.

| Capability | Why it is here |
|---|---|
| Voucher sale, redemption, delivery on a date | The last thing Wix does |
| Wix balance and code import | Money we already owe people |
| Redirects retired, Wix subscription cancelled | The end of it |

### After that

Waitlist, per-guest dietary detail, add-ons and upsells, service sheets,
reconciliation and the deferred-revenue report. Then packages, seasons, promo
codes, deposits, tables, texts. All cheap if the model stays honest.

## On doing it this weekend

The website can go live this weekend. Switch one is a subdomain and a deploy,
and the Worker change for it is already written.

Switch two is not a weekend, and it would be a disservice to pretend otherwise.
It is a Stripe integration, a public checkout, an outbox with real
deliverability behind it, an importer run against live data, and amendments —
each of which handles somebody's money on a date they have already told their
family about. The failure modes are all quiet ones: a confirmation that never
arrives, a seat sold twice, a refund taken twice.

The good news is that switch one removes every reason to rush switch two. The
new site is out, Wix is invisible behind a subdomain, and the migration can be
done at the pace correctness actually needs.

## Cheap now, expensive later

1. **A booking is lines.** Never a party size against one offering.
2. **Money is a ledger.** Derive the status; never store it as the truth.
3. **A voucher is a payment method.** Never a discount.
4. **Sittings are rows**, generated from rules, never computed at read time.
5. **Pence as integers.** No floating point anywhere near money.
6. **A `venue_id` on everything from the first migration.** One row today.
   Langholm Group is a group, and adding a tenant column to a live booking
   system is a weekend nobody enjoys.
7. **Prices and policies snapshotted onto the booking.** Never explain an old
   booking with today's configuration.
8. **Nothing is deleted.** Everything superseded; every mutation writes an audit
   row.
9. **A sitting stores its local date and time as well as its instant**, so 13:00
   stays 13:00 across the clock change. `src/time.js` already does this and is
   already tested on both changeover days — use it rather than writing a second
   one.
10. **Every externally-triggered write carries an idempotency key.** Stripe
    retries, cron overlaps, guests double-tap.

## Settled, and what is left

All eight are answered. VAT registered and inclusive; cancellation flexible; one
kitchen; covers not tables; entitlement vouchers honoured generously; full
prepayment with deposits left for later; two horizons, a rolling month for teas
and dated one-offs as far out as we like; and the website going live this
weekend with the migration following behind it.

Two remain for the accountant rather than for us, and neither blocks a line of
code:

- Whether our vouchers are single-purpose for VAT, which decides whether the tax
  falls at sale or at redemption.
- Whether an undated voucher carries the fourteen-day distance-selling
  cancellation right that a dated sitting does not.

Both want answering before the first voucher is sold through our own checkout,
which switch three is the deadline for.

## The schema

`migrations/0001_bookings.sql` is the model above, made concrete and reflecting
the four decisions taken. Seventeen tables, and four of them are the argument:

- **`booking_line`** — one row per thing sold, so a party of four wanting two
  Classic, one Champagne and a children's tea is four lines rather than a party
  size. Price and VAT rate are captured at sale.
- **`sitting`** — a generated row carrying `seats`, `taken` and
  `overbook_allowance`. The oversell guard is one conditional UPDATE against it.
- **`ledger_entry`** — payments, refunds, voucher redemptions, adjustments and
  chargebacks as kinds of one thing, because the question worth answering fast
  is always "what is this booking worth now" and that should be one SUM.
  `PAYMENT` in `src/domain.js` is computed from it and never written down.
- **`voucher`** — monetary, entitlement and complimentary in one table,
  settling through the ledger like a card does.

Four behaviours were exercised against SQLite before the file was committed: the
oversell guard refusing the party that does not fit and admitting the staff
squeeze; a booking part-settled by a £90 voucher and a card reading back as
paid; one guest dropped from a party of four leaving the remainder still paid;
and a duplicated Stripe refund webhook rejected by `ledger_provider_once`
rather than refunding twice.

Nothing is wired up. There is no D1 binding in `wrangler.jsonc` yet, and no
adapter — deliberately, because the next thing that should touch this schema is
real data.

## Next

Two things, in this order.

**Get the website out.** Connect `book.moorelodge.co.uk` in Wix, take a real
booking through it to prove the checkout survives the move, then deploy the site
Worker. The redirect is written and tested; nothing else stands in the way.

**Then the importer**, pointed at a scratch database off live Wix data. That is
what tests whether the model holds — a year of real bookings, real names and
real dietary chaos going into these tables and coming back out as `Booking`s the
existing views render with nothing in `src/views/` changed. If that works, the
seam has done its job and the rest is building the checkout.
