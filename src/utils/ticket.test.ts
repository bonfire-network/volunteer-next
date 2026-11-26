import { ticketToString, ticketFromString } from './ticket';

describe('Ticket utils', () => {
  it('should serialise a ticket', () => {
    const result = ticketToString({
      provider: 'pretix',
      organiser: 'organiser',
      event: 'event',
      id: 1
    });
    expect(result).toBe('pretix/organiser/event/1');
  });
  it('should deserialise a ticket', () => {
    const result = ticketFromString('pretix/testorg/testevent/666');
    expect(result).toEqual({
      provider: 'pretix',
      organiser: 'testorg',
      event: 'testevent',
      id: 666
    });
  });
});
