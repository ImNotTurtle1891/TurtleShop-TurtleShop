import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CLAIMS_FILE = join('data', 'claims.json');

export interface ClaimRecord {
  readonly discordUserId: string;
  readonly claimedAt: string;
}

type ClaimMap = Record<string, ClaimRecord>;

function loadClaims(): ClaimMap {
  if (!existsSync(CLAIMS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) as ClaimMap;
  } catch (error) {
    console.error(`Could not parse ${CLAIMS_FILE}, treating it as empty:`, error);
    return {};
  }
}

export function getClaim(invoiceId: string): ClaimRecord | undefined {
  return loadClaims()[invoiceId];
}

export function recordClaim(invoiceId: string, record: ClaimRecord): void {
  const claims = loadClaims();
  claims[invoiceId] = record;
  mkdirSync(dirname(CLAIMS_FILE), { recursive: true });
  writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));
}
