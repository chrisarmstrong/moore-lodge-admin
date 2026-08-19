export const TEA = 'e0f47a7c-4768-4d6c-89df-d5db219a82da';
export const DIETARY = '0e64b271-61cb-4457-8760-8fb3e26accdf';   // experience-level field
export const ALLERGY = '6c380298-aa0a-4da9-803a-749aea40995d';   // location-level field

export const RESERVATIONS = [
  // phone booking, no email, no custom fields, empty teamMessage
  { id:'8fecbe44-1090-4a42-a0eb-f4831b99cc91', status:'RESERVED', source:'OFFLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:3, experienceId:TEA },
    reservee:{ firstName:'Nessy', lastName:'Blair', customFields:{} }, teamMessage:'' },
  // online, paid, real dietary note
  { id:'006abfa7-e990-41dd-af31-b4574c1b8a55', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:4, experienceId:TEA },
    reservee:{ firstName:'Lorna', lastName:'Dunlop', email:'l@example.com', phone:'+442827666470',
      customFields:{ [DIETARY]:"2 people can't eat egg in sandwiches but it's ok in anything else." } } },
  // HELD with NO reservee object at all — must not throw
  { id:'275bdd0d-ca78-420a-8335-2b629b402744', status:'HELD', source:'ONLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:2, experienceId:TEA } },
  // awaiting payment, custom field present but EMPTY string — must be dropped
  { id:'64810a35-9753-494a-882e-b0bcc3ff59a2', status:'PAYMENT_INFORMATION_PENDING', source:'ONLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:2, experienceId:TEA },
    reservee:{ firstName:'Coare', lastName:'McNicholl ', email:'p@example.com', customFields:{ [DIETARY]:'' } } },
  // cancelled + archived — must not appear at all
  { id:'073b9ffb-35d5-4ecf-8e76-88fddd9c34b0', status:'CANCELED', source:'OFFLINE', paymentStatus:'NOT_PAID', archived:true,
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:3, experienceId:TEA },
    reservee:{ firstName:'Mrs Moore', customFields:{} } },
  // NO experienceId — location-level allergy field, plain reservation
  { id:'5768de91-3a77-4eb0-82f8-818e7cb3391f', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-06T12:30:00Z', endDate:'2026-08-06T14:00:00Z', partySize:3 },
    reservee:{ firstName:'Sandra', lastName:'McIlhatton', email:'s@example.com', customFields:{ [ALLERGY]:'None' } } },
  // big party, real team message, phone booking
  { id:'5c79f8ce-faed-4094-84c6-817eb1fad546', status:'RESERVED', source:'OFFLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T12:30:00Z', endDate:'2026-08-06T14:30:00Z', partySize:10, experienceId:TEA },
    reservee:{ firstName:'Erin', lastName:'Hen Party', phone:'+447961705118', customFields:{} },
    teamMessage:'using thermal afterwards from 3:30pm - 5pm - they are paying £50pp' },
  // a different day, so the grid has more than one busy cell
  { id:'336635e6-fbf2-4e52-898b-b7c9e0d33ae2', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-28T13:30:00Z', endDate:'2026-08-28T15:30:00Z', partySize:2, experienceId:TEA },
    reservee:{ firstName:'Cathy', lastName:'Glass', email:'c@example.com', customFields:{ [DIETARY]:'None' } } },
];

export const EXPERIENCES = [{ id:TEA, archived:false, configuration:{
  displayInfo:{ name:'Afternoon Tea' },
  paymentPolicy:{ paymentPolicyType:'PER_GUEST', perGuestOptions:{ price:'40' } },
  onlineReservations:{ maxGuests:{ number:15 }, partySize:{ min:2, max:6 }, businessSchedule:{ durationInMinutes:120 } },
  reservationForm:{ customFieldDefinitions:[{ id:DIETARY, name:'Dietary requirements' }] },
  visible:true } }];

export const LOCATIONS = [{ id:'19e73162', configuration:{ reservationForm:{
  customFieldDefinitions:[{ id:ALLERGY, name:'Please confirm any allergies.' }] } } }];

