export interface PlayPurchaseVerification {
  valid: boolean;
  planId?: string;
  orderId?: string;
}

export interface PlayBillingVerifier {
  verifyPurchaseToken(purchaseToken: string, productId: string): Promise<PlayPurchaseVerification>;
}

/**
 * No live Play Console listing exists for this repository yet (MASTER_SPEC.md §32), so
 * this mock accepts any non-empty token as a stand-in for the real Play Developer API
 * verification call. Swapping in a real verifier is additive — implement
 * [PlayBillingVerifier]; see SUBSCRIPTIONS.md "Billing integration point".
 */
export class MockPlayBillingVerifier implements PlayBillingVerifier {
  async verifyPurchaseToken(purchaseToken: string, productId: string): Promise<PlayPurchaseVerification> {
    if (!purchaseToken) {
      return { valid: false };
    }
    return { valid: true, planId: productId, orderId: `mock-order-${purchaseToken.slice(0, 8)}` };
  }
}
