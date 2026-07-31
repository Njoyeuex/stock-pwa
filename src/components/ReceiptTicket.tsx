export interface ReceiptLine {
  name: string;
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

export function ReceiptTicket({ data }: { data: ReceiptData }) {
  return (
    <div id="receipt-ticket" className="mx-auto w-[80mm] bg-white p-3 font-mono text-xs text-black">
      <div className="text-center">
        <p className="text-sm font-bold">{data.orgName}</p>
        <p>
          {data.storeName}
          {data.storeCity ? ` • ${data.storeCity}` : ""}
        </p>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <p>{data.offline ? "Vente hors ligne — n° attribué après synchronisation" : `Ticket n° ${data.saleNumber}`}</p>
      <p>{new Date(data.createdAt).toLocaleString("fr-FR")}</p>
      <p>Caissier : {data.cashierName}</p>
      <p>Client : {data.customerName}</p>
      <div className="my-2 border-t border-dashed border-black" />
      {data.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between">
            <span>{l.name}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>
              {l.quantity} x {l.unit_price.toFixed(0)}
            </span>
            <span>{(l.quantity * l.unit_price).toFixed(0)}</span>
          </div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{data.total.toFixed(0)}</span>
      </div>
      <p>Paiement : {data.paymentMethodLabel}</p>
      <div className="my-2 border-t border-dashed border-black" />
      <p className="text-center">Merci de votre achat</p>
    </div>
  );
}
