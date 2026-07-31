import { supabase } from "./supabaseClient";
import { offlineDb, type PendingSale } from "./offlineDb";

export async function queueOfflineSale(sale: Omit<PendingSale, "localId" | "status">) {
  await offlineDb.pendingSales.add({ ...sale, status: "pending" });
}

export async function getPendingSalesCount(): Promise<number> {
  return offlineDb.pendingSales.where("status").anyOf(["pending", "failed"]).count();
}

interface SyncResult {
  synced: number;
  failed: number;
}

// Replays queued offline sales against create_sale in the order they were made.
// Stops at the first failure (rather than skipping it) so a real, persistent problem
// doesn't silently reorder sales or bury an error under later, unrelated ones.
export async function syncPendingSales(): Promise<SyncResult> {
  const pending = await offlineDb.pendingSales
    .where("status")
    .anyOf(["pending", "failed"])
    .sortBy("created_at");

  let synced = 0;
  let failed = 0;

  for (const sale of pending) {
    const { error } = await supabase.rpc("create_sale", {
      p_org_id: sale.org_id,
      p_store_id: sale.store_id,
      p_lines: sale.lines.map((l) =>
        l.product_id
          ? { product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price }
          : { service_id: l.service_id, quantity: l.quantity, unit_price: l.unit_price },
      ),
      p_payment_method: sale.payment_method,
      p_caisse_session_id: sale.caisse_session_id ?? undefined,
      p_customer_name: sale.customer_name ?? undefined,
      p_customer_id: sale.customer_id ?? undefined,
    });

    if (error) {
      failed += 1;
      await offlineDb.pendingSales.update(sale.localId!, {
        status: "failed",
        error_message: error.message,
      });
      break;
    }

    synced += 1;
    await offlineDb.pendingSales.delete(sale.localId!);
  }

  return { synced, failed };
}
