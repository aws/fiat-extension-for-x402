/**
 * Zod runtime validation schemas for Agent Pay types.
 * 
 * These schemas mirror the TypeScript interfaces in types.ts and config.ts,
 * providing runtime validation for untrusted input (e.g., 402 responses,
 * webhook payloads, decoded JWTs).
 * 
 * Usage:
 *   import { QuoteTokenPayloadSchema, parseQuoteToken } from 'aws-agent-pay-x402/schemas';
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

export const AgentPaySettlementSchema = z.object({
  method: SettlementMethodSchema,
  cycle: SettlementCycleSchema.optional(),
});

export const AgentPaySupportSchema = z.object({
  uri: z.string().url(),
  method: z.enum(['human', 'agent']),
});

export const AgentPayTermsSchema = z.object({
  description: z.string().min(1),
  uri: z.string().url(),
});

// ============================================================================
// Price Schema
// ============================================================================

export const QuoteTokenPriceSchema = z.object({
  amount: z.string().regex(/^\d+\.?\d*$/, 'Amount must be a decimal string'),
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
  settlement: AgentPaySettlementSchema.optional(),
  support: AgentPaySupportSchema.optional(),
  terms: z.array(AgentPayTermsSchema).optional(),
});

// ============================================================================
// Payment Extra Schema
// ============================================================================

export const AgentPayPaymentExtraSchema = z.object({
  quoteToken: z.string().min(1),
  reference: z.string().optional(),
  settlement: AgentPaySettlementSchema.optional(),
  support: AgentPaySupportSchema.optional(),
  terms: z.array(AgentPayTermsSchema).optional(),
});

// ============================================================================
// Payment Payload Schema
// ============================================================================

export const AgentPayPayloadV2Schema = z.object({
  paymentToken: z.string().min(1),
  paymentId: z.string().min(1),
  transactionId: z.string().optional(),
});

// ============================================================================
// DPoP JWK Schema
// ============================================================================

export const DpopJwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.enum(['P-256', 'P-384', 'P-521']),
  x: z.string().min(43).max(128),
  y: z.string().min(43).max(128),
});

// ============================================================================
// API Request/Response Schemas
// ============================================================================

export const CreateAgentPaymentRequestSchema = z.object({
  quoteToken: z.string().min(1).max(65536),
  clientToken: z.string().min(1).max(128).optional(),
  dpopJwk: DpopJwkSchema.optional(),
});

export const CreateAgentPaymentResponseSchema = z.object({
  paymentId: z.string().regex(/^awsmp-[0-9a-f-]{36}$/, 'Payment ID must be in awsmp-{UUID} format'),
  paymentToken: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const PaymentAmountSchema = z.object({
  value: z.string().regex(/^\d+\.?\d*$/),
  currency: z.string().length(3),
});

export const SellerInformationSchema = z.object({
  sellerProfileId: z.string().min(1),
  displayName: z.string().min(1),
});

export const PaymentDetailSchema = z.object({
  paymentId: z.string().min(1),
  buyerAccountId: z.string().regex(/^\d{12}$/),
  sellerInformation: SellerInformationSchema,
  listingId: z.string().min(1),
  quoteToken: z.string().min(1),
  paymentToken: z.string().min(1),
  createdAt: z.string().datetime(),
  amount: PaymentAmountSchema,
  agreementId: z.string().optional(),
});

export const GetAgentPaymentResponseSchema = z.object({
  payment: PaymentDetailSchema,
});

export const PaymentSummarySchema = z.object({
  paymentId: z.string().min(1),
  buyerAccountId: z.string().regex(/^\d{12}$/),
  sellerInformation: SellerInformationSchema,
  listingId: z.string().min(1),
  createdAt: z.string().datetime(),
  agreementId: z.string().optional(),
});

export const ListAgentPaymentsResponseSchema = z.object({
  payments: z.array(PaymentSummarySchema),
  nextToken: z.string().optional(),
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
export function safeParseQuoteToken(token: string): z.SafeParseReturnType<unknown, z.infer<typeof QuoteTokenPayloadSchema>> {
  try {
    const decoded = jose.decodeJwt(token);
    return QuoteTokenPayloadSchema.safeParse(decoded);
  } catch {
    return {
      success: false,
      error: new z.ZodError([{
        code: 'custom',
        message: 'Invalid JWT format',
        path: [],
      }]),
    } as z.SafeParseReturnType<unknown, z.infer<typeof QuoteTokenPayloadSchema>>;
  }
}

/**
 * Validate a payment payload structure.
 * 
 * @param payload - Payment payload object
 * @returns Validated AgentPayPayloadV2
 * @throws z.ZodError if payload doesn't match schema
 */
export function parsePaymentPayload(payload: unknown): z.infer<typeof AgentPayPayloadV2Schema> {
  return AgentPayPayloadV2Schema.parse(payload);
}

/**
 * Validate a CreateAgentPayment response.
 * 
 * @param response - API response object
 * @returns Validated response
 * @throws z.ZodError if response doesn't match schema
 */
export function parseCreatePaymentResponse(response: unknown): z.infer<typeof CreateAgentPaymentResponseSchema> {
  return CreateAgentPaymentResponseSchema.parse(response);
}
