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

export interface ProductImage {
  readonly url: string;
}

export interface ProductDetail extends ProductSummary {
  readonly description: string | null;
  readonly products_sold: number;
  readonly images: readonly ProductImage[];
}

export interface ProductListQuery {
  readonly page: number;
  readonly perPage: number;
  readonly name?: string;
}

export interface Coupon {
  readonly id: number;
  readonly code: string;
  /** false means the coupon only applies to specific products. */
  readonly global: boolean;
  readonly discount: string;
  readonly uses: number;
  readonly max_uses: number | null;
  readonly max_uses_per_customer: number | null;
  readonly min_invoice_price: string | number | null;
  readonly type: string;
  readonly start_date: string | null;
  readonly expiration_date: string | null;
  readonly last_used_at: string | null;
  readonly total_saved: string;
  readonly revenue_attributed: string;
}

export interface CouponPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly Coupon[];
}

export interface CreateCouponInput {
  readonly code: string;
  readonly discount: number;
  readonly type: 'percentage' | 'fixed';
  readonly maxUses?: number;
  readonly maxUsesPerCustomer?: number;
  readonly minInvoicePrice?: number;
  /** YYYY-MM-DD */
  readonly expirationDate?: string;
}

export interface BlacklistEntry {
  readonly id: number;
  readonly type: string;
  readonly match_type: string;
  readonly value: string;
  readonly reason: string | null;
  readonly enabled: boolean;
  readonly created_at: string;
}

export interface BlacklistPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly BlacklistEntry[];
}

export interface CreateBlacklistEntryInput {
  readonly value: string;
  readonly type: string;
  readonly reason?: string;
}

export interface InvoiceItem {
  readonly product: { readonly name: string } | null;
  readonly variant: { readonly name: string | null } | null;
}

export interface CustomerSummary {
  readonly id: number;
  readonly email: string;
  readonly discord_username: string | null;
  readonly balance: string;
  readonly total_completed: number;
  readonly total_spent_usd: string;
  readonly last_completed_at: string | null;
}

export interface CustomerPage {
  readonly data: readonly CustomerSummary[];
}

export interface InvoiceListItem {
  readonly id: number;
  readonly unique_id: string;
  readonly status: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly created_at: string;
  readonly items: readonly InvoiceItem[];
}

export interface InvoicePage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly InvoiceListItem[];
}

export interface InvoiceDetailItem extends InvoiceItem {
  readonly product_id: number;
  readonly custom_name: string | null;
  readonly quantity: number;
  readonly price: string | null;
  /** Delivered serials/keys. Contents are sensitive — only ever show the count. */
  readonly delivered: readonly string[] | null;
}

export interface InvoiceCustomer {
  readonly id: number;
  readonly email: string;
  readonly discord_id: string | null;
  readonly discord_username: string | null;
}

export interface InvoiceFeedback {
  readonly rating: number;
  readonly message: string | null;
}

export interface InvoiceBlacklistStatus {
  readonly email: boolean;
  readonly discord_id: boolean;
  readonly ip: boolean;
}

export interface Invoice {
  readonly id: number;
  readonly unique_id: string;
  readonly status: string;
  readonly email: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly price: string | null;
  readonly paid: string | null;
  readonly currency: string | null;
  readonly gateway: string | null;
  readonly manual: boolean;
  readonly ip: string | null;
  readonly country_code: string | null;
  readonly payment_method: { readonly name: string } | null;
  readonly customer: InvoiceCustomer | null;
  readonly feedback: InvoiceFeedback | null;
  readonly blacklist_status: InvoiceBlacklistStatus | null;
  readonly items: readonly InvoiceDetailItem[];
}
