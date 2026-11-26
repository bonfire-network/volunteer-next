import { ticketToString, ticketFromString } from './ticket';

describe.skip('Ticket utils', () => {
  it('should serialise a ticket', () => {
    const result = ticketToString({
      provider: 'pretix',
      organiser: 'organiser',
      event: 'event',
      id: 1
    });
    expect(result).toBe('pretix/organiser/event/1');
  });
});
