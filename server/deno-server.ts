/**
 * Bellwether Live Data Server (Deno Deploy - Serverless version)
 *
 * Tiered Pricing System:
 * - Tier 1: 6h VWAP (10+ trades) - Full reportability
 * - Tier 2: 12h/24h VWAP (10+ trades) - Reportability downgraded one level
 * - Tier 3: Order book midpoint (no trades) - Capped at Caution
 * - Tier 4: Last known VWAP (stale) - Always Fragile
 *
 * Deploy: https://dash.deno.com
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DOME_API_KEY = Deno.env.get("DOME_API_KEY") || "";
const DOME_REST_BASE = "https://api.domeapi.io/v1";

const CONFIG = {
  cache_ttl_ms: 60000, // 60 seconds cache TTL
  min_trades_for_vwap: 10, // Minimum trades needed for reliable VWAP
  vwap_windows: [6, 12, 24], // Hours to try for VWAP (in order)
};

// Use Deno KV for persistent caching
const kv = await Deno.openKv();

// =============================================================================
// TYPES
// =============================================================================

interface OrderbookLevel {
  price: number;
  size: number;
}

interface Trade {
  price: number;
  size: number;
  timestamp: number;
}

type Reportability = "reportable" | "caution" | "fragile";
type PriceTier = 1 | 2 | 3 | 4;

interface TieredPriceResult {
  tier: PriceTier;
  price: number | null;
  label: string;
  window_hours: number | null;
  trade_count: number;
  total_volume: number;
  source: "6h_vwap" | "12h_vwap" | "24h_vwap" | "orderbook_midpoint" | "stale_vwap";
}

interface RobustnessResult {
  cost_to_move_5c: number | null;
  reportability: Reportability;
  raw_reportability: Reportability; // Before tier adjustment
}

interface MarketMetrics {
  token_id: string;
  platform: string;
  bellwether_price: number | null;
  price_tier: PriceTier;
  price_label: string;
  price_source: string;
  current_price: number | null;
  robustness: RobustnessResult;
  vwap_details: {
    window_hours: number | null;
    trade_count: number;
    total_volume: number;
  };
  orderbook_midpoint: number | null;
  fetched_at: string;
  cached: boolean;
}

interface StaleVWAP {
  price: number;
  window_hours: number;
  trade_count: number;
  stored_at: string;
}

// =============================================================================
// DOME API FUNCTIONS
// =============================================================================

async function fetchOrderbook(platform: string, tokenId: string): Promise<OrderbookLevel[][] | null> {
  if (!DOME_API_KEY) {
    console.error("No DOME_API_KEY set");
    return null;
  }

  const params = new URLSearchParams();

  if (platform === "kalshi") {
    params.set("ticker", tokenId);
  } else {
    params.set("token_id", tokenId);
  }

  const endpoint = platform === "kalshi"
    ? `${DOME_REST_BASE}/kalshi/orderbooks?${params}`
    : `${DOME_REST_BASE}/polymarket/orderbooks?${params}`;

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${DOME_API_KEY}` },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Orderbook fetch failed: ${response.status} - ${text}`);
      return null;
    }

    const data = await response.json();

    const snapshots = data.snapshots || data.data || (Array.isArray(data) ? data : []);
    if (snapshots.length === 0) {
      console.error("No orderbook snapshots returned");
      return null;
    }

    const latestSnapshot = snapshots[0];

    const bids: OrderbookLevel[] = [];
    const asks: OrderbookLevel[] = [];

    if (platform === "kalshi" && latestSnapshot.orderbook) {
      const yesAsks = latestSnapshot.orderbook.yes_dollars || [];
      for (const [priceStr, qty] of yesAsks) {
        const price = Number(priceStr);
        const size = Number(qty);
        if (price > 0 && size > 0) {
          asks.push({ price, size });
        }
      }
      const noBids = latestSnapshot.orderbook.no_dollars || [];
      for (const [priceStr, qty] of noBids) {
        const price = 1 - Number(priceStr);
        const size = Number(qty);
        if (price > 0 && size > 0) {
          bids.push({ price, size });
        }
      }
    } else {
      const rawBids = latestSnapshot.bids || [];
      const rawAsks = latestSnapshot.asks || [];

      for (const bid of rawBids) {
        const price = Number(bid.price || bid.p);
        const size = Number(bid.size || bid.s);
        if (price > 0 && size > 0) {
          bids.push({ price, size });
        }
      }

      for (const ask of rawAsks) {
        const price = Number(ask.price || ask.p);
        const size = Number(ask.size || ask.s);
        if (price > 0 && size > 0) {
          asks.push({ price, size });
        }
      }
    }

    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    return [bids, asks];
  } catch (err) {
    console.error(`Orderbook fetch error: ${err}`);
    return null;
  }
}

async function fetchTrades(platform: string, tokenId: string, windowHours: number): Promise<Trade[]> {
  if (!DOME_API_KEY) return [];

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - (windowHours * 60 * 60);

  let endpoint: string;
  const params = new URLSearchParams();

  if (platform === "kalshi") {
    params.set("ticker", tokenId);
    params.set("start_time", startSec.toString());
    params.set("end_time", nowSec.toString());
    endpoint = `${DOME_REST_BASE}/kalshi/trades?${params}`;
  } else {
    params.set("token_id", tokenId);
    params.set("start_time", startSec.toString());
    params.set("end_time", nowSec.toString());
    endpoint = `${DOME_REST_BASE}/polymarket/orders?${params}`;
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${DOME_API_KEY}` },
    });

    if (!response.ok) {
      console.log(`Trades fetch returned ${response.status}, using empty trades`);
      return [];
    }

    const data = await response.json();
    const trades: Trade[] = [];

    const tradeList = Array.isArray(data) ? data : (data.trades || data.orders || data.data || []);

    const startMs = startSec * 1000;

    for (const trade of tradeList) {
      const price = Number(trade.price || trade.p || trade.yes_price_dollars);
      const size = Number(trade.size || trade.amount || trade.s || trade.count || 1);
      let timestamp = Number(trade.timestamp || trade.t || trade.time || trade.created_at || trade.created_time);

      if (timestamp < 1e12) {
        timestamp = timestamp * 1000;
      }

      if (price > 0 && timestamp >= startMs) {
        trades.push({ price, size, timestamp });
      }
    }

    return trades;
  } catch (err) {
    console.error(`Trades fetch error: ${err}`);
    return [];
  }
}

// =============================================================================
// CALCULATION FUNCTIONS
// =============================================================================

function computeVWAP(trades: Trade[]): { vwap: number | null; trade_count: number; total_volume: number } {
  if (trades.length === 0) {
    return { vwap: null, trade_count: 0, total_volume: 0 };
  }

  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const trade of trades) {
    sumPriceVolume += trade.price * trade.size;
    sumVolume += trade.size;
  }

  return {
    vwap: sumVolume > 0 ? Math.round((sumPriceVolume / sumVolume) * 10000) / 10000 : null,
    trade_count: trades.length,
    total_volume: Math.round(sumVolume),
  };
}

function computeCostToMove5Cents(asks: OrderbookLevel[]): number | null {
  if (asks.length === 0) return null;

  const startingPrice = asks[0].price;
  const targetPrice = startingPrice + 0.05;

  let spent = 0;

  for (const ask of asks) {
    if (ask.price >= targetPrice) {
      return Math.round(spent);
    }
    const levelCost = ask.price * ask.size;
    spent += levelCost;
  }

  return null;
}

function computeOrderbookMidpoint(bids: OrderbookLevel[], asks: OrderbookLevel[]): number | null {
  if (bids.length === 0 || asks.length === 0) return null;
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  return Math.round(((bestBid + bestAsk) / 2) * 10000) / 10000;
}

function getBaseReportability(costToMove5c: number | null): Reportability {
  if (costToMove5c === null || costToMove5c < 10000) return "fragile";
  if (costToMove5c < 100000) return "caution";
  return "reportable";
}

function downgradeReportability(r: Reportability): Reportability {
  if (r === "reportable") return "caution";
  if (r === "caution") return "fragile";
  return "fragile";
}

function capReportability(r: Reportability, maxLevel: Reportability): Reportability {
  const levels: Reportability[] = ["fragile", "caution", "reportable"];
  const currentIdx = levels.indexOf(r);
  const maxIdx = levels.indexOf(maxLevel);
  return levels[Math.min(currentIdx, maxIdx)];
}

// =============================================================================
// TIERED PRICE CALCULATION
// =============================================================================

async function computeTieredPrice(
  platform: string,
  tokenId: string,
  bids: OrderbookLevel[],
  asks: OrderbookLevel[]
): Promise<TieredPriceResult> {
  // Try progressively larger windows until we get enough trades
  for (const windowHours of CONFIG.vwap_windows) {
    const trades = await fetchTrades(platform, tokenId, windowHours);
    const vwapResult = computeVWAP(trades);

    if (vwapResult.trade_count >= CONFIG.min_trades_for_vwap) {
      // Success! Store this as the last known good VWAP
      await storeLastVWAP(tokenId, vwapResult.vwap!, windowHours, vwapResult.trade_count);

      const tier: PriceTier = windowHours === 6 ? 1 : 2;
      const source = windowHours === 6 ? "6h_vwap" : (windowHours === 12 ? "12h_vwap" : "24h_vwap");
      const label = `${windowHours}h VWAP`;

      return {
        tier,
        price: vwapResult.vwap,
        label,
        window_hours: windowHours,
        trade_count: vwapResult.trade_count,
        total_volume: vwapResult.total_volume,
        source,
      };
    }
  }

  // Tier 3: No sufficient trades even in 24h - try orderbook midpoint
  const midpoint = computeOrderbookMidpoint(bids, asks);
  if (midpoint !== null) {
    return {
      tier: 3,
      price: midpoint,
      label: "Order book midpoint",
      window_hours: null,
      trade_count: 0,
      total_volume: 0,
      source: "orderbook_midpoint",
    };
  }

  // Tier 4: No orderbook either - use stale VWAP if available
  const stale = await getLastVWAP(tokenId);
  if (stale) {
    return {
      tier: 4,
      price: stale.price,
      label: "Last VWAP (stale)",
      window_hours: stale.window_hours,
      trade_count: stale.trade_count,
      total_volume: 0,
      source: "stale_vwap",
    };
  }

  // No data at all
  return {
    tier: 4,
    price: null,
    label: "No data",
    window_hours: null,
    trade_count: 0,
    total_volume: 0,
    source: "stale_vwap",
  };
}

async function computeCrossplatformTieredPrice(
  pmToken: string | null,
  kTicker: string | null,
  pmBids: OrderbookLevel[],
  pmAsks: OrderbookLevel[],
  kBids: OrderbookLevel[],
  kAsks: OrderbookLevel[]
): Promise<TieredPriceResult> {
  // Combine orderbooks for midpoint calculation
  const allBids = [...pmBids, ...kBids].sort((a, b) => b.price - a.price);
  const allAsks = [...pmAsks, ...kAsks].sort((a, b) => a.price - b.price);

  const cacheKey = `${pmToken || ""}_${kTicker || ""}`;

  // Try progressively larger windows until we get enough trades
  for (const windowHours of CONFIG.vwap_windows) {
    const allTrades: Trade[] = [];

    if (pmToken) {
      const pmTrades = await fetchTrades("polymarket", pmToken, windowHours);
      allTrades.push(...pmTrades);
    }
    if (kTicker) {
      const kTrades = await fetchTrades("kalshi", kTicker, windowHours);
      allTrades.push(...kTrades);
    }

    const vwapResult = computeVWAP(allTrades);

    if (vwapResult.trade_count >= CONFIG.min_trades_for_vwap) {
      await storeLastVWAP(cacheKey, vwapResult.vwap!, windowHours, vwapResult.trade_count);

      const tier: PriceTier = windowHours === 6 ? 1 : 2;
      const source = windowHours === 6 ? "6h_vwap" : (windowHours === 12 ? "12h_vwap" : "24h_vwap");
      const label = `${windowHours}h VWAP across platforms`;

      return {
        tier,
        price: vwapResult.vwap,
        label,
        window_hours: windowHours,
        trade_count: vwapResult.trade_count,
        total_volume: vwapResult.total_volume,
        source,
      };
    }
  }

  // Tier 3: Orderbook midpoint
  const midpoint = computeOrderbookMidpoint(allBids, allAsks);
  if (midpoint !== null) {
    return {
      tier: 3,
      price: midpoint,
      label: "Order book midpoint",
      window_hours: null,
      trade_count: 0,
      total_volume: 0,
      source: "orderbook_midpoint",
    };
  }

  // Tier 4: Stale VWAP
  const stale = await getLastVWAP(cacheKey);
  if (stale) {
    return {
      tier: 4,
      price: stale.price,
      label: "Last VWAP (stale)",
      window_hours: stale.window_hours,
      trade_count: stale.trade_count,
      total_volume: 0,
      source: "stale_vwap",
    };
  }

  return {
    tier: 4,
    price: null,
    label: "No data",
    window_hours: null,
    trade_count: 0,
    total_volume: 0,
    source: "stale_vwap",
  };
}

// =============================================================================
// STALE VWAP STORAGE
// =============================================================================

async function storeLastVWAP(key: string, price: number, windowHours: number, tradeCount: number): Promise<void> {
  const stale: StaleVWAP = {
    price,
    window_hours: windowHours,
    trade_count: tradeCount,
    stored_at: new Date().toISOString(),
  };
  // Store indefinitely (no expiration) - this is the last known good value
  await kv.set(["stale_vwap", key], stale);
}

async function getLastVWAP(key: string): Promise<StaleVWAP | null> {
  const result = await kv.get<StaleVWAP>(["stale_vwap", key]);
  return result.value || null;
}

// =============================================================================
// CACHE FUNCTIONS
// =============================================================================

async function getCachedMetrics(tokenId: string): Promise<MarketMetrics | null> {
  const result = await kv.get<MarketMetrics>(["metrics", tokenId]);

  if (!result.value) return null;

  const fetchedAt = new Date(result.value.fetched_at).getTime();
  if (Date.now() - fetchedAt > CONFIG.cache_ttl_ms) {
    return null;
  }

  return { ...result.value, cached: true };
}

async function cacheMetrics(tokenId: string, metrics: MarketMetrics): Promise<void> {
  await kv.set(["metrics", tokenId], metrics, { expireIn: CONFIG.cache_ttl_ms });
}

// =============================================================================
// MAIN FETCH FUNCTION
// =============================================================================

async function getMarketMetrics(platform: string, tokenId: string): Promise<MarketMetrics | null> {
  const cached = await getCachedMetrics(tokenId);
  if (cached) {
    return cached;
  }

  const orderbook = await fetchOrderbook(platform, tokenId);
  if (!orderbook) {
    return null;
  }

  const [bids, asks] = orderbook;

  // Compute tiered price
  const tieredPrice = await computeTieredPrice(platform, tokenId, bids, asks);

  // Compute robustness
  const costToMove5c = computeCostToMove5Cents(asks);
  const rawReportability = getBaseReportability(costToMove5c);

  // Adjust reportability based on tier
  let reportability: Reportability;
  if (tieredPrice.tier === 1) {
    reportability = rawReportability;
  } else if (tieredPrice.tier === 2) {
    reportability = downgradeReportability(rawReportability);
  } else if (tieredPrice.tier === 3) {
    reportability = capReportability(rawReportability, "caution");
  } else {
    reportability = "fragile";
  }

  // Get current price (most recent trade in any window)
  const recentTrades = await fetchTrades(platform, tokenId, 24);
  let currentPrice: number | null = null;
  if (recentTrades.length > 0) {
    const sortedTrades = [...recentTrades].sort((a, b) => b.timestamp - a.timestamp);
    currentPrice = sortedTrades[0].price;
  }

  const midpoint = computeOrderbookMidpoint(bids, asks);

  const metrics: MarketMetrics = {
    token_id: tokenId,
    platform,
    bellwether_price: tieredPrice.price,
    price_tier: tieredPrice.tier,
    price_label: tieredPrice.label,
    price_source: tieredPrice.source,
    current_price: currentPrice,
    robustness: {
      cost_to_move_5c: costToMove5c,
      reportability,
      raw_reportability: rawReportability,
    },
    vwap_details: {
      window_hours: tieredPrice.window_hours,
      trade_count: tieredPrice.trade_count,
      total_volume: tieredPrice.total_volume,
    },
    orderbook_midpoint: midpoint,
    fetched_at: new Date().toISOString(),
    cached: false,
  };

  await cacheMetrics(tokenId, metrics);

  return metrics;
}

// =============================================================================
// HTTP HANDLER
// =============================================================================

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /health
  if (url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        mode: "serverless",
        cache_ttl_seconds: CONFIG.cache_ttl_ms / 1000,
        dome_api_configured: !!DOME_API_KEY,
        min_trades_for_vwap: CONFIG.min_trades_for_vwap,
        vwap_windows: CONFIG.vwap_windows,
      }),
      { headers: corsHeaders }
    );
  }

  // GET / - Basic info
  if (url.pathname === "/") {
    return new Response(
      JSON.stringify({
        name: "Bellwether Live Data Server",
        version: "3.0.0-tiered",
        description: "Tiered pricing: 6h VWAP → 12h/24h VWAP → Orderbook midpoint → Stale VWAP",
        endpoints: {
          "/health": "Server health check",
          "/api/metrics/:platform/:token_id": "Get tiered price + robustness for a single-platform market",
          "/api/metrics/combined": "Get cross-platform tiered price + min robustness (query: pm_token, k_ticker)",
        },
        price_tiers: {
          1: "6h VWAP (10+ trades) - Full reportability",
          2: "12h/24h VWAP (10+ trades) - Reportability downgraded one level",
          3: "Order book midpoint - Capped at Caution",
          4: "Last known VWAP (stale) - Always Fragile",
        },
      }),
      { headers: corsHeaders }
    );
  }

  // GET /api/metrics/:platform/:token_id
  const metricsMatch = url.pathname.match(/^\/api\/metrics\/(polymarket|kalshi)\/(.+)$/);
  if (metricsMatch) {
    const platform = metricsMatch[1];
    const tokenId = metricsMatch[2];

    const metrics = await getMarketMetrics(platform, tokenId);

    if (!metrics) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch market data",
          hint: "Check that the token_id is valid and the platform is correct"
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(metrics), { headers: corsHeaders });
  }

  // GET /api/metrics/combined - Cross-platform tiered price and min robustness
  if (url.pathname === "/api/metrics/combined") {
    const pmToken = url.searchParams.get("pm_token");
    const kTicker = url.searchParams.get("k_ticker");

    if (!pmToken && !kTicker) {
      return new Response(
        JSON.stringify({
          error: "Missing parameters",
          hint: "Provide at least one of: pm_token, k_ticker"
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Fetch orderbooks from both platforms in parallel
    const [pmOrderbook, kOrderbook] = await Promise.all([
      pmToken ? fetchOrderbook("polymarket", pmToken) : null,
      kTicker ? fetchOrderbook("kalshi", kTicker) : null,
    ]);

    const pmBids = pmOrderbook?.[0] || [];
    const pmAsks = pmOrderbook?.[1] || [];
    const kBids = kOrderbook?.[0] || [];
    const kAsks = kOrderbook?.[1] || [];

    // Compute tiered price across platforms
    const tieredPrice = await computeCrossplatformTieredPrice(
      pmToken, kTicker, pmBids, pmAsks, kBids, kAsks
    );

    // Use minimum robustness (weakest link)
    const pmCost = pmAsks.length > 0 ? computeCostToMove5Cents(pmAsks) : null;
    const kCost = kAsks.length > 0 ? computeCostToMove5Cents(kAsks) : null;

    let minCost: number | null = null;
    let weakestPlatform = "unknown";

    if (pmCost !== null && kCost !== null) {
      minCost = Math.min(pmCost, kCost);
      weakestPlatform = pmCost <= kCost ? "polymarket" : "kalshi";
    } else if (pmCost !== null) {
      minCost = pmCost;
      weakestPlatform = "polymarket";
    } else if (kCost !== null) {
      minCost = kCost;
      weakestPlatform = "kalshi";
    }

    const rawReportability = getBaseReportability(minCost);

    // Adjust reportability based on tier
    let reportability: Reportability;
    if (tieredPrice.tier === 1) {
      reportability = rawReportability;
    } else if (tieredPrice.tier === 2) {
      reportability = downgradeReportability(rawReportability);
    } else if (tieredPrice.tier === 3) {
      reportability = capReportability(rawReportability, "caution");
    } else {
      reportability = "fragile";
    }

    // Get current prices from each platform
    let pmCurrentPrice: number | null = null;
    let kCurrentPrice: number | null = null;

    if (pmToken) {
      const pmTrades = await fetchTrades("polymarket", pmToken, 24);
      if (pmTrades.length > 0) {
        pmCurrentPrice = [...pmTrades].sort((a, b) => b.timestamp - a.timestamp)[0].price;
      }
    }
    if (kTicker) {
      const kTrades = await fetchTrades("kalshi", kTicker, 24);
      if (kTrades.length > 0) {
        kCurrentPrice = [...kTrades].sort((a, b) => b.timestamp - a.timestamp)[0].price;
      }
    }

    const combined = {
      bellwether_price: tieredPrice.price,
      price_tier: tieredPrice.tier,
      price_label: tieredPrice.label,
      price_source: tieredPrice.source,
      platform_prices: {
        polymarket: pmCurrentPrice,
        kalshi: kCurrentPrice,
      },
      robustness: {
        cost_to_move_5c: minCost,
        reportability,
        raw_reportability: rawReportability,
        weakest_platform: weakestPlatform,
      },
      vwap_details: {
        window_hours: tieredPrice.window_hours,
        trade_count: tieredPrice.trade_count,
        total_volume: tieredPrice.total_volume,
      },
      orderbook_midpoint: computeOrderbookMidpoint(
        [...pmBids, ...kBids].sort((a, b) => b.price - a.price),
        [...pmAsks, ...kAsks].sort((a, b) => a.price - b.price)
      ),
      fetched_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(combined), { headers: corsHeaders });
  }

  // Legacy endpoint support
  const legacyMatch = url.pathname.match(/^\/metrics\/(.+)$/);
  if (legacyMatch) {
    const tokenId = legacyMatch[1];
    const metrics = await getMarketMetrics("polymarket", tokenId);

    if (!metrics) {
      return new Response(
        JSON.stringify({ error: "Market not found" }),
        { status: 404, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(metrics), { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: "Not found",
      available_endpoints: ["/", "/health", "/api/metrics/:platform/:token_id", "/api/metrics/combined"]
    }),
    { status: 404, headers: corsHeaders }
  );
}

// Start HTTP server
Deno.serve({ port: 8000 }, handleRequest);
