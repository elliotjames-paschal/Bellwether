/**
 * Bellwether Live Data Server (Deno Deploy - Serverless version)
 *
 * Features:
 * 1. Manipulation Cost: Simulates "$100K buy", reports price impact
 * 2. 6-Hour VWAP: Volume-weighted average price (Duffie method)
 * 3. On-demand fetching with Deno KV caching
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
  manipulation_test_amount: 100000, // $100K
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

interface ManipulationResult {
  price_impact_cents: number | null;
  volume_consumed: number;
  levels_consumed: number;
  dollars_spent: number;
  starting_price: number | null;
  ending_price: number | null;
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
  manipulation_cost: ManipulationResult;
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

  const endpoint = platform === "kalshi"
    ? `${DOME_REST_BASE}/kalshi/orderbook/${tokenId}`
    : `${DOME_REST_BASE}/polymarket/orderbook/${tokenId}`;

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${DOME_API_KEY}` },
    });

    if (!response.ok) {
      console.error(`Orderbook fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Parse orderbook - format varies by platform
    const bids: OrderbookLevel[] = [];
    const asks: OrderbookLevel[] = [];

    if (data.bids) {
      for (const bid of data.bids) {
        bids.push({ price: Number(bid.price || bid[0]), size: Number(bid.size || bid[1]) });
      }
    }
    if (data.asks) {
      for (const ask of data.asks) {
        asks.push({ price: Number(ask.price || ask[0]), size: Number(ask.size || ask[1]) });
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

  // Use candlestick endpoint for trade history
  const now = Math.floor(Date.now() / 1000);
  const sixHoursAgo = now - (6 * 60 * 60);

  const endpoint = platform === "kalshi"
    ? `${DOME_REST_BASE}/kalshi/candlesticks/${tokenId}?interval=1m&from=${sixHoursAgo}&to=${now}`
    : `${DOME_REST_BASE}/polymarket/candlesticks/${tokenId}?interval=1m&from=${sixHoursAgo}&to=${now}`;

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${DOME_API_KEY}` },
    });

    if (!response.ok) {
      console.error(`Trades fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Convert candlesticks to trades (using close price and volume)
    const trades: Array<{price: number, size: number, timestamp: number}> = [];

    if (Array.isArray(data)) {
      for (const candle of data) {
        if (candle.volume > 0) {
          trades.push({
            price: Number(candle.close || candle.c),
            size: Number(candle.volume || candle.v),
            timestamp: Number(candle.timestamp || candle.t) * 1000,
          });
        }
      }
    }

    return trades;
  } catch (err) {
    console.error(`Trades fetch error: ${err}`);
    return null;
  }
}

// =============================================================================
// CALCULATION FUNCTIONS
// =============================================================================

function computeManipulationCost(bids: OrderbookLevel[], asks: OrderbookLevel[], testAmount: number): ManipulationResult {
  // Simulate a BUY order walking through asks
  let remaining = testAmount;
  let spent = 0;
  let volumeConsumed = 0;
  let levelsConsumed = 0;
  let startingPrice: number | null = null;
  let endingPrice: number | null = null;

  if (asks.length === 0) {
    return {
      price_impact_cents: null,
      volume_consumed: 0,
      levels_consumed: 0,
      dollars_spent: 0,
      starting_price: null,
      ending_price: null,
    };
  }

  startingPrice = asks[0].price;

  for (const ask of asks) {
    if (remaining <= 0) break;

    const levelCost = ask.price * ask.size;

    if (levelCost <= remaining) {
      // Consume entire level
      spent += levelCost;
      volumeConsumed += ask.size;
      remaining -= levelCost;
      levelsConsumed++;
      endingPrice = ask.price;
    } else {
      // Partial fill
      const sharesToBuy = remaining / ask.price;
      spent += remaining;
      volumeConsumed += sharesToBuy;
      remaining = 0;
      levelsConsumed++;
      endingPrice = ask.price;
    }
  }

  const priceImpact = (startingPrice && endingPrice)
    ? Math.round((endingPrice - startingPrice) * 100) // in cents
    : null;

  return {
    price_impact_cents: priceImpact,
    volume_consumed: Math.round(volumeConsumed),
    levels_consumed: levelsConsumed,
    dollars_spent: Math.round(spent),
    starting_price: startingPrice,
    ending_price: endingPrice,
  };
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
  const manipulationCost = computeManipulationCost(bids, asks, CONFIG.manipulation_test_amount);
  const vwap = computeVWAP(trades || []);

  const metrics: MarketMetrics = {
    token_id: tokenId,
    platform,
    manipulation_cost: manipulationCost,
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
          "/api/metrics/:platform/:token_id": "Get manipulation cost + VWAP for a market",
        },
        example: "/api/metrics/polymarket/21742633143463906290569050155826241533067272736897614950488156847949938836455",
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
      available_endpoints: ["/", "/health", "/api/metrics/:platform/:token_id"]
    }),
    { status: 404, headers: corsHeaders }
  );
}

// Start HTTP server
Deno.serve({ port: 8000 }, handleRequest);
