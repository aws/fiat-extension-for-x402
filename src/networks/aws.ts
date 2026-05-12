/**
 * AWS-specific Agentic Pay scheme implementations
 * Pre-configured for AWS Agentic Pay with sensible defaults
 */

import { AgenticPayScheme as AgenticPayClientSchemeBase } from '../agentic-pay/client/scheme';
import { AgenticPayScheme as AgenticPayServerSchemeBase } from '../agentic-pay/server/scheme';
import { AgenticPayScheme as AgenticPayFacilitatorSchemeBase } from '../agentic-pay/facilitator/scheme';
import type { SigningKeysConfig } from '../config';

/**
 * AWS Agentic Pay base URL
 */
const AWS_AGENTIC_PAY_BASE_URL = 'https://pay.aws.amazon.com';

/**
 * AWS-specific Agentic Pay client scheme
 * Pre-configured for AWS Agentic Pay
 */
export class AgenticPayAWSClientScheme extends AgenticPayClientSchemeBase {
  /**
   * Create a new AWS Agentic Pay client scheme
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
 * AWS-specific Agentic Pay server scheme
 * Pre-configured for AWS Agentic Pay
 */
export class AgenticPayAWSServerScheme extends AgenticPayServerSchemeBase {
  /**
   * Create a new AWS Agentic Pay server scheme
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
 * AWS-specific Agentic Pay facilitator scheme
 * Pre-configured for AWS Agentic Pay
 */
export class AgenticPayAWSFacilitatorScheme extends AgenticPayFacilitatorSchemeBase {
  /**
   * Create a new AWS Agentic Pay facilitator scheme
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
