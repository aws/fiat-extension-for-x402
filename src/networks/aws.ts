// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * AWS-specific Agent Pay scheme implementations
 * Pre-configured for AWS Agent Pay with sensible defaults
 */

import { AgentPayScheme as AgentPayClientSchemeBase } from '../agent-pay/client/scheme';
import { AgentPayScheme as AgentPayServerSchemeBase } from '../agent-pay/server/scheme';
import { AgentPayScheme as AgentPayFacilitatorSchemeBase } from '../agent-pay/facilitator/scheme';
import type { SigningKeysConfig } from '../config';

/**
 * AWS Agent Pay base URL
 */
const AWS_AGENT_PAY_BASE_URL = 'https://pay.aws.amazon.com';

/**
 * AWS-specific Agent Pay client scheme
 * Pre-configured for AWS Agent Pay
 */
export class AgentPayAWSClientScheme extends AgentPayClientSchemeBase {
  /**
   * Create a new AWS Agent Pay client scheme
   * @param config - Client configuration with Agent Pay ID
   */
  constructor(config: { agentPayId: string }) {
    super({
      agentPayId: config.agentPayId,
      agentPay: {
        baseUrl: AWS_AGENT_PAY_BASE_URL,
      },
    });
  }
}

/**
 * AWS-specific Agent Pay server scheme
 * Pre-configured for AWS Agent Pay
 */
export class AgentPayAWSServerScheme extends AgentPayServerSchemeBase {
  /**
   * Create a new AWS Agent Pay server scheme
   * @param config - Server configuration with signing keys
   */
  constructor(config: { signingKeys: SigningKeysConfig; serviceUrl: string }) {
    super({
      signingKeys: config.signingKeys,
      serviceUrl: config.serviceUrl,
      agentPay: {
        baseUrl: AWS_AGENT_PAY_BASE_URL,
      },
    });
  }
}

/**
 * AWS-specific Agent Pay facilitator scheme
 * Pre-configured for AWS Agent Pay
 */
export class AgentPayAWSFacilitatorScheme extends AgentPayFacilitatorSchemeBase {
  /**
   * Create a new AWS Agent Pay facilitator scheme
   * @param agentPayId - Agent Pay ID to use (defaults to 'aws-agent-pay')
   */
  constructor(agentPayId: string = 'aws-agent-pay') {
    super({
      agentPayId,
      agentPay: {
        baseUrl: AWS_AGENT_PAY_BASE_URL,
      },
    });
  }
}
