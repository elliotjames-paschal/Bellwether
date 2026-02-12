/**
 * Bellwether Live Data Server (Deno Deploy - Serverless version)
 *
 * Features:
 * 1. Robustness Score: Cost to move price 5 cents (reportable/caution/fragile)
 * 2. 6-Hour VWAP: Volume-weighted average price (Bellwether price)
 * 3. Cross-platform combined metrics for PM + Kalshi
 * 4. On-demand fetching with Deno KV caching
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
  vwap_window_hours: 6,
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

interface RobustnessResult {
  cost_to_move_5c: number | null;  // Dollar amount needed to move price 5 cents
  reportability: "reportable" | "caution" | "fragile";
}

interface VWAPResult {
  vwap: number | null;
  trade_count: number;
  total_volume: number;
  window_hours: number;
}

interface MarketMetrics {
  token_id: string;
  platform: string;
  current_price: number | null;  // Last trade price (spot)
  bellwether_price: number | null;  // 6h VWAP
  robustness: RobustnessResult;
  vwap_6h: VWAPResult;
  fetched_at: string;
  cached: boolean;
}

// =============================================================================
// DOME API FUNCTIONS
// =============================================================================

async function fetchOrderbook(platform: string, tokenId: string): Promise<OrderbookLevel[][] | null> {
  if (!DOME_API_KEY) {
    console.error("No DOME_API_KEY set");
    return null;
  }

  // Fetch CURRENT orderbook (no time params = latest snapshot)
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

    // Parse orderbook from the response
    // Response format: { snapshots: [...], pagination: {...} }
    const snapshots = data.snapshots || data.data || (Array.isArray(data) ? data : []);
    if (snapshots.length === 0) {
      console.error("No orderbook snapshots returned");
      return null;
    }

    const latestSnapshot = snapshots[0];

    const bids: OrderbookLevel[] = [];
    const asks: OrderbookLevel[] = [];

    // Dome API format differs by platform:
    // Polymarket: { bids: [...], asks: [...] }
    // Kalshi: { yes_bids: [...], yes_asks: [...], no_bids: [...], no_asks: [...] }
    // Prices are already in dollars (e.g., 0.999)
    const rawBids = latestSnapshot.bids || latestSnapshot.yes_bids || [];
    const rawAsks = latestSnapshot.asks || latestSnapshot.yes_asks || [];

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

    // Sort: bids descending, asks ascending
    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    return [bids, asks];
  } catch (err) {
    console.error(`Orderbook fetch error: ${err}`);
    return null;
  }
}

async function fetchTrades(platform: string, tokenId: string): Promise<Array<{price: number, size: number, timestamp: number}> | null> {
  if (!DOME_API_KEY) return null;

  // Both platforms use seconds for timestamps per Dome API docs
  // Kalshi: /trades endpoint, Polymarket: /orders endpoint
  const nowSec = Math.floor(Date.now() / 1000);
  const sixHoursAgoSec = nowSec - (6 * 60 * 60);

  let endpoint: string;
  const params = new URLSearchParams();

  if (platform === "kalshi") {
    params.set("ticker", tokenId);
    params.set("start_time", sixHoursAgoSec.toString());
    params.set("end_time", nowSec.toString());
    endpoint = `${DOME_REST_BASE}/kalshi/trades?${params}`;
  } else {
    // Polymarket uses /orders endpoint, timestamps in seconds
    params.set("token_id", tokenId);
    params.set("start_time", sixHoursAgoSec.toString());
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
    const trades: Array<{price: number, size: number, timestamp: number}> = [];

    const tradeList = Array.isArray(data) ? data : (data.trades || data.orders || data.data || []);

    for (const trade of tradeList) {
      // Price: Dome returns in decimal (0-1) format
      const price = Number(trade.price || trade.p);
      const size = Number(trade.size || trade.amount || trade.s || 1);

      // Normalize timestamp to milliseconds for internal use
      let timestamp = Number(trade.timestamp || trade.t || trade.time || trade.created_at);
      if (timestamp < 1e12) {
        // Timestamp is in seconds, convert to ms
        timestamp = timestamp * 1000;
      }

      const sixHoursAgoMs = sixHoursAgoSec * 1000;
      if (price > 0 && timestamp >= sixHoursAgoMs) {
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

/**
 * Compute the dollar amount needed to move the price 5 cents (0.05) by walking through asks.
 * Returns null if there's not enough orderbook depth.
 */
function computeCostToMove5Cents(asks: OrderbookLevel[]): number | null {
  if (asks.length === 0) return null;

  const startingPrice = asks[0].price;
  const targetPrice = startingPrice + 0.05;  // 5 cents higher

  let spent = 0;

  for (const ask of asks) {
    if (ask.price >= targetPrice) {
      // We've reached the target price movement
      return Math.round(spent);
    }

    // Consume this entire level
    const levelCost = ask.price * ask.size;
    spent += levelCost;
  }

  // Not enough depth to move 5 cents
  return null;
}

/**
 * Determine reportability label based on cost to move price 5 cents.
 * - Reportable: >= $100K (robust enough for news)
 * - Caution: $10K - $100K (use with care)
 * - Fragile: < $10K (easily manipulated)
 */
function getReportabilityLabel(costToMove5c: number | null): "reportable" | "caution" | "fragile" {
  if (costToMove5c === null || costToMove5c < 10000) return "fragile";
  if (costToMove5c < 100000) return "caution";
  return "reportable";
}

function computeVWAP(trades: Array<{price: number, size: number, timestamp: number}>): VWAPResult {
  const sixHoursAgo = Date.now() - (CONFIG.vwap_window_hours * 60 * 60 * 1000);

  const recentTrades = trades.filter(t => t.timestamp >= sixHoursAgo);

  if (recentTrades.length === 0) {
    return {
      vwap: null,
      trade_count: 0,
      total_volume: 0,
      window_hours: CONFIG.vwap_window_hours,
    };
  }

  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const trade of recentTrades) {
    sumPriceVolume += trade.price * trade.size;
    sumVolume += trade.size;
  }

  return {
    vwap: sumVolume > 0 ? Math.round((sumPriceVolume / sumVolume) * 10000) / 10000 : null,
    trade_count: recentTrades.length,
    total_volume: Math.round(sumVolume),
    window_hours: CONFIG.vwap_window_hours,
  };
}

// =============================================================================
// CACHE FUNCTIONS
// =============================================================================

async function getCachedMetrics(tokenId: string): Promise<MarketMetrics | null> {
  const result = await kv.get<MarketMetrics>(["metrics", tokenId]);

  if (!result.value) return null;

  // Check if cache is still valid
  const fetchedAt = new Date(result.value.fetched_at).getTime();
  if (Date.now() - fetchedAt > CONFIG.cache_ttl_ms) {
    return null; // Cache expired
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
  // Check cache first
  const cached = await getCachedMetrics(tokenId);
  if (cached) {
    return cached;
  }

  // Fetch fresh data
  const [orderbook, trades] = await Promise.all([
    fetchOrderbook(platform, tokenId),
    fetchTrades(platform, tokenId),
  ]);

  if (!orderbook) {
    return null;
  }

  const [bids, asks] = orderbook;
  const costToMove5c = computeCostToMove5Cents(asks);
  const reportability = getReportabilityLabel(costToMove5c);
  const vwap = computeVWAP(trades || []);

  // Get last trade price (most recent trade)
  let currentPrice: number | null = null;
  if (trades && trades.length > 0) {
    // Sort by timestamp descending to get most recent
    const sortedTrades = [...trades].sort((a, b) => b.timestamp - a.timestamp);
    currentPrice = sortedTrades[0].price;
  }

  const metrics: MarketMetrics = {
    token_id: tokenId,
    platform,
    current_price: currentPrice,
    bellwether_price: vwap.vwap,
    robustness: {
      cost_to_move_5c: costToMove5c,
      reportability,
    },
    vwap_6h: vwap,
    fetched_at: new Date().toISOString(),
    cached: false,
  };

  // Cache the result
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
      }),
      { headers: corsHeaders }
    );
  }

  // GET / - Basic info
  if (url.pathname === "/") {
    return new Response(
      JSON.stringify({
        name: "Bellwether Live Data Server",
        version: "2.0.0-serverless",
        endpoints: {
          "/health": "Server health check",
          "/api/metrics/:platform/:token_id": "Get robustness + VWAP for a single-platform market",
          "/api/metrics/combined": "Get cross-platform VWAP + min robustness (query: pm_token, k_ticker)",
        },
        example: "/api/metrics/polymarket/21742633143463906290569050155826241533067272736897614950488156847949938836455",
        example_combined: "/api/metrics/combined?pm_token=XXX&k_ticker=YYY",
        docs: "https://github.com/elliotjames-paschal/Bellwether",
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

  // GET /api/metrics/combined - Cross-platform VWAP and min robustness
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

    // Fetch metrics from both platforms in parallel
    const [pmMetrics, kMetrics] = await Promise.all([
      pmToken ? getMarketMetrics("polymarket", pmToken) : null,
      kTicker ? getMarketMetrics("kalshi", kTicker) : null,
    ]);

    // Combine trades for cross-platform VWAP
    const allTrades: Array<{price: number, size: number, timestamp: number}> = [];

    if (pmToken) {
      const pmTrades = await fetchTrades("polymarket", pmToken);
      if (pmTrades) allTrades.push(...pmTrades);
    }
    if (kTicker) {
      const kTrades = await fetchTrades("kalshi", kTicker);
      if (kTrades) allTrades.push(...kTrades);
    }

    const combinedVwap = computeVWAP(allTrades);

    // Use minimum robustness (weakest link)
    const pmCost = pmMetrics?.robustness?.cost_to_move_5c ?? Infinity;
    const kCost = kMetrics?.robustness?.cost_to_move_5c ?? Infinity;
    const minCost = Math.min(pmCost, kCost);
    const costToMove5c = minCost === Infinity ? null : minCost;
    const reportability = getReportabilityLabel(costToMove5c);

    const combined = {
      bellwether_price: combinedVwap.vwap,
      vwap_label: (pmMetrics && kMetrics) ? "6h VWAP across platforms" : "6h VWAP · single platform",
      platform_prices: {
        polymarket: pmMetrics?.current_price ?? null,
        kalshi: kMetrics?.current_price ?? null,
      },
      robustness: {
        cost_to_move_5c: costToMove5c,
        reportability,
        weakest_platform: pmCost <= kCost ? "polymarket" : "kalshi",
      },
      vwap_6h: combinedVwap,
      fetched_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(combined), { headers: corsHeaders });
  }

  // Legacy endpoint support: /metrics/:token_id (assumes polymarket)
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
