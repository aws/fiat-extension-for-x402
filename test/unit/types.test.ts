import { describe, it, expect } from 'vitest';
import type {
  FABPaymentExtra,
  QuoteTokenPrice,
  QuoteTokenPayload,
  PaymentContext,
  PaymentTokenPayload,
  CaptureMode,
  SettlementMethod,
  SettlementCycle,
  FABSettlement,
  FABSupport,
  FABTerms,
} from '../../src/types';

describe('Payment Types', () => {
  describe('FABPaymentExtra', () => {
    it('should accept minimal payment extra with only quoteToken', () => {
      const extra: FABPaymentExtra = {
        quoteToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
      };
      expect(extra.quoteToken).toBeDefined();
      expect(extra.capture).toBeUndefined();
      expect(extra.reference).toBeUndefined();
    });

    it('should accept payment extra with all optional fields', () => {
      const extra: FABPaymentExtra = {
        quoteToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        capture: 'manual',
        reference: 'WEATHER_DATA_TIER1',
        settlement: {
          method: 'CLRG',
          cycle: 'MNTH',
        },
        support: {
          uri: 'https://api.weather.com/disputes',
          method: 'human',
        },
        terms: [
          {
            description: 'End User License Agreement',
            uri: 'https://api.weather.com/eula',
          },
        ],
      };
      expect(extra.quoteToken).toBe('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...');
      expect(extra.capture).toBe('manual');
      expect(extra.reference).toBe('WEATHER_DATA_TIER1');
      expect(extra.settlement).toBeDefined();
      expect(extra.support).toBeDefined();
      expect(extra.terms).toHaveLength(1);
    });
  });

  describe('QuoteTokenPrice', () => {
    it('should accept price with amount and currency', () => {
      const price: QuoteTokenPrice = {
        amount: '0.15',
        currency: 'USD',
      };
      expect(price.amount).toBe('0.15');
      expect(price.currency).toBe('USD');
    });
  });

  describe('QuoteTokenPayload', () => {
    it('should accept minimal quote token payload', () => {
      const payload: QuoteTokenPayload = {
        iss: 'https://api.weather.com',
        aud: 'fab:aws',
        iat: 1735689600,
        exp: 1735689900,
        jti: 'quote_12345',
        price: {
          amount: '0.15',
          currency: 'USD',
        },
        payTo: 'pay-weather-co-aws',
        capture: 'manual',
        reference: 'WEATHER_DATA_TIER1',
      };
      expect(payload.iss).toBe('https://api.weather.com');
      expect(payload.price).toBeDefined();
      expect(payload.payTo).toBe('pay-weather-co-aws');
    });

    it('should accept quote token payload with array of prices', () => {
      const payload: QuoteTokenPayload = {
        iss: 'https://api.weather.com',
        aud: 'fab:aws',
        iat: 1735689600,
        exp: 1735689900,
        jti: 'quote_12345',
        price: [
          { amount: '0.15', currency: 'USD' },
          { amount: '0.12', currency: 'EUR' },
        ],
        payTo: 'pay-weather-co-aws',
        capture: 'manual',
        reference: 'WEATHER_DATA_TIER1',
      };
      expect(Array.isArray(payload.price)).toBe(true);
      expect(payload.price).toHaveLength(2);
    });

    it('should accept quote token payload with audience as array', () => {
      const payload: QuoteTokenPayload = {
        iss: 'https://api.weather.com',
        aud: ['fab:aws', 'fab:google'],
        iat: 1735689600,
        exp: 1735689900,
        jti: 'quote_12345',
        price: {
          amount: '0.15',
          currency: 'USD',
        },
        payTo: 'pay-weather-co-aws',
        capture: 'manual',
        reference: 'WEATHER_DATA_TIER1',
      };
      expect(Array.isArray(payload.aud)).toBe(true);
      expect(payload.aud).toHaveLength(2);
    });

    it('should accept quote token payload with optional settlement, support, and terms', () => {
      const payload: QuoteTokenPayload = {
        iss: 'https://api.weather.com',
        aud: 'fab:aws',
        iat: 1735689600,
        exp: 1735689900,
        jti: 'quote_12345',
        price: {
          amount: '0.15',
          currency: 'USD',
        },
        payTo: 'pay-weather-co-aws',
        capture: 'manual',
        reference: 'WEATHER_DATA_TIER1',
        settlement: {
          method: 'CLRG',
          cycle: 'MNTH',
        },
        support: {
          uri: 'https://api.weather.com/disputes',
          method: 'human',
        },
        terms: [
          {
            description: 'End User License Agreement',
            uri: 'https://api.weather.com/eula',
          },
        ],
      };
      expect(payload.settlement).toBeDefined();
      expect(payload.support).toBeDefined();
      expect(payload.terms).toHaveLength(1);
    });
  });

  describe('PaymentContext', () => {
    it('should accept payment context with transaction_id and quote_token', () => {
      const context: PaymentContext = {
        transaction_id: 'fab:aws:txn_888999',
        quote_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
      };
      expect(context.transaction_id).toBe('fab:aws:txn_888999');
      expect(context.quote_token).toBe('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...');
    });
  });

  describe('PaymentTokenPayload', () => {
    it('should accept minimal payment token payload', () => {
      const payload: PaymentTokenPayload = {
        iss: 'https://pay.aws.amazon.com',
        sub: 'client_uuid_555',
        aud: 'https://api.weather.com',
        iat: 1735689600,
        exp: 1735689900,
        payment_context: {
          transaction_id: 'fab:aws:txn_888999',
          quote_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      };
      expect(payload.iss).toBe('https://pay.aws.amazon.com');
      expect(payload.sub).toBe('client_uuid_555');
      expect(payload.payment_context).toBeDefined();
      expect(payload.cnf).toBeUndefined();
    });

    it('should accept payment token payload with DPoP confirmation', () => {
      const payload: PaymentTokenPayload = {
        iss: 'https://pay.aws.amazon.com',
        sub: 'client_uuid_555',
        aud: 'https://api.weather.com',
        iat: 1735689600,
        exp: 1735689900,
        payment_context: {
          transaction_id: 'fab:aws:txn_888999',
          quote_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
        cnf: {
          jkt: 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs',
        },
      };
      expect(payload.cnf).toBeDefined();
      expect(payload.cnf?.jkt).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
    });
  });
});

describe('Settlement Types', () => {
  describe('CaptureMode', () => {
    it('should accept valid capture modes', () => {
      const manual: CaptureMode = 'manual';
      const automatic: CaptureMode = 'automatic';
      expect(manual).toBe('manual');
      expect(automatic).toBe('automatic');
    });
  });

  describe('SettlementMethod', () => {
    it('should accept valid settlement methods', () => {
      const inst: SettlementMethod = 'INST';
      const clrg: SettlementMethod = 'CLRG';
      const crdt: SettlementMethod = 'CRDT';
      expect(inst).toBe('INST');
      expect(clrg).toBe('CLRG');
      expect(crdt).toBe('CRDT');
    });
  });

  describe('SettlementCycle', () => {
    it('should accept valid settlement cycles', () => {
      const daily: SettlementCycle = 'DAIL';
      const weekly: SettlementCycle = 'WEEK';
      const monthly: SettlementCycle = 'MNTH';
      expect(daily).toBe('DAIL');
      expect(weekly).toBe('WEEK');
      expect(monthly).toBe('MNTH');
    });
  });

  describe('FABSettlement', () => {
    it('should accept settlement with method only', () => {
      const settlement: FABSettlement = {
        method: 'INST',
      };
      expect(settlement.method).toBe('INST');
      expect(settlement.cycle).toBeUndefined();
    });

    it('should accept settlement with method and cycle', () => {
      const settlement: FABSettlement = {
        method: 'CLRG',
        cycle: 'MNTH',
      };
      expect(settlement.method).toBe('CLRG');
      expect(settlement.cycle).toBe('MNTH');
    });
  });

  describe('FABSupport', () => {
    it('should accept support with uri and method', () => {
      const support: FABSupport = {
        uri: 'https://api.weather.com/disputes',
        method: 'human',
      };
      expect(support.uri).toBe('https://api.weather.com/disputes');
      expect(support.method).toBe('human');
    });
  });

  describe('FABTerms', () => {
    it('should accept terms with description and uri', () => {
      const terms: FABTerms = {
        description: 'End User License Agreement',
        uri: 'https://api.weather.com/eula',
      };
      expect(terms.description).toBe('End User License Agreement');
      expect(terms.uri).toBe('https://api.weather.com/eula');
    });
  });
});
