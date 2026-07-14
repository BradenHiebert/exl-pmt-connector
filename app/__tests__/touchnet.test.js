const PMTWS = require('../payMyTuition');

describe('generateTicketBody() validation', () => {
  let payMyTuition;

  beforeAll(async () => {
    payMyTuition = await PMTWS.init('https://example.test/payMyTuition');
  });

  const baseOptions = {
    amount: 100,
    success: 'https://example.test/success',
    error: 'https://example.test/error',
    cancel: 'https://example.test/cancel',
    referrer: 'https://example.test/referrer',
    post_message: 'false',
    institution: 'TEST'
  };

  it('throws on XML tag injection in ticketName', async () => {
    const maliciousTicketName = 'user123</typ:ticketName><typ:nameValuePairs><typ:name>HACKER';
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('throws on XML comment injection in ticketName', async () => {
    const maliciousTicketName = 'user123<!-- INJECTED -->';
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('throws on CDATA injection in ticketName', async () => {
    const maliciousTicketName = 'user123]]><![CDATA[INJECTED';
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('throws on script tags in ticketName', async () => {
    const maliciousTicketName = 'admin<script>alert(1)</script>';
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('throws on quotes in ticketName', async () => {
    const maliciousTicketName = 'user"test';
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('throws on apostrophes in ticketName', async () => {
    const maliciousTicketName = "user'test";
    await expect(payMyTuition.generateTicket(maliciousTicketName, baseOptions)).rejects.toThrow('Invalid characters in ticketName');
  });

  it('accepts valid alphanumeric ticketName', async () => {
    const validTicketName = 'user123_test-name';
    // This will fail at the network level since we're using a test URL,
    // but the validation should pass
    try {
      await payMyTuition.generateTicket(validTicketName, baseOptions);
    } catch (e) {
      // Expected to fail at network level, not validation
      expect(e.message).not.toMatch(/Invalid characters/);
    }
  });
});

