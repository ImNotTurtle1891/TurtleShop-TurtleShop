export interface ShopStats {
  readonly products_sold: number;
  readonly total_customers: number;
  readonly total_completed_invoices: number;
  readonly total_feedbacks: number;
  readonly average_rating: number;
}

export interface AnalyticsSummary {
  readonly revenue: number;
  readonly previousRevenue: number;
  readonly orders: number;
  readonly previousOrders: number;
  readonly customers: number;
  readonly previousCustomers: number;
}

export interface TopProduct {
  readonly product_id: number;
  readonly variant_id: number;
  readonly product_name: string;
  readonly variant_name: string | null;
  readonly total_revenue_usd: number;
  readonly total_orders: number;
}

export interface TopCustomer {
  readonly id: number;
  readonly email: string;
  readonly discord_username: string | null;
  readonly total_spent_usd: string;
  readonly total_completed: number;
}

export interface TopPaymentMethod {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly total_orders: number;
  readonly total_revenue_usd: number;
}

export interface DateRange {
  readonly start: string;
  readonly end: string;
}
