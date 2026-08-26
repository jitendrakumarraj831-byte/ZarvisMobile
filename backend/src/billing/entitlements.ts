import type { AccountEntitlementSnapshot, PermissionType } from "../domain/types.js";
import type { EntitlementPort, PermissionPort, UsagePort } from "../tooling/ports.js";
import type { Store } from "../store/store.js";
import { randomUUID } from "node:crypto";

/** Backs [EntitlementPort] with the [Store] — see SUBSCRIPTIONS.md "Entitlement resolution". */
export class StoreEntitlementPort implements EntitlementPort {
  constructor(private readonly store: Store) {}

  async snapshot(accountId: string): Promise<AccountEntitlementSnapshot> {
    const account = await this.store.getAccount(accountId);
    if (!account) {
      throw new Error(`Unknown account '${accountId}'`);
    }
    const trial = await this.store.getTrial(accountId);
    const creditBalance = await this.store.getCreditBalance(accountId);
    return {
      accountId,
      plan: account.plan,
      trialExpiresAt: trial?.expiresAt ?? null,
      creditBalance,
    };
  }
}

export class StoreUsagePort implements UsagePort {
  constructor(private readonly store: Store) {}

  async charge(accountId: string, cost: { value: number; unit: string }, skillId: string): Promise<number> {
    return this.store.recordUsage({
      id: randomUUID(),
      accountId,
      skillId,
      cost: cost.value,
      createdAt: new Date(),
    });
  }
}

export class StorePermissionPort implements PermissionPort {
  constructor(private readonly store: Store) {}

  async isGranted(accountId: string, permission: PermissionType): Promise<boolean> {
    const granted = await this.store.grantedPermissions(accountId);
    return granted.has(permission);
  }
}
