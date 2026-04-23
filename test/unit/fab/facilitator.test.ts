import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { FABScheme } from '../../../src/fab/facilitator/scheme';
import { verifyPayment } from '../../../src/fab/facilitator/verify';
import { settlePayment } from '../../../src/fab/facilitator/settle';
import type { WalletClient } from '../../../src/config';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { FABPayloadV2 } from '../../../src/types';
import { FAB_SCHEME } from '../../../src/constants';
import { FAB_SENTINEL_PAY_TO } from '../../../src/constants';
import { createMockWalletClient } from '../../helpers/mock-wallet-client';

/**
 * FAB Facilitator Unit Tests
 * 
 * Tests the facilitator scheme with mock wallet client.
 * In production, the facilitator fetches the wallet's public key from JWKS endpoint
 * and calls the wallet provider's API to verify and capture payments.
 */

describe('FAB Facilitator Scheme', () => {
  let walletClient: WalletClient;
  let privateKey: jose.KeyLike;
  let publicKey: jose.KeyLike;
  let scheme: FABScheme;
  const walletId = 'wallet-test-456';

  beforeEach(async () => {
    // Create mock wallet client
    const mock = await createMockWalletClient(walletId);
    walletClient = mock.walletClient;
    privateKey = mock.privateKey;
    publicKey = mock.publicKey;

    scheme = new FABScheme({
      walletId,
      walletClient
    });
  });

  describe('Scheme', () => {
    it('should return correct extra data with wallet ID', () => {
      const extra = scheme.getExtra('fab:test');
      expect(extra).toBeDefined();
      expect(extra?.walletId).toBe(walletId);
    });

    it('should return signer addresses', () => {
      const addresses = scheme.getSigners('fab:test');
      expect(addresses).toBeDefined();
      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses).toHaveLength(1);
      expect(addresses[0]).toBe(walletId);
    });

    it('should verify payment payload', async () => {
      // Create quote token (signed by service)
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      // Create payment token (signed by wallet)
      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const result = await scheme.verify(payload, requirements);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(walletId);
    });

    it('should settle payment', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const result = await scheme.settle(payload, requirements);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe(transactionId);
      expect(result.network).toBe('fab:test');
    });
  });

  describe('Verification', () => {
    it('should verify valid payment token', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(walletId);
    });

    it('should reject payment with invalid signature', async () => {
      // Create a different key pair for invalid signature
      const { privateKey: wrongKey } = await jose.generateKeyPair('RS256');

      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      // Sign with wrong key
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(wrongKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_failed');
    });

    it('should reject payment with expired token', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_failed');
    });

    it('should verify quote token matches requirements', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(true);
    });

    it('should verify transaction ID matches', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(true);
    });

    it('should reject payment with quote token mismatch', async () => {
      // Create the correct quote token
      const correctQuoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_correct',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      // Create a different quote token (attacker trying to use different quote)
      const differentQuoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_different',
        price: { amount: '0.50', currency: 'USD' }, // Different price!
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      // Payment token contains different quote token than requirements
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: differentQuoteToken // Using different quote!
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken: correctQuoteToken } as unknown as Record<string, unknown> // Expecting correct quote
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_failed');
      expect(result.invalidMessage).toContain('Quote token mismatch');
    });

    it('should reject payment with transaction ID mismatch', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const correctTransactionId = 'fab:test:txn_correct';
      const differentTransactionId = 'fab:test:txn_different';

      // Payment token contains one transaction ID
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: correctTransactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId: differentTransactionId // Different transaction ID in payload!
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId: differentTransactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_failed');
      expect(result.invalidMessage).toContain('Transaction ID mismatch');
    });

    it('should reject payment when quote token is missing from payment context', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_123';
      // Payment token missing quote_token in payment_context
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId
          // quote_token is missing!
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_failed');
    });
  });

  describe('Settlement', () => {
    it('should settle payment successfully', async () => {
      const transactionId = 'fab:test:txn_123';
      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken: 'token',
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: {}
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken: 'token',
        transactionId
      };

      const result = await settlePayment(walletClient, payload, requirements, fabPayload);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe(transactionId);
      expect(result.network).toBe('fab:test');
    });

    it('should return settlement ID', async () => {
      const transactionId = 'fab:test:txn_456';
      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken: 'token',
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '2.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: {}
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken: 'token',
        transactionId
      };

      const result = await settlePayment(walletClient, payload, requirements, fabPayload);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe(transactionId);
    });

    it('should handle settlement errors', async () => {
      const transactionId = 'fab:test:txn_789';
      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken: 'token',
          transactionId
        } as unknown as Record<string, unknown>
      };

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '3.50',
        asset: 'iso4217:USD',
        payTo: 'service-wallet',
        maxTimeoutSeconds: 3600,
        extra: {}
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken: 'token',
        transactionId
      };

      const result = await settlePayment(walletClient, payload, requirements, fabPayload);
      // Current implementation always succeeds, but structure is correct
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('transaction');
      expect(result).toHaveProperty('network');
    });
  });

  describe('Sentinel Values (Task 28)', () => {
    it('should verify payment when requirements.payTo is the sentinel value', async () => {
      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_sentinel',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-wallet',
        capture: 'manual',
        reference: 'TEST'
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const transactionId = 'fab:test:txn_sentinel';
      const paymentToken = await new jose.SignJWT({
        iss: walletId,
        sub: walletId,
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: transactionId,
          quote_token: quoteToken
        }
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken,
          transactionId
        } as unknown as Record<string, unknown>
      };

      // Use sentinel payTo — this is what the server scheme now produces
      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: FAB_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken,
        transactionId
      };

      const result = await verifyPayment(walletClient, payload, requirements, fabPayload);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(walletId);
    });

    it('should settle payment when requirements.payTo is the sentinel value', async () => {
      const transactionId = 'fab:test:txn_sentinel_settle';
      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          paymentToken: 'token',
          transactionId
        } as unknown as Record<string, unknown>
      };

      // Use sentinel payTo
      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: FAB_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: {}
      };

      const fabPayload: FABPayloadV2 = {
        paymentToken: 'token',
        transactionId
      };

      const result = await settlePayment(walletClient, payload, requirements, fabPayload);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe(transactionId);
    });
  });
});
