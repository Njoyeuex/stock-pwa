import { formatCurrency } from "../lib/currency";

export interface ReceiptLine {
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
}

export interface ReceiptData {
  orgName: string;
  storeName: string;
  storeCity: string | null;
  saleNumber: number;
  createdAt: string;
  cashierName: string;
  customerName: string;
  paymentMethodLabel: string;
  lines: ReceiptLine[];
  total: number;
  offline?: boolean;
}

const DOUBLE_RULE = "=".repeat(49);
const SINGLE_RULE = "-".repeat(49);

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("fr-FR");
  const time = d.toLocaleTimeString("fr-FR");
  return `${date} - ${time} (UTC+2)`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR");
}

export function ReceiptTicket({ data }: { data: ReceiptData }) {
  const transactionRef = data.offline
    ? "EN ATTENTE DE SYNCHRONISATION"
    : `#TRX-${String(data.saleNumber).padStart(6, "0")}`;
  const status = data.offline ? "EN ATTENTE DE SYNCHRONISATION" : "PAIEMENT CONFIRMÉ";
  const lockedAt = formatTime(data.createdAt);

  return (
    <div id="receipt-ticket" className="mx-auto w-[80mm] whitespace-pre-wrap break-words bg-white p-3 font-mono text-[11px] leading-relaxed text-black">
      <p className="text-center text-xs font-bold">{data.orgName}</p>
      <p className="text-center">
        {data.storeName}
        {data.storeCity ? ` • ${data.storeCity}` : ""}
      </p>
      <p className="text-center">Galerie ISHAKA, Avenue de l'Université n°69</p>
      <p className="text-center">NIF : 4001612615 — RC : 29052/21</p>
      <p className="text-center">Tél : +257 79078178 / 67300300</p>
      <p>{DOUBLE_RULE}</p>
      <p className="text-center font-bold">TICKET DE VENTE / REÇU</p>
      <p>{DOUBLE_RULE}</p>
      <p>Commande N° : {transactionRef}</p>
      <p>Date et Heure : {formatDateTime(data.createdAt)}</p>
      <p>Statut : {status}</p>
      <p></p>
      <p>{SINGLE_RULE}</p>
      <p>ARTICLES</p>
      <p>{SINGLE_RULE}</p>
      {data.lines.map((l, i) => (
        <div key={i}>
          <p>
            Produit : {l.name}
            {l.sku ? ` (SKU: ${l.sku})` : ""}
          </p>
          <p>Quantité : {l.quantity}</p>
          <p>
            Prix de vente appliqué : {formatCurrency(l.unit_price * l.quantity)} (verrouillé à {lockedAt})
          </p>
          {i < data.lines.length - 1 && <p></p>}
        </div>
      ))}
      <p>{SINGLE_RULE}</p>
      <p></p>
      <p>Client : {data.customerName}</p>
      <p>Moyen de paiement : {data.paymentMethodLabel}</p>
      <p></p>
      <p className="font-bold">TOTAL : {formatCurrency(data.total)}</p>
      <p>{DOUBLE_RULE}</p>
      <p>&gt; NOTE DE TRANSPARENCE :</p>
      <p>&gt; Ce prix de vente est ferme et définitif au moment</p>
      <p>&gt; du paiement. Les variations ultérieures du marché</p>
      <p>&gt; n'impactent pas cette transaction.</p>
      <p>{DOUBLE_RULE}</p>
      <p className="text-center">Merci de votre achat</p>
    </div>
  );
}
