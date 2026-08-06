import type {
  AnalyticsSummary,
  DateRange,
  ShopStats,
  TopCustomer,
  TopPaymentMethod,
  TopProduct
} from './types.js';

export class SellAuthApiError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = 'SellAuthApiError';
    this.status = status;
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
    return this.get<AnalyticsSummary>('/analytics', range);
  }

  public async getTopProducts(range: DateRange): Promise<TopProduct[]> {
    return this.get<TopProduct[]>('/analytics/top-products', range);
  }

  public async getTopCustomers(range: DateRange): Promise<TopCustomer[]> {
    return this.get<TopCustomer[]>('/analytics/top-customers', range);
  }

  public async getTopPaymentMethods(range: DateRange): Promise<TopPaymentMethod[]> {
    return this.get<TopPaymentMethod[]>('/analytics/top-payment-methods', range);
  }

  private async get<T>(path: string, query?: DateRange): Promise<T> {
    const url = new URL(`${this.baseUrl}/shops/${this.shopId}${path}`);
    if (query !== undefined) {
      url.searchParams.set('start', query.start);
      url.searchParams.set('end', query.end);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new SellAuthApiError(
        response.status,
        `SellAuth API request to ${path} failed with status ${response.status}: ${body}`
      );
    }

    return (await response.json()) as T;
  }
}
