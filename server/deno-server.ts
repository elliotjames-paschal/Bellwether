/**
 * Bellwether Live Data Server (Deno Deploy version)
 *
 * Features:
 * 1. Manipulation Cost: Simulates "$100K buy", reports price impact
 * 2. 6-Hour VWAP: Volume-weighted average price (Duffie method)
 * 3. Adaptive rate limiting: Backs off when API is busy
 *
 * Deploy: https://dash.deno.com
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DOME_API_KEY = Deno.env.get("DOME_API_KEY") || "";
const DOME_REST_BASE = "https://api.domeapi.io/v1";

const CONFIG = {
  tiers: {
    tier1: {
      max_markets: 50,
      poll_interval_ms: 60000,  // Every 60 seconds
    },
    tier2: {
      max_markets: 500,
      poll_interval_ms: 300000, // Every 5 minutes
    },
  },
  vwap_window_hours: 6,
  manipulation_test_amount: 100000, // $100K
  tier1_markets: [] as Market[],
  tier2_markets: [] as Market[],
};

interface Market {
  label: string;
  platform: string;
  token_id: string;
  condition_id?: string;
  volume: number;
}

interface OrderbookData {
  bids: number[][];
  asks: number[][];
  timestamp: number;
  midpoint: number | null;
}

interface TradeData {
  price: number;
  size: number;
  timestamp: number;
}

interface ManipulationResult {
  price_impact_cents: number | null;
  volume_consumed: number;
  levels_consumed: number;
  dollars_spent: number;
}

// =============================================================================
// CACHE
// =============================================================================

const cache: {
  orderbooks: Record<string, OrderbookData>;
  trades: Record<string, TradeData[]>;
  computed_metrics: Record<string, {
    label?: string;
    manipulation_cost?: ManipulationResult;
    vwap_6h?: number | null;
    updated_at?: number;
    tier?: string;
  }>;
} = {
  orderbooks: {},
  trades: {},
  computed_metrics: {},
};

// =============================================================================
// ADAPTIVE RATE LIMITING
// =============================================================================

const rateLimiter = {
  currentDelayMs: 50,
  minDelayMs: 50,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  restoreMultiplier: 0.9,
  consecutiveSuccesses: 0,
  consecutiveFailures: 0,
  isBackingOff: false,
};

function recordApiSuccess() {
  rateLimiter.consecutiveSuccesses++;
  rateLimiter.consecutiveFailures = 0;

  if (rateLimiter.consecutiveSuccesses > 10 && rateLimiter.currentDelayMs > rateLimiter.minDelayMs) {
    rateLimiter.currentDelayMs = Math.max(
      rateLimiter.minDelayMs,
      rateLimiter.currentDelayMs * rateLimiter.restoreMultiplier
    );
    if (rateLimiter.isBackingOff) {
      console.log(`[RateLimit] Restoring speed, delay now ${Math.round(rateLimiter.currentDelayMs)}ms`);
    }
    rateLimiter.isBackingOff = false;
  }
}

function recordApiRateLimit() {
  rateLimiter.consecutiveFailures++;
  rateLimiter.consecutiveSuccesses = 0;
  rateLimiter.isBackingOff = true;

  rateLimiter.currentDelayMs = Math.min(
    rateLimiter.maxDelayMs,
    rateLimiter.currentDelayMs * rateLimiter.backoffMultiplier
  );
  console.log(`[RateLimit] Backing off, delay now ${Math.round(rateLimiter.currentDelayMs)}ms`);
}

async function rateLimitedDelay() {
  await new Promise((r) => setTimeout(r, rateLimiter.currentDelayMs));
}

// =============================================================================
// MANIPULATION COST CALCULATION
// =============================================================================

function computeManipulationCost(
  asks: number[][],
  currentMidpoint: number,
  dollarAmount: number
): ManipulationResult {
  if (!asks || asks.length === 0) {
    return { price_impact_cents: null, volume_consumed: 0, levels_consumed: 0, dollars_spent: 0 };
  }

  const sortedAsks = [...asks].sort((a, b) => a[0] - b[0]);

  let remainingDollars = dollarAmount;
  let volumeConsumed = 0;
  let levelsConsumed = 0;
  let lastPrice = currentMidpoint;

  for (const [price, size] of sortedAsks) {
    if (remainingDollars <= 0) break;

    const levelCost = price * size;

    if (levelCost <= remainingDollars) {
      remainingDollars -= levelCost;
      volumeConsumed += size;
      levelsConsumed++;
      lastPrice = price;
    } else {
      const sharesToBuy = remainingDollars / price;
      volumeConsumed += sharesToBuy;
      levelsConsumed++;
      lastPrice = price;
      remainingDollars = 0;
    }
  }

  const priceImpactCents = (lastPrice - currentMidpoint) * 100;

  return {
    price_impact_cents: Math.round(priceImpactCents * 100) / 100,
    volume_consumed: Math.round(volumeConsumed),
    levels_consumed: levelsConsumed,
    dollars_spent: dollarAmount - remainingDollars,
  };
}

// =============================================================================
// 6-HOUR VWAP CALCULATION
// =============================================================================

function computeVWAP(trades: TradeData[], windowHours = 6): number | null {
  if (!trades || trades.length === 0) return null;

  const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;
  const recentTrades = trades.filter((t) => t.timestamp >= cutoffTime);

  if (recentTrades.length === 0) return null;

  let sumPriceVolume = 0;
  let sumVolume = 0;

  for (const trade of recentTrades) {
    sumPriceVolume += trade.price * trade.size;
    sumVolume += trade.size;
  }

  if (sumVolume === 0) return null;

  return sumPriceVolume / sumVolume;
}

// =============================================================================
// DOME API INTEGRATION
// =============================================================================

async function fetchOrderbook(platform: string, tokenId: string): Promise<OrderbookData | null> {
  const endpoint =
    platform === "polymarket"
      ? `${DOME_REST_BASE}/polymarket/orderbooks`
      : `${DOME_REST_BASE}/kalshi/orderbooks`;

  const params = new URLSearchParams({
    [platform === "polymarket" ? "token_id" : "ticker"]: tokenId,
    limit: "1",
  });

  try {
    const response = await fetch(`${endpoint}?${params}`, {
      headers: { Authorization: DOME_API_KEY },
    });

    if (response.status === 429) {
      recordApiRateLimit();
      return null;
    }

    if (!response.ok) {
      console.error(`Orderbook fetch failed: ${response.status}`);
      return null;
    }

    recordApiSuccess();

    const data = await response.json();
    const snapshots = data.snapshots || [];

    if (snapshots.length === 0) return null;

    const latest = snapshots[0];
    return {
      bids: latest.orderbook?.yes || latest.bids || [],
      asks: latest.orderbook?.no || latest.asks || [],
      timestamp: latest.timestamp,
      midpoint: latest.midpoint || null,
    };
  } catch (err) {
    console.error(`Orderbook fetch error: ${err}`);
    recordApiRateLimit();
    return null;
  }
}

async function fetchRecentTrades(
  platform: string,
  tokenId: string,
  hoursBack = 6
): Promise<TradeData[] | null> {
  const endpoint =
    platform === "polymarket"
      ? `${DOME_REST_BASE}/polymarket/candlesticks/${tokenId}`
      : `${DOME_REST_BASE}/kalshi/candlesticks/${tokenId}`;

  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;

  const params = new URLSearchParams({
    interval: "60",
    start_time: String(startTime),
    end_time: String(endTime),
  });

  try {
    const response = await fetch(`${endpoint}?${params}`, {
      headers: { Authorization: DOME_API_KEY },
    });

    if (response.status === 429) {
      recordApiRateLimit();
      return null;
    }

    if (!response.ok) {
      console.error(`Trades fetch failed: ${response.status}`);
      return null;
    }

    recordApiSuccess();

    const data = await response.json();
    const candles = data.candlesticks || data.candles || [];

    return candles.map((c: Record<string, number>) => ({
      price: c.close || c.c || c.p,
      size: c.volume || c.v || 1,
      timestamp: c.timestamp || c.t,
    }));
  } catch (err) {
    console.error(`Trades fetch error: ${err}`);
    recordApiRateLimit();
    return null;
  }
}

// =============================================================================
// POLLING
// =============================================================================

async function pollTier(tierName: string, markets: Market[], type: "orderbook" | "trades") {
  if (!markets || markets.length === 0) return;

  console.log(`[${tierName}] Polling ${type} for ${markets.length} markets...`);

  for (const market of markets) {
    try {
      if (type === "orderbook") {
        const orderbook = await fetchOrderbook(market.platform, market.token_id);
        if (orderbook) {
          cache.orderbooks[market.token_id] = orderbook;

          const manipResult = computeManipulationCost(
            orderbook.asks,
            orderbook.midpoint || 0.5,
            CONFIG.manipulation_test_amount
          );

          if (!cache.computed_metrics[market.token_id]) {
            cache.computed_metrics[market.token_id] = { label: market.label };
          }
          cache.computed_metrics[market.token_id].manipulation_cost = manipResult;
          cache.computed_metrics[market.token_id].updated_at = Date.now();
          cache.computed_metrics[market.token_id].tier = tierName;
        }
      } else if (type === "trades") {
        const trades = await fetchRecentTrades(
          market.platform,
          market.token_id,
          CONFIG.vwap_window_hours
        );
        if (trades) {
          cache.trades[market.token_id] = trades;
          const vwap = computeVWAP(trades, CONFIG.vwap_window_hours);

          if (!cache.computed_metrics[market.token_id]) {
            cache.computed_metrics[market.token_id] = { label: market.label };
          }
          cache.computed_metrics[market.token_id].vwap_6h = vwap;
          cache.computed_metrics[market.token_id].updated_at = Date.now();
        }
      }
    } catch (err) {
      console.error(`[${tierName}] Error polling ${market.token_id}:`, err);
    }

    await rateLimitedDelay();
  }
}

// =============================================================================
// MARKET DATA (Embedded top markets - update via redeploy or fetch from URL)
// =============================================================================

async function loadMarkets() {
  console.log("Loading market configuration...");

  // Option 1: Fetch from your website's active_markets.json
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/elliotjames-paschal/Bellwether/main/data/active_markets.json"
    );
    if (response.ok) {
      const data = await response.json();
      const markets = data.markets || [];

      const sortedMarkets = markets
        .filter((m: Record<string, string>) => m.pm_token_id_yes || m.k_ticker)
        .sort((a: Record<string, number>, b: Record<string, number>) =>
          (b.total_volume || 0) - (a.total_volume || 0)
        );

      CONFIG.tier1_markets = sortedMarkets
        .slice(0, CONFIG.tiers.tier1.max_markets)
        .map((m: Record<string, string | number>) => ({
          label: m.label as string,
          platform: m.pm_token_id_yes ? "polymarket" : "kalshi",
          token_id: (m.pm_token_id_yes || m.k_ticker) as string,
          condition_id: m.pm_condition_id as string,
          volume: m.total_volume as number,
        }));

      CONFIG.tier2_markets = sortedMarkets
        .slice(CONFIG.tiers.tier1.max_markets, CONFIG.tiers.tier1.max_markets + CONFIG.tiers.tier2.max_markets)
        .map((m: Record<string, string | number>) => ({
          label: m.label as string,
          platform: m.pm_token_id_yes ? "polymarket" : "kalshi",
          token_id: (m.pm_token_id_yes || m.k_ticker) as string,
          condition_id: m.pm_condition_id as string,
          volume: m.total_volume as number,
        }));

      console.log(`Loaded ${CONFIG.tier1_markets.length} tier1 + ${CONFIG.tier2_markets.length} tier2 markets`);
      return;
    }
  } catch (err) {
    console.error("Failed to fetch markets from GitHub:", err);
  }

  // Option 2: Fallback to hardcoded top markets
  console.log("Using fallback hardcoded markets");
  CONFIG.tier1_markets = [
    // Add a few key markets as fallback
    {
      label: "2028 US Presidential Election",
      platform: "polymarket",
      token_id: "21742633143463906290569050155826241533067272736897614950488156847949938836455",
      volume: 600000000,
    },
  ];
}

// =============================================================================
// HTTP HANDLER
// =============================================================================

function handleRequest(request: Request): Response {
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

  // GET /metrics - All computed metrics
  if (url.pathname === "/metrics" || url.pathname === "/api/metrics") {
    const timestamps = Object.values(cache.computed_metrics)
      .map((m) => m.updated_at || 0)
      .filter((t) => t > 0);
    const oldestUpdate = timestamps.length > 0 ? Math.min(...timestamps) : 0;
    const cacheAgeMs = oldestUpdate > 0 ? Date.now() - oldestUpdate : 0;

    return new Response(
      JSON.stringify({
        generated_at: new Date().toISOString(),
        cache_age_seconds: Math.round(cacheAgeMs / 1000),
        manipulation_test_amount: CONFIG.manipulation_test_amount,
        vwap_window_hours: CONFIG.vwap_window_hours,
        markets_count: Object.keys(cache.computed_metrics).length,
        markets: cache.computed_metrics,
      }),
      { headers: corsHeaders }
    );
  }

  // GET /metrics/:token_id - Single market
  const marketMatch = url.pathname.match(/^\/(?:api\/)?metrics\/(.+)$/);
  if (marketMatch) {
    const tokenId = marketMatch[1];
    const metrics = cache.computed_metrics[tokenId];

    if (!metrics) {
      return new Response(JSON.stringify({ error: "Market not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        token_id: tokenId,
        ...metrics,
      }),
      { headers: corsHeaders }
    );
  }

  // GET /health
  if (url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        markets_tracked: {
          tier1: CONFIG.tier1_markets.length,
          tier2: CONFIG.tier2_markets.length,
        },
        cache_size: Object.keys(cache.computed_metrics).length,
        rate_limiter: {
          current_delay_ms: Math.round(rateLimiter.currentDelayMs),
          is_backing_off: rateLimiter.isBackingOff,
          status: rateLimiter.isBackingOff ? "backing_off" : "normal",
        },
      }),
      { headers: corsHeaders }
    );
  }

  // GET / - Basic info
  if (url.pathname === "/") {
    return new Response(
      JSON.stringify({
        name: "Bellwether Live Data Server",
        endpoints: ["/metrics", "/metrics/:token_id", "/health"],
        docs: "https://github.com/elliotjames-paschal/Bellwether",
      }),
      { headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: corsHeaders,
  });
}

// =============================================================================
// STARTUP
// =============================================================================

async function startPolling() {
  console.log("==========================================");
  console.log("  Bellwether Live Data Server (Deno)");
  console.log("==========================================");

  if (!DOME_API_KEY) {
    console.error("ERROR: DOME_API_KEY environment variable not set!");
    console.error("Set it in Deno Deploy dashboard under Settings > Environment Variables");
  }

  await loadMarkets();

  // Initial poll
  console.log("\nInitial data fetch...");
  await pollTier("tier1", CONFIG.tier1_markets, "orderbook");
  await pollTier("tier1", CONFIG.tier1_markets, "trades");

  // Set up polling intervals
  setInterval(() => pollTier("tier1", CONFIG.tier1_markets, "orderbook"), CONFIG.tiers.tier1.poll_interval_ms);
  setInterval(() => pollTier("tier1", CONFIG.tier1_markets, "trades"), CONFIG.tiers.tier1.poll_interval_ms);
  setInterval(() => pollTier("tier2", CONFIG.tier2_markets, "orderbook"), CONFIG.tiers.tier2.poll_interval_ms);
  setInterval(() => pollTier("tier2", CONFIG.tier2_markets, "trades"), CONFIG.tiers.tier2.poll_interval_ms);

  console.log("\n==========================================");
  console.log("  Polling started!");
  console.log(`  Tier 1: ${CONFIG.tier1_markets.length} markets @ 60s`);
  console.log(`  Tier 2: ${CONFIG.tier2_markets.length} markets @ 5min`);
  console.log("==========================================\n");
}

// Start polling in background
startPolling();

// Start HTTP server
Deno.serve({ port: 8000 }, handleRequest);
