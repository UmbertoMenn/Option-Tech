/**
 * Client-side wrapper for calling the massive-proxy edge function.
 */
import { supabase } from '@/integrations/supabase/client';

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/massive-proxy`;

async function callProxy<T>(params: Record<string, string>): Promise<T> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Not authenticated');

  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`massive-proxy error ${res.status}: ${body}`);
  }
  return res.json();
}

export interface StockBar {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OptionContract {
  ticker: string; // O:PLTR250117C00030000
  underlying_ticker: string;
  contract_type: 'call' | 'put';
  strike_price: number;
  expiration_date: string; // YYYY-MM-DD
}

export interface OptionBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OptionSnapshotResult {
  ticker: string;
  strike_price: number;
  contract_type: 'call' | 'put';
  expiration_date: string;
  day?: { close: number; open: number; high: number; low: number; volume: number };
  greeks?: { delta: number; gamma: number; theta: number; vega: number; implied_volatility: number };
  last_quote?: { bid: number; ask: number; midpoint: number };
}

/** Fetch daily stock bars for a ticker. */
export async function fetchStockBars(ticker: string, from: string, to: string): Promise<StockBar[]> {
  return callProxy<StockBar[]>({ op: 'stock-bars', ticker, from, to });
}

/** Fetch option contracts for a ticker and expiration date. */
export async function fetchOptionContracts(ticker: string, expirationDate: string): Promise<OptionContract[]> {
  return callProxy<OptionContract[]>({ op: 'option-contracts', ticker, expiration_date: expirationDate });
}

/** Fetch daily bars for an option ticker. */
export async function fetchOptionBars(optionTicker: string, from: string, to: string): Promise<OptionBar[]> {
  return callProxy<OptionBar[]>({ op: 'option-bars', ticker: optionTicker, from, to });
}

/** Fetch option chain snapshot for a ticker and expiration date. */
export async function fetchOptionChain(ticker: string, expirationDate: string): Promise<OptionSnapshotResult[]> {
  return callProxy<OptionSnapshotResult[]>({ op: 'option-chain', ticker, expiration_date: expirationDate });
}
