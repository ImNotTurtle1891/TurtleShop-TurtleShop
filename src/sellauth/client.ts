import type {
  AnalyticsSummary,
  BlacklistEntry,
  BlacklistPage,
  CheckoutSession,
  Coupon,
  CreateBlacklistEntryInput,
  CreateCheckoutInput,
  CouponPage,
  CreateCouponInput,
  CustomerPage,
  CustomerSummary,
  DateRange,
  FeedbackListQuery,
  FeedbackPage,
  FeedbackStats,
  Invoice,
  InvoicePage,
  ProductDetail,
  ProductListQuery,
  ProductPage,
  ShopStats,
  TicketDetail,
  TicketListQuery,
  TicketPage,
  TopCustomer,
  TopPaymentMethod,
  TopProduct
} from './types.js';

type QueryParams = Readonly<Record<string, string>>;

function dateRangeParams(range: DateRange): QueryParams {
  return { start: range.start, end: range.end };
}

export class SellAuthApiError extends Error {
  public readonly status: number;
  /** Short human-readable error from the API response body, when available. */
  public readonly apiMessage: string | null;

  public constructor(status: number, message: string, apiMessage: string | null = null) {
    super(message);
    this.name = 'SellAuthApiError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

function extractApiMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const candidate = parsed.error ?? parsed.message;
    return typeof candidate === 'string' && candidate !== '' ? candidate : null;
  } catch {
    return null;
  }
}

export interface SellAuthClientOptions {
  readonly apiKey: string;
  readonly shopId: string;
  readonly baseUrl: string;
}

export class SellAuthClient {
  private readonly apiKey: string;
  private readonly shopId: string;
  private readonly baseUrl: string;

  public constructor(options: SellAuthClientOptions) {
    this.apiKey = options.apiKey;
    this.shopId = options.shopId;
    this.baseUrl = options.baseUrl;
  }

  public async getShopStats(): Promise<ShopStats> {
    return this.get<ShopStats>('/stats');
  }

  public async getAnalytics(range: DateRange): Promise<AnalyticsSummary> {
    return this.get<AnalyticsSummary>('/analytics', dateRangeParams(range));
  }

  public async getTopProducts(range: DateRange): Promise<TopProduct[]> {
    return this.get<TopProduct[]>('/analytics/top-products', dateRangeParams(range));
  }

  public async getTopCustomers(range: DateRange): Promise<TopCustomer[]> {
    return this.get<TopCustomer[]>('/analytics/top-customers', dateRangeParams(range));
  }

  public async getTopPaymentMethods(range: DateRange): Promise<TopPaymentMethod[]> {
    return this.get<TopPaymentMethod[]>('/analytics/top-payment-methods', dateRangeParams(range));
  }

  public async getProducts(query: ProductListQuery): Promise<ProductPage> {
    const params: Record<string, string> = {
      page: String(query.page),
      perPage: String(query.perPage)
    };
    if (query.name !== undefined) {
      params['name'] = query.name;
    }
    return this.get<ProductPage>('/products', params);
  }

  public async getProduct(productId: number): Promise<ProductDetail> {
    return this.get<ProductDetail>(`/products/${productId}`);
  }

  /** Accepts either the numeric invoice ID or the customer-facing unique ID. */
  public async getInvoice(invoiceId: string): Promise<Invoice> {
    return this.get<Invoice>(`/invoices/${encodeURIComponent(invoiceId)}`);
  }

  public async updateInvoiceStatus(
    invoiceId: number,
    status: 'completed' | 'cancelled' | 'failed' | 'refunded'
  ): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/status`, { body: { status } });
  }

  public async refundInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/refund`);
  }

  public async cancelInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/cancel`);
  }

  public async resendInvoiceEmail(invoiceId: number, email?: string): Promise<void> {
    await this.request(
      'POST',
      `/invoices/${invoiceId}/resend-email`,
      email === undefined ? {} : { body: { email } }
    );
  }

  /** Processes a pending/confirming/out-of-stock invoice, delivering its items. */
  public async processInvoice(invoiceId: number, markAsPaid: boolean): Promise<void> {
    await this.request(
      'GET',
      `/invoices/${invoiceId}/process`,
      markAsPaid ? { query: { mark_as_paid: '1' } } : {}
    );
  }

  public async deliverInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/deliver`);
  }

  public async updateInvoiceDashboardNote(invoiceId: number, note: string | null): Promise<void> {
    await this.request('PUT', `/invoices/${invoiceId}/dashboard-note`, { body: { note } });
  }

  public async shipInvoice(
    invoiceId: number,
    tracking: { readonly code?: string; readonly link?: string }
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (tracking.code !== undefined) {
      body['tracking_code'] = tracking.code;
    }
    if (tracking.link !== undefined) {
      body['tracking_link'] = tracking.link;
    }
    await this.request('POST', `/invoices/${invoiceId}/ship`, { body });
  }

  public async unrefundInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/unrefund`);
  }

  public async archiveInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/archive`);
  }

  public async unarchiveInvoice(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/unarchive`);
  }

  public async reverseCashback(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/reverse-cashback`);
  }

  public async reverseAffiliateCommission(invoiceId: number): Promise<void> {
    await this.request('POST', `/invoices/${invoiceId}/reverse-affiliate-commission`);
  }

  public async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const body: Record<string, unknown> = { cart: input.cart };
    if (input.email !== undefined) {
      body['email'] = input.email;
    }
    if (input.coupon !== undefined) {
      body['coupon'] = input.coupon;
    }
    if (input.currency !== undefined) {
      body['currency'] = input.currency;
    }
    return this.request<CheckoutSession>('POST', '/checkout', { body });
  }

  public async getBlacklist(
    page: number,
    perPage: number,
    value?: string
  ): Promise<BlacklistPage> {
    const params: Record<string, string> = {
      page: String(page),
      perPage: String(perPage)
    };
    if (value !== undefined) {
      params['value'] = value;
    }
    return this.get<BlacklistPage>('/blacklist', params);
  }

  public async createBlacklistEntry(input: CreateBlacklistEntryInput): Promise<BlacklistEntry> {
    const body: Record<string, unknown> = {
      value: input.value,
      type: input.type,
      match_type: 'exact'
    };
    if (input.reason !== undefined) {
      body['reason'] = input.reason;
    }
    return this.request<BlacklistEntry>('POST', '/blacklist', { body });
  }

  public async deleteBlacklistEntry(entryId: number): Promise<void> {
    await this.request('DELETE', `/blacklist/${entryId}`);
  }

  public async getTickets(query: TicketListQuery): Promise<TicketPage> {
    const params: Record<string, string> = {
      page: String(query.page),
      perPage: String(query.perPage),
      orderColumn: 'created_at',
      orderDirection: 'desc'
    };
    if (query.status !== undefined) {
      params['statuses[]'] = query.status;
    }
    if (query.email !== undefined) {
      params['customer_email'] = query.email;
    }
    return this.get<TicketPage>('/tickets', params);
  }

  public async getTicket(ticketId: string): Promise<TicketDetail> {
    return this.get<TicketDetail>(`/tickets/${encodeURIComponent(ticketId)}`);
  }

  public async sendTicketMessage(ticketId: string, content: string): Promise<void> {
    await this.request('POST', `/tickets/${encodeURIComponent(ticketId)}/messages`, {
      body: { content }
    });
  }

  public async closeTicket(ticketId: string): Promise<void> {
    await this.request('POST', `/tickets/${encodeURIComponent(ticketId)}/close`);
  }

  public async reopenTicket(ticketId: string): Promise<void> {
    await this.request('POST', `/tickets/${encodeURIComponent(ticketId)}/reopen`);
  }

  public async getFeedbacks(query: FeedbackListQuery): Promise<FeedbackPage> {
    const params: Record<string, string> = {
      page: String(query.page),
      perPage: String(query.perPage),
      orderColumn: 'created_at',
      orderDirection: 'desc'
    };
    if (query.rating !== undefined) {
      params['rating'] = String(query.rating);
    }
    if (query.writtenOnly === true) {
      params['is_automatic'] = '0';
    }
    return this.get<FeedbackPage>('/feedbacks', params);
  }

  public async getFeedbackStats(): Promise<FeedbackStats> {
    return this.get<FeedbackStats>('/feedbacks/stats');
  }

  public async replyToFeedback(feedbackId: number, reply: string): Promise<void> {
    await this.request('POST', `/feedbacks/${feedbackId}/reply`, { body: { reply } });
  }

  public async getCoupons(page: number, perPage: number): Promise<CouponPage> {
    return this.get<CouponPage>('/coupons', { page: String(page), perPage: String(perPage) });
  }

  public async createCoupon(input: CreateCouponInput): Promise<Coupon> {
    const body: Record<string, unknown> = {
      code: input.code,
      global: true,
      discount: input.discount,
      type: input.type
    };
    if (input.maxUses !== undefined) {
      body['max_uses'] = input.maxUses;
    }
    if (input.maxUsesPerCustomer !== undefined) {
      body['max_uses_per_customer'] = input.maxUsesPerCustomer;
    }
    if (input.minInvoicePrice !== undefined) {
      body['min_invoice_price'] = input.minInvoicePrice;
    }
    if (input.expirationDate !== undefined) {
      body['expiration_date'] = input.expirationDate;
    }
    return this.request<Coupon>('POST', '/coupons', { body });
  }

  public async deleteCoupon(couponId: number): Promise<void> {
    await this.request('DELETE', `/coupons/${couponId}`);
  }

  public async findCustomerByEmail(email: string): Promise<CustomerSummary | null> {
    const page = await this.get<CustomerPage>('/customers', { email });
    return page.data[0] ?? null;
  }

  public async getInvoicesByEmail(
    email: string,
    page: number,
    perPage: number
  ): Promise<InvoicePage> {
    return this.get<InvoicePage>('/invoices', {
      email,
      page: String(page),
      perPage: String(perPage)
    });
  }

  private async get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      query?: QueryParams | undefined;
      body?: Readonly<Record<string, unknown>> | undefined;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/shops/${this.shopId}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json'
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new SellAuthApiError(
        response.status,
        `SellAuth API ${method} ${path} failed with status ${response.status}: ${body}`,
        extractApiMessage(body)
      );
    }

    const text = await response.text();
    // Action endpoints can return an empty body on success.
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }
}
