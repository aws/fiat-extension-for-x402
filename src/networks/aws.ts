/**
 * AWS-specific FAB scheme implementations
 * Pre-configured for AWS Agentic Pay with sensible defaults
 */

import { FABScheme as FABClientSchemeBase } from '../fab/client/scheme';
import { FABScheme as FABServerSchemeBase } from '../fab/server/scheme';
import { FABScheme as FABFacilitatorSchemeBase } from '../fab/facilitator/scheme';
import type { SigningKeysConfig } from '../config';

/**
 * AWS Agentic Pay base URL
 */
const AWS_AGENTIC_PAY_BASE_URL = 'https://pay.aws.amazon.com';

/**
 * AWS-specific FAB client scheme
 * Pre-configured for AWS Agentic Pay
 */
export class FABAWSClientScheme extends FABClientSchemeBase {
  /**
   * Create a new AWS FAB client scheme
   * @param config - Client configuration with Agentic Pay ID
   */
  constructor(config: { agenticPayId: string }) {
    super({
      agenticPayId: config.agenticPayId,
      agenticPay: {
        baseUrl: AWS_AGENTIC_PAY_BASE_URL
      }
    });
  }
}

/**
 * AWS-specific FAB server scheme
 * Pre-configured for AWS Agentic Pay
 */
export class FABAWSServerScheme extends FABServerSchemeBase {
  /**
   * Create a new AWS FAB server scheme
   * @param config - Server configuration with signing keys
   */
  constructor(config: { signingKeys: SigningKeysConfig; serviceUrl: string }) {
    super({
      signingKeys: config.signingKeys,
      serviceUrl: config.serviceUrl,
      agenticPay: {
        baseUrl: AWS_AGENTIC_PAY_BASE_URL
      }
    });
  }
}

/**
 * AWS-specific FAB facilitator scheme
 * Pre-configured for AWS Agentic Pay
 */
export class FABAWSFacilitatorScheme extends FABFacilitatorSchemeBase {
  /**
   * Create a new AWS FAB facilitator scheme
   * @param agenticPayId - Agentic Pay ID to use (defaults to 'aws-agentic-pay')
   */
  constructor(agenticPayId: string = 'aws-agentic-pay') {
    super({
      agenticPayId,
      agenticPay: {
        baseUrl: AWS_AGENTIC_PAY_BASE_URL
      }
    });
  }
}
