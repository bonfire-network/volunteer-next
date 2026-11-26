import { validateTicketStrings } from './ticket-validator';

describe('validateTicketStrings', () => {
  it('should validate a list of ticket strings', () => {
    const formData = new FormData();
    formData.append('tickets', 'ticket-a');
    formData.append('tickets', 'ticket-b');
    formData.append('tickets', 'ticket-c');
    formData.append('tickets', 'ticket-d');
    expect(validateTicketStrings(formData)).toEqual([
      'ticket-a',
      'ticket-b',
      'ticket-c',
      'ticket-d'
    ]);
  });
});
