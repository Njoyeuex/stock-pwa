import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  sku: string | null;
  name: string;
  sale_price: number;
  reorder_threshold: number;
  unit: string;
  image_path: string | null;
  quantity: number;
}

export interface CachedService {
  id: string;
  name: string;
  price: number;
}

export interface CachedCustomer {
  id: string;
  name: string;
}

export interface CachedSession {
  store_id: string;
  sessionId: string | null;
  openingFloat: number | null;
}

export interface PendingSaleLine {
  product_id?: string;
  service_id?: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
}

export type PendingSaleStatus = "pending" | "failed";

export interface PendingSale {
  localId?: number;
  clientRef: string;
  org_id: string;
  store_id: string;
  caisse_session_id: string | null;
  payment_method: "cash" | "credit" | "mixed";
  // Cash part of a mixed sale; the rest goes on the customer's credit.
  cash_amount?: number | null;
  customer_name: string | null;
  customer_id: string | null;
  lines: PendingSaleLine[];
  total_amount: number;
  created_at: string;
  status: PendingSaleStatus;
  error_message?: string;
}

// Client-side cache so the POS can keep selling during a network outage (products,
// services, customers, the open caisse session) plus the queue of sales made while
// offline, synced back to Postgres once the connection returns.
class OfflineDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  services!: Table<CachedService, string>;
  customers!: Table<CachedCustomer, string>;
  sessionCache!: Table<CachedSession, string>;
  pendingSales!: Table<PendingSale, number>;

  constructor() {
    super("manariyo-pos-offline");
    this.version(1).stores({
      products: "id, name",
      services: "id, name",
      customers: "id, name",
      sessionCache: "store_id",
      pendingSales: "++localId, clientRef, status, created_at",
    });
  }
}

export const offlineDb = new OfflineDatabase();
