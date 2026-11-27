import { validateTicketStrings } from './ticket-validator';

describe('validateTicketStrings', () => {
  it.each([
    {
      tickets: ['pretix/org/evt/1', 'pretix/org/evt/2', 'pretix/org/evt/3'],
      isValid: true
    },
    {
      tickets: ['invalid/org/evt/1'],
      isValid: false
    },
    {
      tickets: ['pretix/org/evt/1', 'bad/string'],
      isValid: false
    }
  ])('should validate $tickets as $isValid', ({ tickets, isValid }) => {
    const formData = new FormData();
    tickets.forEach((t) => formData.append('tickets', t));
    if (isValid) {
      expect(validateTicketStrings(formData)).toEqual(tickets);
    } else {
      expect(() => validateTicketStrings(formData)).toThrow();
    }
  });
});
