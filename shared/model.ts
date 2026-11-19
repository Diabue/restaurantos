export type Role = 'WAITER' | 'KITCHEN' | 'MANAGER';
export type OrderStatus = 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'REJECTED' | 'CANCELED';
export type ReceiptStatus = 'PREPARED' | 'SENDING' | 'UNKNOWN' | 'ISSUED' | 'FAILED';
export type Option = { id: string; name: string; extra: number };
export type PrepStation = 'KITCHEN' | 'BAR';
export const stationLabel: Record<PrepStation, string> = { KITCHEN: 'Kuchnia', BAR: 'Bar' };
export type LineChange = {
  id: string; at: string; reason: string;
  previousQuantity: number; quantity: number; previousNote: string; note: string;
};
export type Product = {
  id: string; categoryId: string; name: string; description: string; image: string; price: number;
  available: boolean; options: Option[]; fiscalCode: string; vatCode: string; station: PrepStation;
};
export type Category = { id: string; name: string; position: number; products: Product[] };
export type Line = {
  key: string; productId: string; name: string; optionId?: string; option?: string; note: string;
  price: number; quantity: number; fiscalCode: string; vatCode: string; canceled?: string;
  station?: PrepStation; startedAt?: string; readyAt?: string; canceledAt?: string; changes?: LineChange[];
};
export type Order = { id: string; status: OrderStatus; lines: Line[]; source: string; reason?: string; createdAt: string };
export type Receipt = { id: string; status: ReceiptStatus; method: 'CASH' | 'CARD'; total: number; reference?: string; settledAt?: string };
export const callReasons = ['HELP', 'BILL', 'ORDER'] as const;
export type CallReason = typeof callReasons[number];
export const callReasonLabel: Record<CallReason, string> = {
  HELP: 'Pomoc przy stoliku', BILL: 'Prośba o rachunek', ORDER: 'Pytanie o zamówienie',
};
export type ServiceCall = { id: string; reason: CallReason; createdAt: string; resolvedAt?: string };
export type Visit = { id: string; pin: string | null; orders: Order[]; calls: ServiceCall[]; receipts: Receipt[]; cart: Line[]; total: number };
export type Table = { id: string; code: string; number: number; seats: number; x: number; y: number; visit?: Visit };
export type Restaurant = { slug: string; name: string; tagline: string; image: string; logo: string; kitchenAlertMinutes?: number };
export type Employee = { id: string; username: string; name: string; roles: Role[]; active: boolean; canFiscalize: boolean };
export type Menu = { restaurant: Restaurant; table: { number: number; pinConfigured: boolean }; categories: Category[] };
export type TableTransfer = {
  request: string; fromId: string; toId: string; fromNumber: number; toNumber: number;
  employeeId: string; employeeName: string; at: string;
};
export type GuestState = { table?: { code: string; number: number }; cart: Line[]; orders: Order[]; call?: ServiceCall; total: number };

export const statusLabel: Record<OrderStatus, string> = {
  PENDING: 'Czeka na potwierdzenie kelnera', ACCEPTED: 'Przyjęte przez kuchnię', PREPARING: 'W przygotowaniu',
  READY: 'Gotowe', SERVED: 'Podane', REJECTED: 'Odrzucone', CANCELED: 'Anulowane',
};
export const roleLabel: Record<Role, string> = { WAITER: 'Kelner', KITCHEN: 'Kuchnia', MANAGER: 'Manager' };
export const lineTotal = (lines: Line[]) => lines.reduce((total, line) => total + (line.canceled ? 0 : line.price * line.quantity), 0);
