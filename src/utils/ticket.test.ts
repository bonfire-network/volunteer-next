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
  it('should fail to deserialise a bad string', () => {
    expect(() => {
      ticketFromString('bad/string');
    }).toThrow();
    expect(() => {
      ticketFromString('pretix/org/evnt/nan');
    }).toThrow();
    expect(() => {
      ticketFromString('satan/org/evnt/1');
    }).toThrow();
  });
});
