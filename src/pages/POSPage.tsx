import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ShoppingCart,
  Package,
  Wrench,
  AlertTriangle,
  FileBarChart,
  Plus,
  Minus,
  X,
  Wallet,
  Lock,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { mapSupabaseError } from "../lib/errorMessages";
import { stockStatus } from "../lib/stockStatus";
import { formatCurrency } from "../lib/currency";
import { ROLE_LABELS } from "../lib/roles";
import { unitLabel, unitShort } from "../lib/units";
import { productPhotoUrl } from "../lib/productImages";
import { ErrorBox } from "../components/ErrorBox";
import { useAuth } from "../context/AuthContext";
import { ReceiptTicket, type ReceiptData } from "../components/ReceiptTicket";
import { offlineDb } from "../lib/offlineDb";
import { getPendingSalesCount, queueOfflineSale, syncPendingSales } from "../lib/offlineSync";
import type { Tables } from "../types/database.types";

type CaisseSession = Tables<"caisse_sessions">;
type Customer = Tables<"customers">;

type PaymentMethod = "cash" | "credit" | "mixed";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Espèces" },
  { value: "credit", label: "À crédit" },
  { value: "mixed", label: "Espèces + crédit" },
];

interface CatalogProduct {
  id: string;
  sku: string | null;
  name: string;
  sale_price: number;
  reorder_threshold: number;
  unit: string;
  image_path: string | null;
  quantity: number;
}

interface CatalogService {
  id: string;
  name: string;
  price: number;
}

interface SellableItem {
  kind: "product" | "service";
  id: string;
  sku: string | null;
  name: string;
  price: number;
  quantity: number | null;
  reorderThreshold: number | null;
  unit: string | null;
  imagePath: string | null;
}

// Units sold by a variable amount (not just whole pieces) get a quantity prompt
// instead of the default "click adds one" behavior.
const QUANTITY_PROMPT_UNITS = new Set(["litre", "cm"]);

interface CartLine {
  kind: "product" | "service";
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  unit_price: number;
  quantity: number;
}

const todayLabel = new Date().toLocaleDateString("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function POSPage() {
  const {
    currentOrgId,
    currentStoreId,
    storeName,
    storeCity,
    currentRole,
    profile,
    session: authSession,
  } = useAuth();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [customerName, setCustomerName] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [caisseSession, setCaisseSession] = useState<CaisseSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [openingFloat, setOpeningFloat] = useState("");
  const [lastClosingAmount, setLastClosingAmount] = useState<number | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [amountReceived, setAmountReceived] = useState("");
  const [showCashMovement, setShowCashMovement] = useState(false);
  const [cashMovementType, setCashMovementType] = useState<"in" | "out">("in");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closingCash, setClosingCash] = useState("");
  const [closeResult, setCloseResult] = useState<{ expected: number; variance: number } | null>(null);
  const [orgName, setOrgName] = useState("");
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [caisseBalance, setCaisseBalance] = useState<number | null>(null);
  const [quantityPromptItem, setQuantityPromptItem] = useState<SellableItem | null>(null);
  const [quantityPromptValue, setQuantityPromptValue] = useState("1");

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function refreshPendingCount() {
    setPendingCount(await getPendingSalesCount());
  }

  async function runSync() {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    const { synced, failed } = await syncPendingSales();
    await refreshPendingCount();
    setSyncing(false);
    if (synced > 0 || failed > 0) {
      setSyncMessage(
        failed > 0
          ? `${synced} vente(s) synchronisée(s), ${failed} en échec (nouvelle tentative plus tard).`
          : `${synced} vente(s) synchronisée(s).`,
      );
      await loadProducts();
    }
  }

  useEffect(() => {
    refreshPendingCount();
    if (navigator.onLine) runSync();

    function onOnline() {
      setIsOnline(true);
      runSync();
    }
    function onOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSession() {
    if (!currentStoreId) {
      setCaisseSession(null);
      setSessionLoading(false);
      return;
    }
    setSessionLoading(true);

    if (!navigator.onLine) {
      const cached = await offlineDb.sessionCache.get(currentStoreId);
      setCaisseSession(
        cached?.sessionId
          ? ({
              id: cached.sessionId,
              org_id: currentOrgId ?? "",
              store_id: currentStoreId,
              opened_by: "",
              opening_float: cached.openingFloat ?? 0,
              status: "open",
              opened_at: new Date().toISOString(),
              closed_at: null,
              closed_by: null,
              closing_declared_cash: null,
              expected_cash: null,
              variance: null,
            } as CaisseSession)
          : null,
      );
      setSessionLoading(false);
      return;
    }

    const { data } = await supabase
      .from("caisse_sessions")
      .select("*")
      .eq("store_id", currentStoreId)
      .eq("status", "open")
      .maybeSingle();
    setCaisseSession(data ?? null);
    await offlineDb.sessionCache.put({
      store_id: currentStoreId,
      sessionId: data?.id ?? null,
      openingFloat: data?.opening_float ?? null,
    });

    if (!data) {
      // Suggest picking up where the till was left last time, so the cashier only
      // has to confirm or adjust it rather than guess a starting amount from scratch.
      const { data: lastClosed } = await supabase
        .from("caisse_sessions")
        .select("closing_declared_cash")
        .eq("store_id", currentStoreId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const amount = lastClosed?.closing_declared_cash ?? null;
      setLastClosingAmount(amount);
      setOpeningFloat(amount !== null ? String(amount) : "");
    } else {
      setLastClosingAmount(null);
    }

    setSessionLoading(false);
  }

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreId]);

  // Live cash-on-hand for the open session = opening float + cash sales + cash in - cash out.
  async function loadCaisseBalance(sessionId: string | undefined | null) {
    if (!sessionId || !navigator.onLine) {
      setCaisseBalance(null);
      return;
    }
    const { data: session } = await supabase
      .from("caisse_sessions")
      .select("opening_float")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) {
      setCaisseBalance(null);
      return;
    }
    const [{ data: cashPayments }, { data: sessionMovements }] = await Promise.all([
      supabase
        .from("payments")
        .select("amount, sales!inner(caisse_session_id, status)")
        .eq("method", "cash")
        .eq("sales.caisse_session_id", sessionId)
        .eq("sales.status", "completed"),
      supabase.from("cash_movements").select("type, amount").eq("caisse_session_id", sessionId),
    ]);
    const cashSales = ((cashPayments as unknown as { amount: number }[]) ?? []).reduce((s, p) => s + p.amount, 0);
    const mvIn = (sessionMovements ?? []).filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
    const mvOut = (sessionMovements ?? []).filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);
    setCaisseBalance(session.opening_float + cashSales + mvIn - mvOut);
  }

  useEffect(() => {
    if (caisseSession) {
      loadCaisseBalance(caisseSession.id);
    } else {
      setCaisseBalance(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caisseSession?.id]);

  async function openSession() {
    if (!currentOrgId || !currentStoreId) return;
    const float = Number(openingFloat);
    if (Number.isNaN(float) || float < 0) {
      setSessionError("Montant invalide.");
      return;
    }
    setSessionError(null);
    const { error } = await supabase.rpc("open_caisse_session", {
      p_org_id: currentOrgId,
      p_store_id: currentStoreId,
      p_opening_float: float,
    });
    if (error) {
      setSessionError(mapSupabaseError(error));
      return;
    }
    setOpeningFloat("");
    await loadSession();
  }

  async function submitCashMovement() {
    if (!caisseSession) return;
    const amount = Number(cashMovementAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setSessionError("Montant invalide.");
      return;
    }
    setSessionError(null);
    const { error } = await supabase.rpc("record_cash_movement", {
      p_session_id: caisseSession.id,
      p_type: cashMovementType,
      p_amount: amount,
      p_reason: cashMovementReason || undefined,
    });
    if (error) {
      setSessionError(mapSupabaseError(error));
      return;
    }
    setCashMovementAmount("");
    setCashMovementReason("");
    setShowCashMovement(false);
    await loadCaisseBalance(caisseSession.id);
  }

  async function submitCloseSession() {
    if (!caisseSession) return;
    const declared = Number(closingCash);
    if (Number.isNaN(declared) || declared < 0) {
      setSessionError("Montant invalide.");
      return;
    }
    setSessionError(null);
    const { error } = await supabase.rpc("close_caisse_session", {
      p_session_id: caisseSession.id,
      p_closing_declared_cash: declared,
    });
    if (error) {
      setSessionError(mapSupabaseError(error));
      return;
    }
    const { data: closed } = await supabase
      .from("caisse_sessions")
      .select("expected_cash, variance")
      .eq("id", caisseSession.id)
      .maybeSingle();
    setCloseResult({ expected: closed?.expected_cash ?? 0, variance: closed?.variance ?? 0 });
    setClosingCash("");
    setShowCloseForm(false);
    setCaisseBalance(null);
    await loadSession();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    async function loadOrgName() {
      if (!currentOrgId) return;
      const { data } = await supabase.from("organizations").select("name").eq("id", currentOrgId).maybeSingle();
      setOrgName(data?.name ?? "");
    }
    loadOrgName();
  }, [currentOrgId]);

  async function loadCustomers() {
    if (!currentOrgId) return;

    if (!navigator.onLine) {
      const cached = await offlineDb.customers.toArray();
      setCustomers(cached.map((c) => ({ id: c.id, name: c.name, org_id: currentOrgId, phone: null, is_active: true, created_at: "" })));
      return;
    }

    const { data } = await supabase.from("customers").select("*").eq("org_id", currentOrgId).order("name");
    setCustomers(data ?? []);
    if (data) await offlineDb.customers.bulkPut(data.map((c) => ({ id: c.id, name: c.name })));
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function loadServices() {
    if (!currentOrgId) return;

    if (!navigator.onLine) {
      const cached = await offlineDb.services.toArray();
      setServices(cached);
      return;
    }

    const { data } = await supabase
      .from("services")
      .select("id, name, price")
      .eq("org_id", currentOrgId)
      .eq("is_active", true)
      .order("name");
    setServices(data ?? []);
    if (data) await offlineDb.services.bulkPut(data);
  }

  useEffect(() => {
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId]);

  async function loadProducts() {
    if (!currentOrgId || !currentStoreId) {
      setProducts([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    if (!navigator.onLine) {
      const cached = await offlineDb.products.toArray();
      setProducts(cached);
      setLoading(false);
      return;
    }

    const [{ data: productsData }, { data: stockData }] = await Promise.all([
      supabase
        .from("products")
        .select("id, sku, name, sale_price, reorder_threshold, unit, image_path")
        .eq("org_id", currentOrgId)
        .eq("is_active", true)
        .order("name"),
      supabase.from("product_stock").select("product_id, quantity").eq("store_id", currentStoreId),
    ]);

    const qtyByProduct = new Map((stockData ?? []).map((s) => [s.product_id, s.quantity]));

    const merged = (productsData ?? []).map((p) => ({
      ...p,
      quantity: qtyByProduct.get(p.id) ?? 0,
    }));
    setProducts(merged);
    await offlineDb.products.bulkPut(merged);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrgId, currentStoreId]);

  const catalogItems = useMemo<SellableItem[]>(
    () => [
      ...products.map((p) => ({
        kind: "product" as const,
        id: p.id,
        sku: p.sku,
        name: p.name,
        price: p.sale_price,
        quantity: p.quantity,
        reorderThreshold: p.reorder_threshold,
        unit: p.unit,
        imagePath: p.image_path,
      })),
      ...services.map((s) => ({
        kind: "service" as const,
        id: s.id,
        sku: null,
        name: s.name,
        price: s.price,
        quantity: null,
        reorderThreshold: null,
        unit: null,
        imagePath: null,
      })),
    ],
    [products, services],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogItems;
    return catalogItems.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
    );
  }, [catalogItems, search]);

  const total = useMemo(() => cart.reduce((sum, l) => sum + l.unit_price * l.quantity, 0), [cart]);

  const [catalogError, setCatalogError] = useState<string | null>(null);

  function cartQuantityFor(kind: "product" | "service", id: string) {
    return cart.find((l) => l.kind === kind && l.id === id)?.quantity ?? 0;
  }

  function addToCart(item: SellableItem) {
    setCatalogError(null);

    if (item.kind === "product" && item.unit && QUANTITY_PROMPT_UNITS.has(item.unit)) {
      setQuantityPromptItem(item);
      setQuantityPromptValue("1");
      return;
    }

    if (item.kind === "product") {
      const nextQty = cartQuantityFor(item.kind, item.id) + 1;
      if (nextQty > (item.quantity ?? 0)) {
        setCatalogError(
          `Quantité insuffisante en stock pour "${item.name}" : disponible ${item.quantity ?? 0}, demandé ${nextQty}.`,
        );
        return;
      }
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.kind === item.kind && l.id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.kind === item.kind && l.id === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          kind: item.kind,
          id: item.id,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          unit_price: item.price,
          quantity: 1,
        },
      ];
    });
  }

  function confirmQuantityPrompt() {
    if (!quantityPromptItem) return;
    const qty = Number(quantityPromptValue);
    if (Number.isNaN(qty) || qty <= 0) {
      setCatalogError("Quantité invalide.");
      return;
    }
    const nextQty = cartQuantityFor(quantityPromptItem.kind, quantityPromptItem.id) + qty;
    if (nextQty > (quantityPromptItem.quantity ?? 0)) {
      setCatalogError(
        `Quantité insuffisante en stock pour "${quantityPromptItem.name}" : disponible ${quantityPromptItem.quantity ?? 0}, demandé ${nextQty}.`,
      );
      return;
    }
    setCatalogError(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.kind === quantityPromptItem.kind && l.id === quantityPromptItem.id);
      if (existing) {
        return prev.map((l) =>
          l.kind === quantityPromptItem.kind && l.id === quantityPromptItem.id
            ? { ...l, quantity: l.quantity + qty }
            : l,
        );
      }
      return [
        ...prev,
        {
          kind: quantityPromptItem.kind,
          id: quantityPromptItem.id,
          name: quantityPromptItem.name,
          sku: quantityPromptItem.sku,
          unit: quantityPromptItem.unit,
          unit_price: quantityPromptItem.price,
          quantity: qty,
        },
      ];
    });
    setQuantityPromptItem(null);
    setQuantityPromptValue("1");
  }

  function updateQuantity(kind: "product" | "service", id: string, delta: number) {
    if (delta > 0 && kind === "product") {
      const product = products.find((p) => p.id === id);
      const nextQty = cartQuantityFor(kind, id) + delta;
      if (product && nextQty > product.quantity) {
        setCatalogError(`Quantité insuffisante en stock pour "${product.name}" : disponible ${product.quantity}.`);
        return;
      }
    }
    setCatalogError(null);
    setCart((prev) =>
      prev
        .map((l) => (l.kind === kind && l.id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  // Lets the cashier adjust the price on the spot to close a negotiated sale -
  // whatever is entered here is the price the sale is actually recorded at.
  function updateUnitPrice(kind: "product" | "service", id: string, value: string) {
    const price = Number(value);
    setCart((prev) =>
      prev.map((l) =>
        l.kind === kind && l.id === id ? { ...l, unit_price: Number.isNaN(price) ? 0 : Math.max(0, price) } : l,
      ),
    );
  }

  function removeFromCart(kind: "product" | "service", id: string) {
    setCart((prev) => prev.filter((l) => !(l.kind === kind && l.id === id)));
  }

  async function finalizeSale() {
    if (!currentOrgId || !currentStoreId || cart.length === 0) return;
    const usesCredit = paymentMethod === "credit" || paymentMethod === "mixed";
    const usesCash = paymentMethod === "cash" || paymentMethod === "mixed";
    const cashPart = paymentMethod === "mixed" ? Number(amountReceived) : paymentMethod === "cash" ? total : 0;
    if (usesCredit && !selectedCustomerId) {
      setErrorMessage("Choisissez un client pour une vente à crédit.");
      return;
    }
    if (usesCash && !caisseSession) {
      setErrorMessage("Ouvrez la caisse avant d'encaisser une vente en espèces.");
      return;
    }
    if (paymentMethod === "mixed" && !(cashPart > 0 && cashPart < total)) {
      setErrorMessage("La partie en espèces doit être supérieure à 0 et inférieure au total.");
      return;
    }
    const paymentLabel =
      paymentMethod === "mixed"
        ? `Espèces ${formatCurrency(cashPart)} + crédit ${formatCurrency(total - cashPart)}`
        : (PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? paymentMethod);
    for (const line of cart) {
      if (line.kind !== "product") continue;
      const product = products.find((p) => p.id === line.id);
      if (product && line.quantity > product.quantity) {
        setErrorMessage(
          `Quantité insuffisante en stock pour "${line.name}" : disponible ${product.quantity}, demandé ${line.quantity}.`,
        );
        return;
      }
    }
    setErrorMessage(null);
    setSubmitting(true);

    const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
    let saleId: string | null = null;
    let wentOffline = !navigator.onLine;

    if (!wentOffline) {
      try {
        const { data, error } = await supabase.rpc("create_sale", {
          p_org_id: currentOrgId,
          p_store_id: currentStoreId,
          p_lines: cart.map((l) =>
            l.kind === "product"
              ? { product_id: l.id, quantity: l.quantity, unit_price: l.unit_price }
              : { service_id: l.id, quantity: l.quantity, unit_price: l.unit_price },
          ),
          p_payment_method: paymentMethod,
          p_caisse_session_id: caisseSession?.id,
          p_customer_name: customerName || undefined,
          p_customer_id: usesCredit ? selectedCustomerId : undefined,
          p_cash_amount: paymentMethod === "mixed" ? cashPart : undefined,
        });

        if (error) {
          setSubmitting(false);
          setErrorMessage(mapSupabaseError(error));
          return;
        }
        saleId = data;
      } catch {
        // A network failure mid-request (as opposed to a rejected RPC) is treated the
        // same as being offline: the sale is queued instead of lost.
        wentOffline = true;
      }
    }

    if (wentOffline) {
      await queueOfflineSale({
        clientRef: crypto.randomUUID(),
        org_id: currentOrgId,
        store_id: currentStoreId,
        caisse_session_id: caisseSession?.id ?? null,
        payment_method: paymentMethod,
        cash_amount: paymentMethod === "mixed" ? cashPart : null,
        customer_name: customerName || null,
        customer_id: usesCredit ? selectedCustomerId : null,
        lines: cart.map((l) => ({
          product_id: l.kind === "product" ? l.id : undefined,
          service_id: l.kind === "service" ? l.id : undefined,
          name: l.name,
          sku: l.sku,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        total_amount: total,
        created_at: new Date().toISOString(),
      });
      await refreshPendingCount();
      if (usesCash) {
        setCaisseBalance((prev) => (prev !== null ? prev + cashPart : prev));
      }

      setLastReceipt({
        orgName,
        customerName: customerName || selectedCustomer?.name || "Client comptant",
        storeName: storeName ?? "",
        storeCity: storeCity,
        saleNumber: 0,
        createdAt: new Date().toISOString(),
        cashierName,
        paymentMethodLabel: paymentLabel,
        lines: cart.map((l) => ({ name: l.name, sku: l.sku, quantity: l.quantity, unit_price: l.unit_price })),
        total,
        offline: true,
      });
    } else if (saleId) {
      const { data: saleRow } = await supabase
        .from("sales")
        .select("sale_number, created_at, total_amount, customer_name")
        .eq("id", saleId)
        .maybeSingle();

      if (usesCash && caisseSession) {
        await loadCaisseBalance(caisseSession.id);
      }

      setLastReceipt({
        orgName,
        customerName: saleRow?.customer_name || selectedCustomer?.name || "Client comptant",
        storeName: storeName ?? "",
        storeCity: storeCity,
        saleNumber: saleRow?.sale_number ?? 0,
        createdAt: saleRow?.created_at ?? new Date().toISOString(),
        cashierName,
        paymentMethodLabel: paymentLabel,
        lines: cart.map((l) => ({ name: l.name, sku: l.sku, quantity: l.quantity, unit_price: l.unit_price })),
        total: saleRow?.total_amount ?? total,
      });
    }

    // A service is single-use: once sold, it disappears from the catalog until
    // someone re-adds it from the Services page.
    const usedServiceIds = cart.filter((l) => l.kind === "service").map((l) => l.id);
    if (usedServiceIds.length > 0) {
      await supabase.from("services").update({ is_active: false }).in("id", usedServiceIds);
      setServices((prev) => prev.filter((s) => !usedServiceIds.includes(s.id)));
    }

    setSubmitting(false);
    setCart([]);
    setPaymentMethod("cash");
    setCustomerName("");
    setSelectedCustomerId("");
    setAmountReceived("");
    setProducts((prev) =>
      prev.map((p) => {
        const line = cart.find((l) => l.kind === "product" && l.id === p.id);
        return line ? { ...p, quantity: p.quantity - line.quantity } : p;
      }),
    );
  }

  const cashierName = profile?.full_name || authSession?.user.email || "";
  const roleLabel = currentRole ? ROLE_LABELS[currentRole] : "";

  return (
    <div className="-m-8 flex min-h-screen flex-col bg-gray-100 text-gray-900">
      <header className="flex flex-col gap-3 bg-blue-900 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Caisse - Point de Vente</h1>
          <p className="text-sm text-blue-200">
            {storeName ? `${storeName}${storeCity ? ` • ${storeCity}` : ""}` : "Chargement du magasin..."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
          <div
            className={`flex items-center gap-2 rounded-lg bg-[length:200%_200%] px-3 py-2 shadow-md ${
              caisseBalance !== null
                ? "animate-caisse-glow bg-gradient-to-r from-blue-600 via-sky-400 to-blue-600"
                : "bg-white/10"
            }`}
          >
            <Wallet size={16} className="text-white" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-blue-100">Argent en caisse</p>
              <p className="text-sm font-bold text-white">
                {caisseBalance !== null ? formatCurrency(caisseBalance) : "Caisse fermée"}
              </p>
            </div>
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-medium">
              {roleLabel}
              {roleLabel && cashierName ? ": " : ""}
              {cashierName}
            </p>
            <p className="capitalize text-blue-200">{todayLabel}</p>
          </div>
          <Link
            to="/reports"
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25"
          >
            <FileBarChart size={16} />
            Rapport
          </Link>
        </div>
      </header>

      {(!isOnline || pendingCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-8">
          <div className="flex items-center gap-2">
            {!isOnline && (
              <span className="flex items-center gap-1.5">
                <WifiOff size={16} />
                Hors ligne — les ventes sont enregistrées localement.
              </span>
            )}
            {pendingCount > 0 && (
              <span className={!isOnline ? "border-l border-amber-300 pl-2" : ""}>
                {pendingCount} vente(s) en attente de synchronisation
              </span>
            )}
          </div>
          {isOnline && pendingCount > 0 && (
            <button
              onClick={runSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Synchronisation..." : "Synchroniser maintenant"}
            </button>
          )}
        </div>
      )}
      {syncMessage && (
        <div className="flex items-center justify-between bg-emerald-50 px-4 py-2 text-sm text-emerald-700 sm:px-8">
          <span>{syncMessage}</span>
          <button onClick={() => setSyncMessage(null)} className="text-emerald-600 hover:text-emerald-900">
            <X size={14} />
          </button>
        </div>
      )}

      {!sessionLoading && currentStoreId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-8">
          {caisseSession ? (
            <>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Wallet size={16} className="text-emerald-600" />
                Caisse ouverte — fonds initial : {formatCurrency(caisseSession.opening_float)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCashMovement(true)}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
                >
                  Mouvement de caisse
                </button>
                <button
                  onClick={() => setShowCloseForm(true)}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
                >
                  Fermer la caisse
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Lock size={16} />
              Caisse fermée — ouvrez-la ci-dessous pour commencer à vendre.
            </div>
          )}
        </div>
      )}

      {sessionError && (
        <div className="px-4 pt-2 sm:px-8">
          <ErrorBox message={sessionError} onDismiss={() => setSessionError(null)} />
        </div>
      )}

      {closeResult && (
        <div className="flex items-center justify-between bg-white px-4 py-3 text-sm sm:px-8">
          <span>
            Caisse fermée — attendu : {formatCurrency(closeResult.expected)}, écart :{" "}
            <span className={closeResult.variance === 0 ? "text-emerald-600" : "text-amber-600"}>
              {closeResult.variance > 0 ? "+" : ""}
              {formatCurrency(closeResult.variance)}
            </span>
          </span>
          <button onClick={() => setCloseResult(null)} className="text-gray-400 hover:text-gray-900">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6 p-4 lg:flex-row lg:p-8">
        {currentStoreId && !sessionLoading && !caisseSession ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-sm">
              <Lock size={32} className="mx-auto mb-3 text-gray-300" />
              <h2 className="mb-1 text-lg font-semibold text-gray-900">Ouvrez la caisse pour commencer</h2>
              <p className="mb-4 text-sm text-gray-500">
                Aucune vente ne peut être enregistrée tant que la caisse n'est pas ouverte.
              </p>
              <div className="mb-4 rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">Montant actuellement en caisse</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(lastClosingAmount ?? 0)}</p>
                {lastClosingAmount !== null && (
                  <p className="mt-1 text-xs text-gray-400">
                    D'après la dernière clôture. Gardez ce montant ou ajustez-le ci-dessous si vous ajoutez des
                    espèces.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <input
                  type="number"
                  step="0.01"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  placeholder="Fonds initial"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-sm"
                />
                {sessionError && <ErrorBox message={sessionError} onDismiss={() => setSessionError(null)} />}
                <button
                  onClick={openSession}
                  className="w-full animate-pulse rounded-md bg-red-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/40 hover:bg-red-700"
                >
                  Ouvrir la caisse
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un produit ou un service... (F2 pour focus)"
                  className="w-full rounded-md border border-gray-300 bg-white py-3 pl-10 pr-14 text-sm"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-400">
                  F2
                </kbd>
              </div>

              {catalogError && <ErrorBox message={catalogError} onDismiss={() => setCatalogError(null)} />}

              {loading ? (
                <p className="text-sm text-gray-500">Chargement...</p>
              ) : filteredItems.length === 0 ? (
                <p className="text-sm text-gray-500">Aucun article trouvé.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {filteredItems.map((item) => {
                    const low =
                      item.kind === "product" && stockStatus(item.quantity ?? 0) !== "ok";
                    const photoUrl = item.kind === "product" ? productPhotoUrl(item.imagePath) : null;
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        onClick={() => addToCart(item)}
                        style={
                          photoUrl
                            ? { backgroundImage: `url(${photoUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                            : undefined
                        }
                        className={`relative overflow-hidden rounded-xl border p-4 text-left transition-colors ${
                          photoUrl
                            ? "border-gray-300"
                            : low
                              ? "border-amber-400 bg-amber-50 hover:bg-amber-100"
                              : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        {photoUrl && <div className="absolute inset-0 bg-black/55" />}
                        <div className="relative">
                          {low && (
                            <AlertTriangle
                              size={16}
                              className={`absolute right-0 top-0 ${photoUrl ? "text-amber-400" : "text-amber-500"}`}
                            />
                          )}
                          {!photoUrl &&
                            (item.kind === "service" ? (
                              <Wrench size={22} className="mb-3 text-blue-800" />
                            ) : (
                              <Package size={22} className="mb-3 text-blue-800" />
                            ))}
                          <p className={`text-sm font-semibold ${photoUrl ? "text-white drop-shadow" : "text-gray-900"}`}>
                            {item.name}
                          </p>
                          <p className={`mb-2 text-xs ${photoUrl ? "text-gray-200" : "text-gray-500"}`}>
                            {item.sku ?? (item.kind === "service" ? "Service" : "—")}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className={`font-semibold ${photoUrl ? "text-white drop-shadow" : "text-red-600"}`}>
                              {formatCurrency(item.price)}
                            </span>
                            {item.kind === "product" && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  low ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                Stock: {item.quantity} {unitShort(item.unit)}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="w-full overflow-hidden rounded-xl bg-white shadow-sm lg:w-80 lg:shrink-0">
              <div className="flex items-center gap-2 bg-blue-900 px-4 py-3 font-medium text-white">
                <ShoppingCart size={18} />
                Article à vendre
              </div>

              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                  <ShoppingCart size={40} className="text-gray-200" />
                  <p className="text-gray-600">Aucun article à vendre</p>
                  <p className="text-xs text-gray-400">Cliquez sur un produit ou un service pour l'ajouter</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  <div className="max-h-[50vh] space-y-3 overflow-y-auto p-4">
                    {cart.map((l) => (
                      <div key={`${l.kind}-${l.id}`} className="rounded-lg bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{l.name}</p>
                            <p className="text-xs text-gray-500">
                              {l.sku ?? (l.kind === "service" ? "Service" : "—")}
                            </p>
                          </div>
                          <button
                            onClick={() => removeFromCart(l.kind, l.id)}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateQuantity(l.kind, l.id, -1)}
                              className="rounded bg-gray-200 p-1 text-gray-700 hover:bg-gray-300"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="min-w-6 text-center text-sm text-gray-900">
                              {l.quantity}
                              {l.unit && <span className="ml-0.5 text-xs text-gray-400">{unitShort(l.unit)}</span>}
                            </span>
                            <button
                              onClick={() => updateQuantity(l.kind, l.id, 1)}
                              className="rounded bg-gray-200 p-1 text-gray-700 hover:bg-gray-300"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          <span className="text-sm font-medium text-red-600">
                            {formatCurrency(l.unit_price * l.quantity)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <label className="whitespace-nowrap text-xs text-gray-500">Prix négocié</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={l.unit_price}
                            onChange={(e) => updateUnitPrice(l.kind, l.id, e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 border-t border-gray-200 p-4">
                    {paymentMethod === "credit" || paymentMethod === "mixed" ? (
                      <select
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">Choisir un client...</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Nom du client (optionnel)"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    )}
                    <div className="grid grid-cols-3 gap-1.5">
                      {PAYMENT_METHODS.map((m) => {
                        const disabled = m.value !== "credit" && !caisseSession;
                        return (
                          <button
                            key={m.value}
                            onClick={() => setPaymentMethod(m.value)}
                            disabled={disabled}
                            title={disabled ? "Ouvrez la caisse pour encaisser en espèces." : undefined}
                            className={`rounded-md py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                              paymentMethod === m.value
                                ? "bg-blue-900 text-white"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                    {paymentMethod === "cash" && (
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">Montant reçu du client</label>
                        <input
                          type="number"
                          step="0.01"
                          value={amountReceived}
                          onChange={(e) => setAmountReceived(e.target.value)}
                          placeholder="Montant payé"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                        {amountReceived !== "" &&
                          (Number(amountReceived) >= total ? (
                            <p className="text-xs text-emerald-600">
                              Monnaie à rendre : {formatCurrency(Number(amountReceived) - total)}
                            </p>
                          ) : (
                            <p className="text-xs text-red-600">
                              Montant insuffisant (manque {formatCurrency(total - Number(amountReceived))})
                            </p>
                          ))}
                      </div>
                    )}
                    {paymentMethod === "mixed" && (
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">Partie payée en espèces</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={amountReceived}
                          onChange={(e) => setAmountReceived(e.target.value)}
                          placeholder="Montant en espèces"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                        {amountReceived !== "" &&
                          (Number(amountReceived) > 0 && Number(amountReceived) < total ? (
                            <p className="text-xs text-amber-600">
                              Reste à crédit : {formatCurrency(total - Number(amountReceived))}
                            </p>
                          ) : (
                            <p className="text-xs text-red-600">
                              La partie en espèces doit être entre 0 et {formatCurrency(total)}.
                            </p>
                          ))}
                      </div>
                    )}
                    {errorMessage && <ErrorBox message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
                    <div className="flex items-center justify-between text-lg font-semibold text-gray-900">
                      <span>Total</span>
                      <span className="text-red-600">{formatCurrency(total)}</span>
                    </div>
                    <button
                      onClick={finalizeSale}
                      disabled={
                        submitting ||
                        (paymentMethod === "cash" && (amountReceived === "" || Number(amountReceived) < total)) ||
                        (paymentMethod === "mixed" &&
                          !(Number(amountReceived) > 0 && Number(amountReceived) < total))
                      }
                      className="w-full rounded-md bg-red-600 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {submitting ? "Traitement..." : "Enregistrer la vente"}
                    </button>
                    <p className="text-center text-xs text-gray-400">
                      L'impression du ticket est facultative et se fait après l'enregistrement.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {quantityPromptItem && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">Quantité à vendre</h2>
              <button
                onClick={() => setQuantityPromptItem(null)}
                className="text-gray-400 hover:text-gray-900"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              {quantityPromptItem.name} — unité : {unitLabel(quantityPromptItem.unit)}
            </p>
            <input
              type="number"
              step="0.001"
              min="0"
              autoFocus
              value={quantityPromptValue}
              onChange={(e) => setQuantityPromptValue(e.target.value)}
              placeholder={`Quantité en ${unitLabel(quantityPromptItem.unit)}`}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-lg"
            />
            <p className="text-xs text-gray-400">
              Disponible en stock : {quantityPromptItem.quantity ?? 0} {unitShort(quantityPromptItem.unit)}
            </p>
            {catalogError && <ErrorBox message={catalogError} onDismiss={() => setCatalogError(null)} />}
            <button
              onClick={confirmQuantityPrompt}
              className="w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Ajouter au panier
            </button>
          </div>
        </div>
      )}

      {showCashMovement && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">Mouvement de caisse</h2>
              <button onClick={() => setShowCashMovement(false)} className="text-gray-400 hover:text-gray-900">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCashMovementType("in")}
                className={`rounded-md py-2 text-sm font-medium ${
                  cashMovementType === "in" ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                Entrée
              </button>
              <button
                onClick={() => setCashMovementType("out")}
                className={`rounded-md py-2 text-sm font-medium ${
                  cashMovementType === "out" ? "bg-blue-900 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                Sortie
              </button>
            </div>
            <input
              type="number"
              step="0.01"
              value={cashMovementAmount}
              onChange={(e) => setCashMovementAmount(e.target.value)}
              placeholder="Montant"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={cashMovementReason}
              onChange={(e) => setCashMovementReason(e.target.value)}
              placeholder="Motif (optionnel)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {sessionError && <ErrorBox message={sessionError} onDismiss={() => setSessionError(null)} />}
            <button
              onClick={submitCashMovement}
              className="w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {lastReceipt && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0">
          <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-6 print:m-0 print:max-h-none print:w-auto print:overflow-visible print:rounded-none print:bg-transparent print:p-0">
            <div className="flex items-center justify-between print:hidden">
              <h2 className="font-medium text-gray-900">Vente enregistrée</h2>
              <button onClick={() => setLastReceipt(null)} className="text-gray-400 hover:text-gray-900">
                <X size={16} />
              </button>
            </div>
            <ReceiptTicket data={lastReceipt} />
            <div className="flex gap-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Imprimer le ticket
              </button>
              <button
                onClick={() => setLastReceipt(null)}
                className="flex-1 rounded-md bg-gray-100 py-2 text-sm text-gray-700 hover:bg-gray-200"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloseForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-900">Fermer la caisse</h2>
              <button onClick={() => setShowCloseForm(false)} className="text-gray-400 hover:text-gray-900">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-500">Comptez le tiroir-caisse et indiquez le montant total en espèces.</p>
            <input
              type="number"
              step="0.01"
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
              placeholder="Espèces comptées"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {sessionError && <ErrorBox message={sessionError} onDismiss={() => setSessionError(null)} />}
            <button
              onClick={submitCloseSession}
              className="w-full rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Confirmer la fermeture
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
