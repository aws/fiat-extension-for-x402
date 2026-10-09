// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Zod runtime validation schemas for Agentic Commerce types.
 *
 * These schemas mirror the TypeScript interfaces in types.ts,
 * providing runtime validation for untrusted input (e.g., 402 responses,
 * webhook payloads, decoded JWTs).
 *
 * Usage:
 *   import { QuoteTokenPayloadSchema, parseQuoteToken } from '@aws/fiat-extension-for-x402/schemas';
 *   const validated = QuoteTokenPayloadSchema.parse(decoded);
 *   // or
 *   const result = parseQuoteToken(tokenString); // decode + validate
 */

import { z } from 'zod';
import * as jose from 'jose';

// ============================================================================
// Settlement Schemas
// ============================================================================

export const SettlementMethodSchema = z.enum(['INST', 'CLRG', 'CRDT']);

export const SettlementCycleSchema = z.enum(['MNTH', 'WEEK', 'QRTR']);

export const AgenticCommerceSettlementSchema = z.object({
  method: SettlementMethodSchema,
  cycle: SettlementCycleSchema.optional(),
});

export const AgenticCommerceSupportSchema = z.object({
  uri: z.string().url(),
  method: z.enum(['human', 'agent']),
});

export const AgenticCommerceTermsSchema = z.object({
  description: z.string().min(1),
  uri: z.string().url(),
});

// ============================================================================
// Price Schema
// ============================================================================

export const QuoteTokenPriceSchema = z.object({
  // Same strings as /^\d+\.?\d*$/, but linear-time: the old form backtracks
  // quadratically on a long run of digits (CodeQL js/polynomial-redos).
  amount: z.string().regex(/^\d+(?:\.\d*)?$/, 'Amount must be a decimal string'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO 4217 code'),
});

// ============================================================================
// Quote Token Schema
// ============================================================================

export const QuoteTokenPayloadSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1))]),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().min(1),
  price: z.union([QuoteTokenPriceSchema, z.array(QuoteTokenPriceSchema).min(1)]),
  payTo: z.string().min(1),
  reference: z.string(),
  description: z.string().optional(),
  dimensions: z.record(z.union([z.string(), z.number()])).optional(),
  settlement: AgenticCommerceSettlementSchema.optional(),
  support: AgenticCommerceSupportSchema.optional(),
  terms: z.array(AgenticCommerceTermsSchema).optional(),
});

// ============================================================================
// Payment Extra Schema
// ============================================================================

export const AgenticCommercePaymentExtraSchema = z.object({
  quoteToken: z.string().min(1),
  reference: z.string().optional(),
  settlement: AgenticCommerceSettlementSchema.optional(),
  support: AgenticCommerceSupportSchema.optional(),
  terms: z.array(AgenticCommerceTermsSchema).optional(),
});

// ============================================================================
// Payment Payload Schema
// ============================================================================

export const AgenticCommercePayloadV2Schema = z.object({
  paymentToken: z.string().min(1),
  paymentId: z.string().min(1),
  transactionId: z.string().optional(),
});

// ============================================================================
// Parse Utilities (decode + validate)
// ============================================================================

/**
 * Decode and validate a quote token JWT.
 * Decodes without signature verification, then validates the payload structure.
 *
 * @param token - Quote token JWT string
 * @returns Validated QuoteTokenPayload
 * @throws z.ZodError if payload doesn't match schema
 */
export function parseQuoteToken(token: string): z.infer<typeof QuoteTokenPayloadSchema> {
  const decoded = jose.decodeJwt(token);
  return QuoteTokenPayloadSchema.parse(decoded);
}

/**
 * Safely decode and validate a quote token JWT.
 * Returns a Zod SafeParseResult instead of throwing.
 *
 * @param token - Quote token JWT string
 * @returns SafeParseResult with success/error
 */
export function safeParseQuoteToken(
  token: string
): z.SafeParseReturnType<unknown, z.infer<typeof QuoteTokenPayloadSchema>> {
  try {
    const decoded = jose.decodeJwt(token);
    return QuoteTokenPayloadSchema.safeParse(decoded);
  } catch {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          message: 'Invalid JWT format',
          path: [],
        },
      ]),
    } as z.SafeParseReturnType<unknown, z.infer<typeof QuoteTokenPayloadSchema>>;
  }
}

/**
 * Validate a payment payload structure.
 *
 * @param payload - Payment payload object
 * @returns Validated AgenticCommercePayloadV2
 * @throws z.ZodError if payload doesn't match schema
 */
export function parsePaymentPayload(
  payload: unknown
): z.infer<typeof AgenticCommercePayloadV2Schema> {
  return AgenticCommercePayloadV2Schema.parse(payload);
}
