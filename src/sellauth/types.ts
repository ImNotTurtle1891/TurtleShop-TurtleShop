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

export interface ProductVariant {
  readonly id: number;
  readonly name: string | null;
  readonly price: string | null;
  /** -1 means unlimited stock (service/dynamic products). */
  readonly stock: number | null;
}

export interface ProductSummary {
  readonly id: number;
  readonly name: string;
  readonly price: string | null;
  readonly currency: string;
  readonly visibility: string;
  /** -1 means unlimited stock. */
  readonly stock_count: number | null;
  readonly variants: readonly ProductVariant[];
}

export interface ProductPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly ProductSummary[];
}

export interface ProductListQuery {
  readonly page: number;
  readonly perPage: number;
  readonly name?: string;
}
