export type DailySales = {
  day: string;
  total: number;
  cash: number;
  card: number;
  orders: number;
  dishes: { name: string; quantity: number; sales: number }[];
};

export const salesTimeZone = 'Europe/Warsaw';
