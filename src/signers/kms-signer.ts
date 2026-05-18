/**
 * AWS KMS Signer for Agent Pay quote tokens.
 *
 * Provides a production-ready ServiceAgenticPaySigner that signs quote tokens
 * using an AWS KMS asymmetric key (EC P-256, P-384, or P-521).
 *
 * Usage:
 * ```typescript
 * import { createKmsSigner } from '@x402/aws-agentic-pay/signers/kms';
 * import { AgenticPayServerScheme } from '@x402/aws-agentic-pay';
 *
 * const server = new AgenticPayServerScheme({
 *   signer: createKmsSigner({
 *     keyArn: 'arn:aws:kms:us-east-1:123456789012:alias/my-quote-signing-key',
 *     region: 'us-east-1',
 *   })
 * });
 * ```
 */

import { KMSClient, SignCommand, type SigningAlgorithmSpec } from '@aws-sdk/client-kms';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import type { ServiceAgentPaySigner } from '../config';

/**
 * Configuration for the KMS signer.
 */
export interface KmsSignerConfig {
  /** KMS key ARN or alias ARN (e.g., 'arn:aws:kms:us-east-1:...:alias/my-key') */
  keyArn: string;
  /** AWS region where the KMS key lives */
  region: string;
  /** Service URL used as the `iss` claim in quote tokens */
  serviceUrl: string;
  /** Optional: AWS credentials provider. Defaults to the default credential chain. */
  credentials?: AwsCredentialIdentityProvider;
  /** Optional: Signing algorithm. Defaults to ECDSA_SHA_384 (for P-384 keys). */
  algorithm?: 'ECDSA_SHA_256' | 'ECDSA_SHA_384' | 'ECDSA_SHA_512';
  /** Optional: Key ID to include in the JWT `kid` header. Defaults to the alias or key ID from the ARN. */
  kid?: string;
}

/** Maps KMS algorithm to JWT alg header */
const ALG_MAP: Record<string, string> = {
  ECDSA_SHA_256: 'ES256',
  ECDSA_SHA_384: 'ES384',
  ECDSA_SHA_512: 'ES512',
};

/** Maps KMS algorithm to component byte length for DER→raw conversion */
const COMPONENT_LENGTH: Record<string, number> = {
  ECDSA_SHA_256: 32,
  ECDSA_SHA_384: 48,
  ECDSA_SHA_512: 66,
};

/**
 * Create a ServiceAgenticPaySigner backed by AWS KMS.
 *
 * Signs quote tokens using a KMS asymmetric EC key. The private key never
 * leaves KMS — signing happens server-side via the KMS Sign API.
 *
 * @param config - KMS signer configuration
 * @returns A ServiceAgenticPaySigner that signs with KMS
 *
 * @example
 * ```typescript
 * const signer = createKmsSigner({
 *   keyArn: 'arn:aws:kms:us-east-1:123456789012:alias/my-quote-key',
 *   region: 'us-east-1',
 *   serviceUrl: 'https://api.myservice.com',
 * });
 *
 * const server = new AgenticPayServerScheme({ signer });
 * ```
 */
export function createKmsSigner(config: KmsSignerConfig): ServiceAgentPaySigner {
  const { keyArn, region, serviceUrl, credentials, algorithm = 'ECDSA_SHA_384', kid } = config;

  const jwtAlg = ALG_MAP[algorithm];
  if (!jwtAlg) throw new Error(`Unsupported algorithm: ${algorithm}`);

  const componentLength = COMPONENT_LENGTH[algorithm]!;

  // Derive kid from ARN if not explicitly provided
  // e.g., 'arn:aws:kms:us-east-1:123:alias/my-key' → 'alias/my-key'
  // e.g., 'arn:aws:kms:us-east-1:123:key/abc-123'  → 'key/abc-123'
  const resolvedKid = kid ?? keyArn.split(':').pop() ?? keyArn;

  const kmsClient = new KMSClient({
    region,
    ...(credentials && { credentials }),
  });

  return {
    signQuote: async (payload: unknown): Promise<string> => {
      const header = Buffer.from(JSON.stringify({ alg: jwtAlg, typ: 'JWT', kid: resolvedKid })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const message = Buffer.from(`${header}.${body}`);

      const response = await kmsClient.send(new SignCommand({
        KeyId: keyArn,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: algorithm as SigningAlgorithmSpec,
      }));

      if (!response.Signature) {
        throw new Error('KMS Sign returned no signature');
      }

      const signature = derToRawBase64url(response.Signature, componentLength);
      return `${header}.${body}.${signature}`;
    },

    getPublicKey: () => ({}), // Not needed — Agent Pay fetches the public key from KMS directly

    getServiceUrl: () => serviceUrl,
  };
}

/**
 * Convert a DER-encoded ECDSA signature to raw r||s base64url format.
 *
 * KMS returns signatures in DER (ASN.1) format:
 *   SEQUENCE { INTEGER r, INTEGER s }
 *
 * JWTs require raw concatenation: r (fixed-length) || s (fixed-length)
 */
function derToRawBase64url(derSig: Uint8Array, componentLength: number): string {
  const der = Buffer.from(derSig);
  let offset = 2;
  // Handle long-form length encoding
  if (der[1]! > 0x80) offset += (der[1]! & 0x7f);

  // Read r
  offset++; // skip 0x02 tag
  const rLen = der[offset++]!;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;

  // Read s
  offset++; // skip 0x02 tag
  const sLen = der[offset++]!;
  const s = der.subarray(offset, offset + sLen);

  // Pad/trim to fixed component length
  const raw = Buffer.alloc(componentLength * 2);
  // r may have a leading zero byte for positive sign — skip it if longer than componentLength
  const rStart = r.length > componentLength ? r.length - componentLength : 0;
  const rDest = r.length >= componentLength ? 0 : componentLength - r.length;
  r.subarray(rStart).copy(raw, rDest);
  // Same for s
  const sStart = s.length > componentLength ? s.length - componentLength : 0;
  const sDest = s.length >= componentLength ? componentLength : componentLength + (componentLength - s.length);
  s.subarray(sStart).copy(raw, sDest);

  return raw.toString('base64url');
}
