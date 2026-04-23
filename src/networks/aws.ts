/**
 * AWS-specific FAB scheme implementations
 * Pre-configured for AWS Wallet with sensible defaults
 */

import { FABScheme as FABClientSchemeBase } from '../fab/client/scheme';
import { FABScheme as FABServerSchemeBase } from '../fab/server/scheme';
import { FABScheme as FABFacilitatorSchemeBase } from '../fab/facilitator/scheme';
import type { SigningKeysConfig } from '../config';

/**
 * AWS Wallet base URL
 */
const AWS_WALLET_BASE_URL = 'https://wallet.aws.com';

/**
 * AWS-specific FAB client scheme
 * Pre-configured for AWS Wallet
 */
export class FABAWSClientScheme extends FABClientSchemeBase {
  /**
   * Create a new AWS FAB client scheme
   * @param config - Client configuration with wallet ID
   */
  constructor(config: { walletId: string }) {
    super({
      walletId: config.walletId,
      wallet: {
        baseUrl: AWS_WALLET_BASE_URL
      }
    });
  }
}

/**
 * AWS-specific FAB server scheme
 * Pre-configured for AWS Wallet
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
      wallet: {
        baseUrl: AWS_WALLET_BASE_URL
      }
    });
  }
}

/**
 * AWS-specific FAB facilitator scheme
 * Pre-configured for AWS Wallet
 */
export class FABAWSFacilitatorScheme extends FABFacilitatorSchemeBase {
  /**
   * Create a new AWS FAB facilitator scheme
   * @param walletId - The wallet ID to use (defaults to 'aws-wallet')
   */
  constructor(walletId: string = 'aws-wallet') {
    super({
      walletId,
      wallet: {
        baseUrl: AWS_WALLET_BASE_URL
      }
    });
  }
}
