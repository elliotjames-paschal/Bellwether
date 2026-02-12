/**
 * Bellwether Live Data Server (Cloudflare Workers version)
 *
 * Tiered Pricing System:
 * - Tier 1: 6h VWAP (10+ trades) - Full reportability
 * - Tier 2: 12h/24h VWAP (10+ trades) - Reportability downgraded one level
 * - Tier 3: Order book midpoint (no trades) - Capped at Caution
 * - Tier 4: Last known VWAP (stale) - Always Fragile
 *
 * Deploy: npx wrangler deploy
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DOME_REST_BASE = "https://api.domeapi.io/v1";

const CONFIG = {
  cache_ttl_ms: 300000, // 5 minutes cache TTL
  min_trades_for_vwap: 10,
  vwap_windows: [6, 12, 24],
};

// =============================================================================
// DOME API FUNCTIONS
// =============================================================================

async function fetchOrderbook(platform, tokenId, apiKey) {
  if (!apiKey) {
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
      headers: { Authorization: `Bearer ${apiKey}` },
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

    const bids = [];
    const asks = [];

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

async function fetchTrades(platform, tokenId, windowHours, apiKey) {
  if (!apiKey) return [];

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - (windowHours * 60 * 60);

  let endpoint;
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
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      console.log(`Trades fetch returned ${response.status}, using empty trades`);
      return [];
    }

    const data = await response.json();
    const trades = [];

    const tradeList = Array.isArray(data) ? data : (data.trades || data.orders || data.data || []);

    const startMs = startSec * 1000;

    for (const trade of tradeList) {
      const price = Number(trade.price || trade.p || trade.yes_price_dollars);
      const size = Number(trade.shares_normalized || trade.shares || trade.size || trade.amount || trade.s || trade.count || 1);
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

function computeVWAP(trades) {
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

// Cost to push price UP 5 cents (buying into asks)
function computeCostToMoveUp5Cents(asks) {
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

  return null; // Not enough depth
}

// Cost to push price DOWN 5 cents (selling into bids)
function computeCostToMoveDown5Cents(bids) {
  if (bids.length === 0) return null;

  const startingPrice = bids[0].price; // Best bid (highest)
  const targetPrice = startingPrice - 0.05;

  let value = 0; // Value of shares we need to sell

  for (const bid of bids) {
    if (bid.price <= targetPrice) {
      return Math.round(value);
    }
    const levelValue = bid.price * bid.size;
    value += levelValue;
  }

  return null; // Not enough depth
}

// Returns minimum cost to move price 5 cents in EITHER direction
// This is the vulnerability - manipulator picks the cheaper direction
function computeCostToMove5Cents(bids, asks) {
  const costUp = computeCostToMoveUp5Cents(asks);
  const costDown = computeCostToMoveDown5Cents(bids);

  if (costUp === null && costDown === null) return null;
  if (costUp === null) return costDown;
  if (costDown === null) return costUp;
  return Math.min(costUp, costDown);
}

function computeOrderbookMidpoint(bids, asks) {
  if (bids.length === 0 || asks.length === 0) return null;
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  return Math.round(((bestBid + bestAsk) / 2) * 10000) / 10000;
}

function getBaseReportability(costToMove5c) {
  if (costToMove5c === null || costToMove5c < 10000) return "fragile";
  if (costToMove5c < 100000) return "caution";
  return "reportable";
}

function downgradeReportability(r) {
  if (r === "reportable") return "caution";
  if (r === "caution") return "fragile";
  return "fragile";
}

function capReportability(r, maxLevel) {
  const levels = ["fragile", "caution", "reportable"];
  const currentIdx = levels.indexOf(r);
  const maxIdx = levels.indexOf(maxLevel);
  return levels[Math.min(currentIdx, maxIdx)];
}

// =============================================================================
// CACHE FUNCTIONS (using Cloudflare KV)
// =============================================================================

async function getCachedMetrics(kv, tokenId) {
  if (!kv) return null;

  try {
    const cached = await kv.get(tokenId, { type: "json" });
    if (!cached) return null;

    const fetchedAt = new Date(cached.fetched_at).getTime();
    if (Date.now() - fetchedAt > CONFIG.cache_ttl_ms) {
      return null;
    }

    return { ...cached, cached: true };
  } catch (err) {
    console.error("Cache read error:", err);
    return null;
  }
}

async function cacheMetrics(kv, tokenId, metrics) {
  if (!kv) return;

  try {
    await kv.put(tokenId, JSON.stringify(metrics), {
      expirationTtl: Math.ceil(CONFIG.cache_ttl_ms / 1000),
    });
  } catch (err) {
    console.error("Cache write error:", err);
  }
}

async function getStaleVWAP(kv, key) {
  if (!kv) return null;

  try {
    return await kv.get(`stale_${key}`, { type: "json" });
  } catch (err) {
    return null;
  }
}

async function storeStaleVWAP(kv, key, price, windowHours, tradeCount) {
  if (!kv) return;

  try {
    const stale = {
      price,
      window_hours: windowHours,
      trade_count: tradeCount,
      stored_at: new Date().toISOString(),
    };
    // Store for 7 days
    await kv.put(`stale_${key}`, JSON.stringify(stale), { expirationTtl: 604800 });
  } catch (err) {
    console.error("Stale VWAP store error:", err);
  }
}

// =============================================================================
// TIERED PRICE CALCULATION
// =============================================================================

async function computeTieredPrice(platform, tokenId, bids, asks, apiKey, kv) {
  // Fetch 24h trades once, then filter for smaller windows in memory
  const allTrades = await fetchTrades(platform, tokenId, 24, apiKey);
  const now = Date.now();

  // Try progressively larger windows by filtering the same trade data
  for (const windowHours of CONFIG.vwap_windows) {
    const cutoff = now - (windowHours * 60 * 60 * 1000);
    const windowTrades = allTrades.filter(t => t.timestamp >= cutoff);
    const vwapResult = computeVWAP(windowTrades);

    if (vwapResult.trade_count >= CONFIG.min_trades_for_vwap) {
      // Success! Store this as the last known good VWAP
      await storeStaleVWAP(kv, tokenId, vwapResult.vwap, windowHours, vwapResult.trade_count);

      const tier = windowHours === 6 ? 1 : 2;
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
  const stale = await getStaleVWAP(kv, tokenId);
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

async function computeCrossplatformTieredPrice(pmToken, kTicker, pmBids, pmAsks, kBids, kAsks, apiKey, kv) {
  // Combine orderbooks for midpoint calculation
  const allBids = [...pmBids, ...kBids].sort((a, b) => b.price - a.price);
  const allAsks = [...pmAsks, ...kAsks].sort((a, b) => a.price - b.price);

  const cacheKey = `${pmToken || ""}_${kTicker || ""}`;

  // Fetch 24h trades once from each platform, then filter for smaller windows
  const allTrades = [];
  if (pmToken) {
    const pmTrades = await fetchTrades("polymarket", pmToken, 24, apiKey);
    allTrades.push(...pmTrades);
  }
  if (kTicker) {
    const kTrades = await fetchTrades("kalshi", kTicker, 24, apiKey);
    allTrades.push(...kTrades);
  }

  const now = Date.now();

  // Try progressively larger windows by filtering the same trade data
  for (const windowHours of CONFIG.vwap_windows) {
    const cutoff = now - (windowHours * 60 * 60 * 1000);
    const windowTrades = allTrades.filter(t => t.timestamp >= cutoff);
    const vwapResult = computeVWAP(windowTrades);

    if (vwapResult.trade_count >= CONFIG.min_trades_for_vwap) {
      await storeStaleVWAP(kv, cacheKey, vwapResult.vwap, windowHours, vwapResult.trade_count);

      const tier = windowHours === 6 ? 1 : 2;
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
  const stale = await getStaleVWAP(kv, cacheKey);
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
// MAIN FETCH FUNCTION
// =============================================================================

async function getMarketMetrics(platform, tokenId, apiKey, kv) {
  const cached = await getCachedMetrics(kv, tokenId);
  if (cached) {
    return cached;
  }

  const orderbook = await fetchOrderbook(platform, tokenId, apiKey);
  if (!orderbook) {
    return null;
  }

  const [bids, asks] = orderbook;

  // Compute tiered price
  const tieredPrice = await computeTieredPrice(platform, tokenId, bids, asks, apiKey, kv);

  // Compute robustness (min of up and down directions)
  const costToMove5c = computeCostToMove5Cents(bids, asks);
  const rawReportability = getBaseReportability(costToMove5c);

  // Adjust reportability based on tier
  let reportability;
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
  const recentTrades = await fetchTrades(platform, tokenId, 24, apiKey);
  let currentPrice = null;
  if (recentTrades.length > 0) {
    const sortedTrades = [...recentTrades].sort((a, b) => b.timestamp - a.timestamp);
    currentPrice = sortedTrades[0].price;
  }

  const midpoint = computeOrderbookMidpoint(bids, asks);

  const metrics = {
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

  await cacheMetrics(kv, tokenId, metrics);

  return metrics;
}

// =============================================================================
// HTTP HANDLER (Cloudflare Workers format)
// =============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const apiKey = env.DOME_API_KEY || "";
    const kv = env.BELLWETHER_KV || null;

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
          mode: "cloudflare-workers",
          cache_ttl_seconds: CONFIG.cache_ttl_ms / 1000,
          dome_api_configured: !!apiKey,
          kv_configured: !!kv,
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
          version: "3.0.0-cloudflare",
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

      const metrics = await getMarketMetrics(platform, tokenId, apiKey, kv);

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
        pmToken ? fetchOrderbook("polymarket", pmToken, apiKey) : null,
        kTicker ? fetchOrderbook("kalshi", kTicker, apiKey) : null,
      ]);

      const pmBids = pmOrderbook?.[0] || [];
      const pmAsks = pmOrderbook?.[1] || [];
      const kBids = kOrderbook?.[0] || [];
      const kAsks = kOrderbook?.[1] || [];

      // Compute tiered price across platforms
      const tieredPrice = await computeCrossplatformTieredPrice(
        pmToken, kTicker, pmBids, pmAsks, kBids, kAsks, apiKey, kv
      );

      // Use minimum robustness (weakest link across platforms AND directions)
      const pmCost = (pmBids.length > 0 || pmAsks.length > 0) ? computeCostToMove5Cents(pmBids, pmAsks) : null;
      const kCost = (kBids.length > 0 || kAsks.length > 0) ? computeCostToMove5Cents(kBids, kAsks) : null;

      let minCost = null;
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
      let reportability;
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
      let pmCurrentPrice = null;
      let kCurrentPrice = null;

      if (pmToken) {
        const pmTrades = await fetchTrades("polymarket", pmToken, 24, apiKey);
        if (pmTrades.length > 0) {
          pmCurrentPrice = [...pmTrades].sort((a, b) => b.timestamp - a.timestamp)[0].price;
        }
      }
      if (kTicker) {
        const kTrades = await fetchTrades("kalshi", kTicker, 24, apiKey);
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
      const metrics = await getMarketMetrics("polymarket", tokenId, apiKey, kv);

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
  },
};
