// Reading a phone booking off a form: the rules, and the hour that Ballymoney
// and UTC disagree about for half the year.
import { readDraft, MAX_PARTY } from '../src/draft.js';

let fail = 0;
const is = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`, ok ? String(JSON.stringify(got)).slice(0, 60) : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
};

const EXPERIENCES = new Map([['tea-id', { id:'tea-id', name:'Afternoon Tea' }]]);
const form = (over = {}) => new URLSearchParams({
  date:'2026-08-06', time:'12:30', partySize:'4',
  firstName:'Ann', lastName:'Blair', phone:'+44 7700 900123', ...over,
});

console.log('--- a booking somebody read down the phone ---');
{
  const { draft, errors } = readDraft(form({ experienceId:'tea-id', email:'a@b.co', note:'window table' }), { experiences: EXPERIENCES });
  is('no complaints', errors, []);
  is('half twelve in August is 11:30Z', draft.startsAt.toISOString(), '2026-08-06T11:30:00.000Z');
  is('party size is a number', draft.partySize, 4);
  is('names kept apart', [draft.firstName, draft.lastName], ['Ann', 'Blair']);
  is('the note becomes the team message', draft.teamMessage, 'window table');
  is('the experience is carried', draft.experienceId, 'tea-id');
}

console.log('--- the same clock face, the other half of the year ---');
{
  const winter = readDraft(form({ date:'2026-01-06' })).draft;
  is('half twelve in January is 12:30Z', winter.startsAt.toISOString(), '2026-01-06T12:30:00.000Z');
  // The two days the lodge and UTC disagree about by a changing amount.
  is('the 23-hour day', readDraft(form({ date:'2026-03-29', time:'13:00' })).draft.startsAt.toISOString(), '2026-03-29T12:00:00.000Z');
  is('the 25-hour day', readDraft(form({ date:'2026-10-25', time:'13:00' })).draft.startsAt.toISOString(), '2026-10-25T13:00:00.000Z');
}

console.log('--- what it will not accept ---');
{
  const complaint = (over, extra) => readDraft(form(over), extra).errors.join(' | ');
  is('a missing name', /first name/.test(complaint({ firstName:'' })), true);
  is('a missing phone', /phone number is needed/.test(complaint({ phone:'' })), true);
  is('a phone too short to be one', /too short/.test(complaint({ phone:'123' })), true);
  is('a party of nobody', /How many/.test(complaint({ partySize:'0' })), true);
  is('a party bigger than the lodge', /more people/.test(complaint({ partySize:String(MAX_PARTY + 1) })), true);
  is('a date that is not one', /Pick a date/.test(complaint({ date:'the 6th' })), true);
  is('a time that is not one', /Give a time/.test(complaint({ time:'lunchtime' })), true);
  is('an email that is not one', /email address/.test(complaint({ email:'ann@' })), true);
  is('an experience we do not run', /not one we run/.test(complaint({ experienceId:'made-up' }, { experiences: EXPERIENCES })), true);
  is('and nothing is drafted when it complains', readDraft(form({ phone:'' })).draft, null);
}

console.log('--- and what it hands back so nobody retypes a phone call ---');
{
  const { values, draft } = readDraft(form({ phone:'', note:'  coeliac  ' }));
  is('everything typed comes back', [values.firstName, values.partySize, values.time], ['Ann', '4', '12:30']);
  is('trimmed', values.note, 'coeliac');
  is('but no booking was made of it', draft, null);
  // Optional fields become null rather than empty strings: the adapter leaves
  // out what is null, and Wix treats "" as a value somebody meant to send.
  const bare = readDraft(form()).draft;
  is('an absent email is null, not empty', bare.email, null);
  is('an absent note likewise', bare.teamMessage, null);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
