export type Role = 'WAITER' | 'KITCHEN' | 'MANAGER';
export type OrderStatus = 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'REJECTED' | 'CANCELED';
export type ReceiptStatus = 'PREPARED' | 'SENDING' | 'UNKNOWN' | 'ISSUED' | 'FAILED';
export type Option = { id: string; name: string; extra: number };
export type Product = {
  id: string; categoryId: string; name: string; description: string; image: string; price: number;
  available: boolean; options: Option[]; fiscalCode: string; vatCode: string;
};
export type Category = { id: string; name: string; position: number; products: Product[] };
export type Line = {
  key: string; productId: string; name: string; optionId?: string; option?: string; note: string;
  price: number; quantity: number; fiscalCode: string; vatCode: string; canceled?: string;
};
export type Order = { id: string; status: OrderStatus; lines: Line[]; source: string; reason?: string; createdAt: string };
export type Receipt = { id: string; status: ReceiptStatus; method: 'CASH' | 'CARD'; total: number; reference?: string; settledAt?: string };
export type ServiceCall = { id: string; createdAt: string; resolvedAt?: string };
export type Visit = { id: string; pin: string | null; orders: Order[]; calls: ServiceCall[]; receipts: Receipt[]; cart: Line[]; total: number };
export type Table = { id: string; code: string; number: number; seats: number; x: number; y: number; visit?: Visit };
export type Restaurant = { slug: string; name: string; tagline: string; image: string; logo: string };
export type Employee = { id: string; username: string; name: string; roles: Role[]; active: boolean; canFiscalize: boolean };
export type Menu = { restaurant: Restaurant; table: { number: number; pinConfigured: boolean }; categories: Category[] };
export type GuestState = { cart: Line[]; orders: Order[]; call?: ServiceCall; total: number };

export const statusLabel: Record<OrderStatus, string> = {
  PENDING: 'Czeka na potwierdzenie kelnera', ACCEPTED: 'Przyjęte przez kuchnię', PREPARING: 'W przygotowaniu',
  READY: 'Gotowe', SERVED: 'Podane', REJECTED: 'Odrzucone', CANCELED: 'Anulowane',
};
export const roleLabel: Record<Role, string> = { WAITER: 'Kelner', KITCHEN: 'Kuchnia', MANAGER: 'Manager' };
export const lineTotal = (lines: Line[]) => lines.reduce((total, line) => total + (line.canceled ? 0 : line.price * line.quantity), 0);
