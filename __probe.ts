import { config as dotenv } from 'dotenv';

dotenv({ path: '.env.local' });
dotenv({ path: '.env' });

const base = (process.env.SELLAUTH_BASE_URL ?? 'https://api.sellauth.com/v1').replace(/\/$/, '');
const shopId = process.env.SELLAUTH_SHOP_ID ?? '';
const headers = {
  Authorization: `Bearer ${process.env.SELLAUTH_API_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}/shops/${shopId}${path}`, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body)
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const created = await call('POST', '/products', {
  type: 'variant',
  name: 'sellbot-price-test2',
  path: 'sellbot-price-test2',
  description: 'KEEP-ME description',
  instructions: 'KEEP-ME instructions',
  deliverables_type: 'dynamic',
  visibility: 'private',
  currency: 'USD',
  product_addons: [],
  product_upsells: [],
  variants: [{ name: 'Default', price: 5 }]
});
const productId = (created.json as { id?: number }).id;
console.log('temp product:', created.status, productId);
if (productId === undefined) {
  throw new Error('create failed');
}

try {
  const detail1 = await call('GET', `/products/${productId}`);
  const d1 = detail1.json as { variants: ReadonlyArray<{ id: number; dynamic_url?: unknown }>; description?: string };
  const variantId = d1.variants[0]?.id;
  if (variantId === undefined) {
    throw new Error('no variant');
  }

  // Minimal PUT update: does it behave as a partial update for omitted fields?
  const upd = await call('PUT', `/products/${productId}/update`, {
    type: 'variant',
    name: 'sellbot-price-test2',
    currency: 'USD',
    visibility: 'private',
    product_addons: [],
    product_upsells: [],
    variants: [{ id: variantId, name: 'Default', price: 9.99 }]
  });
  console.log('update status:', upd.status, JSON.stringify(upd.json).slice(0, 200));

  const detail2 = await call('GET', `/products/${productId}`);
  const d2 = detail2.json as {
    description?: string;
    instructions?: string;
    deliverables_type?: string;
    variants: ReadonlyArray<{ price?: unknown; stock?: unknown; name?: unknown }>;
  };
  console.log(
    'after: price =', d2.variants[0]?.price,
    '| description =', JSON.stringify(d2.description),
    '| instructions =', JSON.stringify(d2.instructions),
    '| deliverables_type =', d2.deliverables_type
  );
} finally {
  const del = await call('DELETE', `/products/${productId}`);
  console.log('cleanup delete:', del.status);
}
