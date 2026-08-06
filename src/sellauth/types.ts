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
  /** How the product is delivered: serials, service, files, dynamic, or physical. */
  readonly deliverables_type: string | null;
  /** The storefront status badge, e.g. "Undetected" with color "#22c55e". */
  readonly status_text: string | null;
  readonly status_color: string | null;
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

export interface CheckoutCartItem {
  readonly productId?: number;
  readonly variantId?: number;
  readonly name?: string;
  readonly price?: number;
  readonly quantity: number;
}

export interface CreateCheckoutInput {
  readonly cart: readonly CheckoutCartItem[];
  readonly email?: string;
  readonly coupon?: string;
  /** Required when every cart item is a custom item. */
  readonly currency?: string;
}

export interface CheckoutSession {
  readonly success: boolean;
  readonly invoice_id: number;
  readonly invoice_url: string;
  readonly url: string;
}

export interface FeedbackListItem {
  readonly id: number;
  readonly status: string;
  readonly message: string | null;
  readonly rating: number;
  readonly is_automatic: boolean;
  readonly reply: string | null;
  readonly created_at: string;
  readonly invoice: {
    readonly unique_id: string;
    readonly email: string | null;
    readonly items: readonly InvoiceItem[];
  } | null;
}

export interface FeedbackPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly FeedbackListItem[];
}

export interface FeedbackStats {
  readonly total: number;
  readonly published: number;
  readonly pending_disputes: number;
  readonly replied: number;
  readonly automatic: number;
  readonly reply_rate: number;
  readonly average_rating: number;
  readonly by_rating: Readonly<Record<string, number>>;
}

export interface FeedbackListQuery {
  readonly page: number;
  readonly perPage: number;
  readonly rating?: number;
  /** Only customer-written feedbacks (excludes automatic ones). */
  readonly writtenOnly?: boolean;
}

export interface TicketMessage {
  readonly id: string;
  readonly sender_type: string;
  readonly content: string;
  readonly created_at: string;
  readonly sender: { readonly email?: string } | null;
}

export interface TicketListItem {
  readonly id: string;
  readonly subject: string;
  readonly status: string;
  readonly created_at: string;
  readonly customer: { readonly email: string } | null;
  readonly last_message: TicketMessage | null;
  readonly invoice: { readonly unique_id: string } | null;
}

export interface TicketDetail extends TicketListItem {
  readonly messages: readonly TicketMessage[];
}

export interface TicketPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly TicketListItem[];
}

export interface TicketListQuery {
  readonly page: number;
  readonly perPage: number;
  readonly status?: string;
  readonly email?: string;
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

export interface BalanceTransaction {
  readonly id: string;
  /** incoming or outgoing. */
  readonly type: string;
  readonly description: string | null;
  readonly invoice_id: number | null;
  readonly amount: string;
  readonly currency: string;
  readonly created_at: string;
}

export interface BalanceTransactionPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly BalanceTransaction[];
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
  readonly id: number;
  readonly product_id: number;
  readonly custom_name: string | null;
  readonly quantity: number;
  readonly price: string | null;
  /** Delivered serials/keys (a single string for some delivery types). Sensitive — never display the values. */
  readonly delivered: readonly string[] | string | null;
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
  readonly archived_at: string | null;
  readonly dashboard_note: string | null;
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

export interface PaymentMethod {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly checkout_name: string | null;
  readonly percentage_fee: number | null;
  readonly fixed_fee: number | null;
  readonly min_amount: number | string | null;
  readonly max_amount: number | string | null;
  readonly is_active: boolean;
}

export interface TrafficTotals {
  readonly pageviews: number;
  readonly visitors: number;
  readonly visits: number;
  readonly bounces: number;
  readonly totaltime: number;
}

export interface TrafficStats extends TrafficTotals {
  readonly comparison: TrafficTotals;
}

/** Umami-style metric entry: x is the value (e.g. UTM source), y is the visit count. */
export interface TrafficMetric {
  readonly x: string | null;
  readonly y: number;
}

export interface TrafficUtmBreakdown {
  readonly utm_source: readonly TrafficMetric[];
  readonly utm_medium: readonly TrafficMetric[];
  readonly utm_campaign: readonly TrafficMetric[];
  readonly utm_term: readonly TrafficMetric[];
  readonly utm_content: readonly TrafficMetric[];
}

export interface ShopNotification {
  readonly id: string;
  readonly level: string;
  readonly title: string;
  readonly description: string | null;
  readonly link: string | null;
  readonly created_at: string;
}

export interface LatestNotifications {
  readonly notifications: readonly ShopNotification[];
  readonly unread_count: number;
}

export interface ActivityLogEntry {
  readonly id: number;
  readonly type: string;
  readonly user_email: string | null;
  readonly subject_id: number | null;
  readonly subject_type: string | null;
  readonly properties: {
    readonly old?: Readonly<Record<string, unknown>>;
    readonly attributes?: Readonly<Record<string, unknown>>;
  } | null;
  readonly created_at: string;
}

export interface ActivityLogPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly ActivityLogEntry[];
}

export interface Affiliate {
  readonly id: number;
  readonly email: string;
  readonly affiliate_balance: string;
  readonly affiliate_code: string | null;
  readonly affiliate_code_set_at: string | null;
  readonly affiliate_referrer_earnings: string;
  readonly referrals_count: number;
  readonly affiliate_tier: { readonly name: string } | null;
}

export interface AffiliatePage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly Affiliate[];
}

export interface AffiliateStats {
  readonly total_affiliates: number;
  readonly active_affiliates: number;
  readonly inactive_affiliates: number;
  readonly new_affiliates: number;
  readonly new_affiliates_previous: number;
  readonly commissions_usd: number;
  readonly commissions_usd_previous: number;
  readonly commissions_usd_all_time: number;
  readonly referral_revenue_usd: number;
  readonly referral_revenue_usd_previous: number;
  readonly referral_revenue_usd_all_time: number;
  readonly average_commission_rate: number;
  readonly top_earner_usd: number;
  readonly top_performers: readonly Affiliate[];
  readonly pending_payout_requests: number;
  readonly window_days: number;
}

export interface AffiliatePayoutRequest {
  readonly id: number;
  readonly shop_customer_id: number;
  readonly amount: number | string;
  readonly status: string;
  readonly payout_details: string | null;
  readonly seller_note: string | null;
  readonly processed_at: string | null;
  readonly created_at: string;
  readonly shop_customer: {
    readonly id: number;
    readonly email: string;
    readonly affiliate_code: string | null;
    readonly affiliate_balance: string;
  } | null;
}

export interface AffiliatePayoutPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly AffiliatePayoutRequest[];
}

export interface AffiliateDetail {
  readonly affiliate: Affiliate;
  readonly referrals: readonly unknown[];
  readonly attributed_invoices: readonly unknown[];
  readonly payout_requests: readonly AffiliatePayoutRequest[];
}

export interface AffiliateTier {
  readonly id: number;
  readonly name: string;
  readonly percentage: number;
  readonly is_default: boolean;
}

export interface Reseller {
  readonly id: number;
  readonly email: string;
  readonly balance: string;
  readonly reseller_status: string;
  readonly reseller_applied_at: string | null;
  readonly reseller_approved_at: string | null;
  readonly reseller_total_spent_usd: number | string;
  readonly reseller_total_completed: number;
  readonly reseller_tier: { readonly name: string } | null;
}

export interface ResellerPage {
  readonly current_page: number;
  readonly last_page: number;
  readonly total: number;
  readonly data: readonly Reseller[];
}

export interface ResellerStats {
  readonly total_resellers: number;
  readonly active_resellers: number;
  readonly inactive_resellers: number;
  readonly new_resellers: number;
  readonly pending_applications: number;
  readonly revenue_usd: number;
  readonly revenue_usd_previous: number;
  readonly revenue_usd_all_time: number;
  readonly orders_all_time: number;
  readonly top_performers: readonly Reseller[];
  readonly window_days: number;
}

export interface ResellerOrder {
  readonly id: number;
  readonly status: string;
  readonly price_usd: string | null;
  readonly created_at: string;
  readonly unique_id: string;
}

export interface ResellerDetail {
  readonly reseller: Reseller & { readonly reseller_application_answer: string | null };
  readonly orders: readonly ResellerOrder[];
}

export interface ResellerTier {
  readonly id: number;
  readonly name: string;
  readonly discount_percentage: number;
  readonly is_default: boolean;
}
