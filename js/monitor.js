/**
 * Market Monitor - Elections + All Political Markets
 *
 * Elections: Cross-platform comparison (PM vs Kalshi)
 * Non-electoral: Individual market cards per platform
 */

(function() {
    'use strict';

    let monitorData = null;
    let allMarkets = [];
    let filteredMarkets = [];
    let currentView = 'biggest_moves';
    let displayCount = 8;
    const CARDS_PER_PAGE = 8;

    // Filter state
    let filters = {
        category: 'all',
        platform: 'all',
        search: ''
    };

    // Review mode state
    let reviewMode = false;
    let selectedMarkets = new Set();

    // Live data configuration
    const LIVE_DATA_SERVER = 'https://bellwether-62.elliotjames-paschal.deno.net';

    // Fetch live data for a single-platform market
    async function fetchLiveData(tokenOrTicker, platform = 'polymarket') {
        if (!tokenOrTicker) return null;

        try {
            const response = await fetch(`${LIVE_DATA_SERVER}/api/metrics/${platform}/${tokenOrTicker}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            console.warn('Live data fetch failed:', e);
            return null;
        }
    }

    // Fetch combined live data for cross-platform markets
    async function fetchCombinedLiveData(pmToken, kTicker) {
        if (!pmToken && !kTicker) return null;

        try {
            const params = new URLSearchParams();
            if (pmToken) params.set('pm_token', pmToken);
            if (kTicker) params.set('k_ticker', kTicker);

            const response = await fetch(`${LIVE_DATA_SERVER}/api/metrics/combined?${params}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            console.warn('Combined live data fetch failed:', e);
            return null;
        }
    }

    // Store live data for cards
    const cardLiveData = new Map();

    // Normalize server response to handle both old and new API formats
    function normalizeServerResponse(data, isCombined = false) {
        if (!data) return null;

        // If already in new format, return as-is
        if (data.robustness && data.bellwether_price !== undefined) {
            return data;
        }

        // Convert old format to new format
        const normalized = {
            bellwether_price: data.vwap_6h?.vwap ?? null,
            vwap_label: isCombined ? '6h VWAP across platforms' : '6h VWAP · single platform',
            current_price: data.current_price ?? null,
            robustness: {
                cost_to_move_5c: data.manipulation_cost?.dollars_spent ?? null,
                reportability: getReportabilityFromCost(data.manipulation_cost?.dollars_spent)
            },
            vwap_6h: data.vwap_6h,
            fetched_at: data.fetched_at
        };

        // For combined data, add platform_prices
        if (isCombined && data.platform_prices) {
            normalized.platform_prices = data.platform_prices;
        }

        return normalized;
    }

    // Compute reportability label from cost (for old server format)
    function getReportabilityFromCost(cost) {
        if (cost === null || cost === undefined || cost < 10000) return 'fragile';
        if (cost < 100000) return 'caution';
        return 'reportable';
    }

    // Fetch live data for visible cards (async, updates cards when data arrives)
    async function fetchLiveDataForCards(markets) {
        for (const m of markets) {
            // Skip if we already have data for this card
            if (cardLiveData.has(m.key)) continue;

            // Handle different field names for tokens/tickers
            const pmToken = m.pm_token_id || m.token_id || null;
            const kTicker = m.k_ticker || m.ticker || null;

            // Skip if no identifiers available
            if (!pmToken && !kTicker) continue;

            // Fetch in background, don't await
            (async () => {
                try {
                    let rawData = null;
                    let isCombined = false;

                    if (pmToken && kTicker) {
                        // Cross-platform - use combined endpoint
                        rawData = await fetchCombinedLiveData(pmToken, kTicker);
                        isCombined = true;
                    } else if (pmToken) {
                        rawData = await fetchLiveData(pmToken, 'polymarket');
                    } else if (kTicker) {
                        rawData = await fetchLiveData(kTicker, 'kalshi');
                    }

                    if (rawData) {
                        const data = normalizeServerResponse(rawData, isCombined);
                        cardLiveData.set(m.key, data);
                        // Update the card in place
                        updateCardWithLiveData(m.key, data, m);
                    }
                } catch (e) {
                    console.warn(`Failed to fetch live data for ${m.key}:`, e);
                }
            })();
        }
    }

    // Update a card with live data without re-rendering the entire grid
    function updateCardWithLiveData(key, data, market) {
        const card = document.querySelector(`.market-card[data-market-key="${key}"]`);
        if (!card) return;

        // Update bellwether price
        const bwPriceEl = card.querySelector('.bw-price');
        const methodEl = card.querySelector('.card-price-method');
        if (bwPriceEl && data.bellwether_price !== null) {
            bwPriceEl.textContent = Math.round(data.bellwether_price * 100) + '%';
            if (methodEl) {
                methodEl.textContent = data.vwap_label ||
                    (market.has_both ? '6h VWAP across platforms' : '6h VWAP · single platform');
            }
        }

        // Update reportability
        const reportabilityContainer = card.querySelector('.card-reportability');
        if (reportabilityContainer && data.robustness) {
            const cost = data.robustness.cost_to_move_5c;
            const label = data.robustness.reportability;
            let html = `<span class="report-badge ${label}">${label.charAt(0).toUpperCase() + label.slice(1)}</span>`;
            if (cost !== null) {
                html += `<span class="report-detail"><strong>${formatReportabilityCost(cost)}</strong> to move 5¢</span>`;
            }
            reportabilityContainer.innerHTML = html;
        }

        // Update platform spot prices if combined data
        if (data.platform_prices) {
            const platformCols = card.querySelectorAll('.card-platform-col');
            if (platformCols.length >= 2) {
                const pmVal = platformCols[0].querySelector('.plat-val');
                const kVal = platformCols[1].querySelector('.plat-val');
                if (pmVal && data.platform_prices.polymarket !== null) {
                    pmVal.textContent = formatPrice(data.platform_prices.polymarket);
                }
                if (kVal && data.platform_prices.kalshi !== null) {
                    kVal.textContent = formatPrice(data.platform_prices.kalshi);
                }
            }
        }

        // Add/remove fragile class
        if (data.robustness?.reportability === 'fragile') {
            card.classList.add('fragile');
        } else {
            card.classList.remove('fragile');
        }
    }

    // Render live data section in modal
    function renderLiveDataSection(data, isCombined = false) {
        if (!data) {
            return `<div class="modal-live-data">
                <div class="modal-live-data-header">Live Market Depth</div>
                <div class="modal-live-data-note">Live data not available for this market</div>
            </div>`;
        }

        const robustness = data.robustness;
        const vwap = data.vwap_6h;

        const costToMove = robustness.cost_to_move_5c !== null
            ? formatVolume(robustness.cost_to_move_5c)
            : 'N/A';

        const vwapValue = data.bellwether_price !== null
            ? `${Math.round(data.bellwether_price * 100)}%`
            : 'No trades';

        const vwapLabel = data.vwap_label || '6h VWAP';

        // Badge class based on reportability
        const badgeClass = robustness.reportability === 'reportable' ? 'reportable' :
                          robustness.reportability === 'caution' ? 'caution' : 'fragile';
        const badgeLabel = robustness.reportability.charAt(0).toUpperCase() + robustness.reportability.slice(1);

        // Platform prices for combined data
        let platformPricesHtml = '';
        if (isCombined && data.platform_prices) {
            const pmPrice = data.platform_prices.polymarket !== null
                ? formatPrice(data.platform_prices.polymarket) : '—';
            const kPrice = data.platform_prices.kalshi !== null
                ? formatPrice(data.platform_prices.kalshi) : '—';

            platformPricesHtml = `
                <div class="modal-live-data-platforms">
                    <div class="modal-live-data-platform">
                        <span class="platform-badge pm">PM</span>
                        <span class="platform-price">${pmPrice}</span>
                    </div>
                    <div class="modal-live-data-platform">
                        <span class="platform-badge kalshi">K</span>
                        <span class="platform-price">${kPrice}</span>
                    </div>
                </div>
            `;
        }

        return `<div class="modal-live-data">
            <div class="modal-live-data-header">Live Market Depth</div>
            <div class="modal-live-data-grid">
                <div class="modal-live-data-item">
                    <div class="modal-live-data-label">Cost to Move 5¢</div>
                    <div class="modal-live-data-value">${costToMove}</div>
                    <div class="modal-live-data-badge ${badgeClass}">${badgeLabel}</div>
                </div>
                <div class="modal-live-data-item">
                    <div class="modal-live-data-label">${vwapLabel}</div>
                    <div class="modal-live-data-value">${vwapValue}</div>
                    <div class="modal-live-data-sub">${vwap.trade_count} trades</div>
                </div>
            </div>
            ${platformPricesHtml}
            <div class="modal-live-data-timestamp">Updated ${new Date(data.fetched_at).toLocaleTimeString()}</div>
        </div>`;
    }

    // Format reportability cost for cards
    function formatReportabilityCost(cost) {
        if (cost === null) return '—';
        if (cost >= 1e6) return '$' + (cost / 1e6).toFixed(1) + 'M';
        if (cost >= 1e3) return '$' + Math.round(cost / 1e3) + 'K';
        return '$' + cost;
    }

    // Get badge HTML for reportability
    function getReportabilityBadgeHtml(reportability) {
        if (!reportability) return '';
        const label = reportability.charAt(0).toUpperCase() + reportability.slice(1);
        return `<span class="reportability-badge ${reportability}">${label}</span>`;
    }

    // Format currency
    function formatVolume(value) {
        if (!value) return '—';
        if (value >= 1e9) return '$' + (value / 1e9).toFixed(1) + 'B';
        if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
        if (value >= 1e3) return '$' + (value / 1e3).toFixed(0) + 'K';
        return '$' + value.toFixed(0);
    }

    // Format price as percentage
    function formatPrice(value) {
        if (value === null || value === undefined) return '—';
        return Math.round(value * 100) + '%';
    }

    // Format price change
    function formatChange(value) {
        if (value === null || value === undefined) return { text: '—', class: 'neutral', raw: 0 };
        const pct = value * 100;
        const sign = pct >= 0 ? '+' : '';
        const cls = pct > 0.5 ? 'positive' : pct < -0.5 ? 'negative' : 'neutral';
        return { text: sign + pct.toFixed(1) + '%', class: cls, raw: pct };
    }

    // Format spread
    function formatSpread(pm, k) {
        if (pm === null || pm === undefined || k === null || k === undefined) return { text: '—', pts: null };
        const pts = Math.abs(pm - k) * 100;
        return { text: pts.toFixed(0), pts: pts };
    }

    // Get spread status
    function getSpreadStatus(pts) {
        if (pts === null) return { class: '', note: '' };
        if (pts < 3) return { class: 'aligned', note: 'Platforms aligned' };
        if (pts <= 5) return { class: '', note: '' };
        return { class: 'divergent', note: 'Notable divergence' };
    }

    // Truncate text
    function truncate(text, maxLen = 80) {
        if (!text) return 'Unknown';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen).trim() + '...';
    }

    // Format relative time
    function formatRelativeTime(isoDate) {
        if (!isoDate) return 'unknown';
        try {
            const date = new Date(isoDate);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return diffMins + 'm ago';
            if (diffHours < 24) return diffHours + 'h ago';
            return diffDays + 'd ago';
        } catch (e) {
            return 'unknown';
        }
    }

    // =========================================================================
    // CARD RENDERING
    // =========================================================================

    // Render election card (cross-platform comparison) - NEW DESIGN
    function renderElectionCard(e, index) {
        const liveData = cardLiveData.get(e.key);
        const spread = formatSpread(e.pm_price, e.k_price);

        // Use question as title, fall back to label
        const title = e.pm_question || e.k_question || e.label || 'Unknown market';

        // Determine if card is fragile
        const isFragile = liveData?.robustness?.reportability === 'fragile';
        let cardClass = 'market-card clickable';
        if (isFragile) cardClass += ' fragile';

        // Divergence flag: |PM - K| > 10pp
        const hasDivergence = e.has_both && spread.pts !== null && spread.pts > 10;

        // Bellwether price: VWAP if available, else average of platforms
        let bwPrice = '—';
        let priceMethod = '6h VWAP across platforms';
        if (liveData?.bellwether_price !== null && liveData?.bellwether_price !== undefined) {
            bwPrice = Math.round(liveData.bellwether_price * 100) + '%';
            priceMethod = liveData.vwap_label || (e.has_both ? '6h VWAP across platforms' : '6h VWAP · single platform');
        } else if (e.has_both && e.pm_price !== null && e.k_price !== null) {
            bwPrice = Math.round((e.pm_price + e.k_price) * 50) + '%';
            priceMethod = 'Avg. across platforms';
        } else if (e.pm_price !== null) {
            bwPrice = Math.round(e.pm_price * 100) + '%';
            priceMethod = 'Current price';
        } else if (e.k_price !== null) {
            bwPrice = Math.round(e.k_price * 100) + '%';
            priceMethod = 'Current price';
        }

        // Platform text (PM · Kalshi)
        let platformsText = '';
        if (e.has_both) {
            platformsText = 'PM · Kalshi';
        } else if (e.has_pm) {
            platformsText = 'PM';
        } else if (e.has_k) {
            platformsText = 'Kalshi';
        }

        // Image or placeholder
        let imageHtml = '<div class="card-market-img-placeholder">📊</div>';
        if (e.image) {
            imageHtml = `<img src="${e.image}" alt="" loading="lazy">`;
        }

        // Platform prices
        const pmSpot = liveData?.platform_prices?.polymarket ?? e.pm_price;
        const kSpot = liveData?.platform_prices?.kalshi ?? e.k_price;
        const pmValHtml = e.has_pm ? `<div class="plat-val">${formatPrice(pmSpot)}</div>` : '<div class="plat-none">No market</div>';
        const kValHtml = e.has_k ? `<div class="plat-val">${formatPrice(kSpot)}</div>` : '<div class="plat-none">No market</div>';

        // Reportability
        let reportBadgeHtml = '';
        let reportDetailHtml = '';
        if (liveData?.robustness) {
            const label = liveData.robustness.reportability;
            const cost = liveData.robustness.cost_to_move_5c;
            reportBadgeHtml = `<span class="report-badge ${label}">${label.charAt(0).toUpperCase() + label.slice(1)}</span>`;
            if (cost !== null) {
                reportDetailHtml = `<span class="report-detail"><strong>${formatReportabilityCost(cost)}</strong> to move 5¢</span>`;
            }
        }

        // Divergence flag in meta
        const divergenceHtml = hasDivergence ? '<span class="card-divergence-flag"> · Divergence</span>' : '';

        return `
            <div class="${cardClass}" data-market-key="${e.key}" data-pm-token="${e.pm_token_id || ''}" data-k-ticker="${e.k_ticker || ''}">
                <div class="card-meta">
                    <div class="card-meta-left">
                        <span class="card-category">${e.category_display || 'Electoral'}</span>
                        ${divergenceHtml}
                    </div>
                    <span class="card-platforms">${platformsText}</span>
                </div>
                <div class="card-question-row">
                    <div class="card-market-img">${imageHtml}</div>
                    <div class="card-question">${truncate(title, 100)}</div>
                </div>
                <div class="card-price-row">
                    <span class="bw-price">${bwPrice}</span>
                    <span class="bw-label">Bellwether</span>
                </div>
                <div class="card-price-method">${priceMethod}</div>
                <div class="card-platform-row">
                    <div class="card-platform-col">
                        <div class="plat-name">Polymarket</div>
                        ${pmValHtml}
                    </div>
                    <div class="card-platform-col">
                        <div class="plat-name">Kalshi</div>
                        ${kValHtml}
                    </div>
                </div>
                <div class="card-footer">
                    <div class="card-reportability">
                        ${reportBadgeHtml}
                        ${reportDetailHtml}
                    </div>
                    <span class="card-volume">${formatVolume(e.total_volume)} vol</span>
                </div>
            </div>
        `;
    }

    // Render individual market card (non-electoral) - NEW DESIGN
    function renderMarketCard(m, index) {
        const liveData = cardLiveData.get(m.key);
        const isPM = m.platform === 'Polymarket';
        const platformsText = isPM ? 'PM' : 'Kalshi';

        // Determine if card is fragile
        const isFragile = liveData?.robustness?.reportability === 'fragile';
        let cardClass = 'market-card clickable';
        if (isFragile) cardClass += ' fragile';

        // Bellwether price: VWAP if available, else current price
        let bwPrice = '—';
        let priceMethod = '6h VWAP · single platform';
        if (liveData?.bellwether_price !== null && liveData?.bellwether_price !== undefined) {
            bwPrice = Math.round(liveData.bellwether_price * 100) + '%';
        } else if (m.price !== null && m.price !== undefined) {
            bwPrice = Math.round(m.price * 100) + '%';
            priceMethod = 'Current price';
        }

        // Spot price
        const spotPrice = liveData?.current_price ?? m.price;

        // Token/ticker for live data fetching
        const tokenAttr = isPM
            ? `data-pm-token="${m.pm_token_id || m.token_id || ''}"`
            : `data-k-ticker="${m.k_ticker || m.ticker || ''}"`;

        // Image or placeholder
        let imageHtml = '<div class="card-market-img-placeholder">📊</div>';
        if (m.image) {
            imageHtml = `<img src="${m.image}" alt="" loading="lazy">`;
        }

        // Platform prices - only show the one we have
        const pmValHtml = isPM ? `<div class="plat-val">${formatPrice(spotPrice)}</div>` : '<div class="plat-none">No market</div>';
        const kValHtml = !isPM ? `<div class="plat-val">${formatPrice(spotPrice)}</div>` : '<div class="plat-none">No market</div>';

        // Reportability
        let reportBadgeHtml = '';
        let reportDetailHtml = '';
        if (liveData?.robustness) {
            const label = liveData.robustness.reportability;
            const cost = liveData.robustness.cost_to_move_5c;
            reportBadgeHtml = `<span class="report-badge ${label}">${label.charAt(0).toUpperCase() + label.slice(1)}</span>`;
            if (cost !== null) {
                reportDetailHtml = `<span class="report-detail"><strong>${formatReportabilityCost(cost)}</strong> to move 5¢</span>`;
            }
        }

        return `
            <div class="${cardClass}" data-market-key="${m.key}" ${tokenAttr}>
                <div class="card-meta">
                    <span class="card-category">${m.category_display || 'Other'}</span>
                    <span class="card-platforms">${platformsText}</span>
                </div>
                <div class="card-question-row">
                    <div class="card-market-img">${imageHtml}</div>
                    <div class="card-question">${truncate(m.label, 100)}</div>
                </div>
                <div class="card-price-row">
                    <span class="bw-price">${bwPrice}</span>
                    <span class="bw-label">Bellwether</span>
                </div>
                <div class="card-price-method">${priceMethod}</div>
                <div class="card-platform-row">
                    <div class="card-platform-col">
                        <div class="plat-name">Polymarket</div>
                        ${pmValHtml}
                    </div>
                    <div class="card-platform-col">
                        <div class="plat-name">Kalshi</div>
                        ${kValHtml}
                    </div>
                </div>
                <div class="card-footer">
                    <div class="card-reportability">
                        ${reportBadgeHtml}
                        ${reportDetailHtml}
                    </div>
                    <span class="card-volume">${formatVolume(m.volume || m.total_volume)} vol</span>
                </div>
            </div>
        `;
    }

    // Render card based on entry type
    function renderCard(entry, index) {
        if (entry.entry_type === 'market') {
            return renderMarketCard(entry, index);
        }
        return renderElectionCard(entry, index);
    }

    // =========================================================================
    // MODAL FUNCTIONALITY
    // =========================================================================

    function renderElectionModal(e) {
        const spread = formatSpread(e.pm_price, e.k_price);
        const spreadStatus = getSpreadStatus(spread.pts);
        const title = e.pm_question || e.k_question || e.label || 'Unknown market';

        let pricesHtml = '';
        let pricesClass = '';

        if (e.has_both) {
            const spreadDivergent = spreadStatus.class === 'divergent' ? ' divergent' : '';
            pricesHtml = `
                <div class="modal-price-box pm">
                    <div class="modal-price-label">Polymarket</div>
                    <div class="modal-price-value">${formatPrice(e.pm_price)}</div>
                    <div class="modal-price-sub">${formatVolume(e.pm_volume)} volume</div>
                </div>
                <div class="modal-price-box kalshi">
                    <div class="modal-price-label">Kalshi</div>
                    <div class="modal-price-value">${formatPrice(e.k_price)}</div>
                    <div class="modal-price-sub">${formatVolume(e.k_volume)} volume</div>
                </div>
                <div class="modal-price-box spread${spreadDivergent}">
                    <div class="modal-price-label">Spread</div>
                    <div class="modal-price-value">${spread.text}</div>
                    <div class="modal-price-sub">${spreadStatus.note || 'Price difference'}</div>
                </div>
            `;
        } else if (e.has_pm) {
            pricesClass = ' single-col';
            pricesHtml = `
                <div class="modal-price-box pm">
                    <div class="modal-price-label">Polymarket</div>
                    <div class="modal-price-value">${formatPrice(e.pm_price)}</div>
                    <div class="modal-price-sub">${formatVolume(e.pm_volume)} volume</div>
                </div>
            `;
        } else {
            pricesClass = ' single-col';
            pricesHtml = `
                <div class="modal-price-box kalshi">
                    <div class="modal-price-label">Kalshi</div>
                    <div class="modal-price-value">${formatPrice(e.k_price)}</div>
                    <div class="modal-price-sub">${formatVolume(e.k_volume)} volume</div>
                </div>
            `;
        }

        // Links
        let linksHtml = '';
        const linksClass = (e.has_pm && e.has_k) ? '' : ' single';

        let pmLink = '', kLink = '';
        if (e.has_pm && e.pm_url) {
            pmLink = `<a href="${e.pm_url}" target="_blank" rel="noopener" class="modal-link-box pm">
                <div class="modal-link-info"><span class="modal-link-platform">Polymarket</span><span class="modal-link-text">View market details & trade</span></div>
                <span class="modal-link-arrow">↗</span></a>`;
        }
        if (e.has_k && e.k_url) {
            kLink = `<a href="${e.k_url}" target="_blank" rel="noopener" class="modal-link-box kalshi">
                <div class="modal-link-info"><span class="modal-link-platform">Kalshi</span><span class="modal-link-text">View market details & trade</span></div>
                <span class="modal-link-arrow">↗</span></a>`;
        }
        if (pmLink || kLink) {
            linksHtml = `<div class="modal-links${linksClass}">${pmLink}${kLink}</div>`;
        }

        // Embed (PM only)
        let embedHtml = '';
        if (e.has_pm && e.pm_embed_url) {
            embedHtml = `<div class="modal-embeds">
                <div class="modal-embeds-header">Live Chart</div>
                <div class="modal-embed-wrapper full-width">
                    <div class="modal-embed-header"><span>Polymarket</span><a href="${e.pm_url || '#'}" target="_blank" rel="noopener">Open ↗</a></div>
                    <div class="modal-embed-frame"><iframe src="${e.pm_embed_url}" loading="lazy"></iframe></div>
                </div>
            </div>`;
        }

        // Modal image
        const modalImageHtml = e.image ? `<div class="modal-image"><img src="${e.image}" alt=""></div>` : '';

        // Race context (from Google Civic API)
        let raceContextHtml = '';
        if (e.category_display === 'US Electoral') {
            const raceContext = getRaceContext(e);
            raceContextHtml = renderRaceContextSection(raceContext);
        }

        // Live data container
        const liveDataHtml = '<div class="modal-live-data-container"></div>';

        return `
            <div class="modal-header">
                ${modalImageHtml}
                <div class="modal-header-info">
                    <div class="modal-meta"><span class="category-tag">${e.category_display || 'Electoral'}</span></div>
                    <h2 class="modal-title">${title}</h2>
                </div>
                <button class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="modal-prices${pricesClass}">${pricesHtml}</div>
                ${liveDataHtml}
                ${raceContextHtml}
                ${linksHtml}
                ${embedHtml}
            </div>
        `;
    }

    function renderMarketModal(m) {
        const platformClass = m.platform === 'Polymarket' ? 'pm' : 'kalshi';
        const change = formatChange(m.price_change_24h);

        const pricesHtml = `
            <div class="modal-price-box ${platformClass}">
                <div class="modal-price-label">${m.platform}</div>
                <div class="modal-price-value">${formatPrice(m.price)}</div>
                <div class="modal-price-sub">${formatVolume(m.volume || m.total_volume)} volume</div>
            </div>
        `;

        let linkHtml = '';
        if (m.url) {
            linkHtml = `<div class="modal-links single">
                <a href="${m.url}" target="_blank" rel="noopener" class="modal-link-box ${platformClass}">
                    <div class="modal-link-info"><span class="modal-link-platform">${m.platform}</span><span class="modal-link-text">View market details & trade</span></div>
                    <span class="modal-link-arrow">↗</span>
                </a>
            </div>`;
        }

        let embedHtml = '';
        if (m.embed_url && m.platform === 'Polymarket') {
            embedHtml = `<div class="modal-embeds">
                <div class="modal-embeds-header">Live Chart</div>
                <div class="modal-embed-wrapper full-width">
                    <div class="modal-embed-header"><span>Polymarket</span><a href="${m.url || '#'}" target="_blank" rel="noopener">Open ↗</a></div>
                    <div class="modal-embed-frame"><iframe src="${m.embed_url}" loading="lazy"></iframe></div>
                </div>
            </div>`;
        }

        const changeArrow = change.raw > 0 ? '↑' : change.raw < 0 ? '↓' : '';
        const changeDisplay = change.raw !== 0 ? `${changeArrow} ${change.text} (24h)` : '';

        // Modal image
        const modalImageHtml = m.image ? `<div class="modal-image"><img src="${m.image}" alt=""></div>` : '';

        // Race context (from Google Civic API) - only for US Electoral
        let raceContextHtml = '';
        if (m.category_display === 'US Electoral') {
            const raceContext = getRaceContext(m);
            raceContextHtml = renderRaceContextSection(raceContext);
        }

        // Live data container (only for PM markets)
        // Live data container
        const liveDataHtml = '<div class="modal-live-data-container"></div>';

        return `
            <div class="modal-header">
                ${modalImageHtml}
                <div class="modal-header-info">
                    <div class="modal-meta">
                        <span class="platform-badge ${platformClass}">${m.platform === 'Polymarket' ? 'PM' : 'K'}</span>
                        <span class="category-tag">${m.category_display || 'Other'}</span>
                        ${changeDisplay ? `<span class="modal-change ${change.class}">${changeDisplay}</span>` : ''}
                    </div>
                    <h2 class="modal-title">${m.label}</h2>
                </div>
                <button class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="modal-prices single-col">${pricesHtml}</div>
                ${liveDataHtml}
                ${raceContextHtml}
                ${linkHtml}
                ${embedHtml}
            </div>
        `;
    }

    function openModal(marketKey) {
        const entry = allMarkets.find(m => m.key === marketKey);
        if (!entry) return;

        const modal = document.getElementById('election-modal');
        const modalContent = document.getElementById('election-modal-content');
        if (!modal || !modalContent) return;

        modalContent.innerHTML = entry.entry_type === 'market'
            ? renderMarketModal(entry)
            : renderElectionModal(entry);

        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';

        const closeBtn = modalContent.querySelector('.modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        // Load live data if available
        const liveDataContainer = modalContent.querySelector('.modal-live-data-container');
        if (liveDataContainer) {
            const pmTokenId = entry.pm_token_id;
            const kTicker = entry.k_ticker;

            liveDataContainer.innerHTML = '<div class="modal-live-data"><div class="modal-live-data-header">Live Market Depth</div><div class="modal-live-data-loading">Loading...</div></div>';

            if (pmTokenId && kTicker) {
                // Cross-platform: use combined endpoint
                fetchCombinedLiveData(pmTokenId, kTicker).then(data => {
                    liveDataContainer.innerHTML = renderLiveDataSection(data, true);
                });
            } else if (pmTokenId) {
                fetchLiveData(pmTokenId, 'polymarket').then(data => {
                    liveDataContainer.innerHTML = renderLiveDataSection(data, false);
                });
            } else if (kTicker) {
                fetchLiveData(kTicker, 'kalshi').then(data => {
                    liveDataContainer.innerHTML = renderLiveDataSection(data, false);
                });
            } else {
                liveDataContainer.innerHTML = renderLiveDataSection(null);
            }
        }
    }

    function closeModal() {
        const modal = document.getElementById('election-modal');
        if (modal) {
            modal.classList.remove('visible');
            document.body.style.overflow = '';
        }
    }

    function setupCardClickHandlers() {
        document.querySelectorAll('.market-card.clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.tagName === 'A') return;
                const key = card.dataset.marketKey;
                if (key) openModal(key);
            });
        });
    }

    // =========================================================================
    // FILTERING & SORTING
    // =========================================================================

    function applyFilters() {
        filteredMarkets = allMarkets.filter(m => {
            // Category filter
            if (filters.category !== 'all') {
                const cat = m.category_display || 'Other';
                if (cat !== filters.category) return false;
            }

            // Platform filter
            if (filters.platform !== 'all') {
                if (m.entry_type === 'election') {
                    // For elections, filter by which platforms are available
                    if (filters.platform === 'polymarket' && !m.has_pm) return false;
                    if (filters.platform === 'kalshi' && !m.has_k) return false;
                } else {
                    // For individual markets
                    const platform = (m.platform || '').toLowerCase();
                    if (platform !== filters.platform) return false;
                }
            }

            // Search filter - search multiple fields, match all words
            if (filters.search) {
                const searchWords = filters.search.toLowerCase().split(/\s+/).filter(w => w.length > 0);
                const searchable = [
                    m.label || '',
                    m.pm_question || '',
                    m.k_question || '',
                    m.location || '',
                    m.country || '',
                    m.office || '',
                    m.party || '',
                    m.type || '',
                    m.pm_candidate || '',
                    m.k_candidate || ''
                ].join(' ').toLowerCase();

                // All search words must be found somewhere
                const allMatch = searchWords.every(word => searchable.includes(word));
                if (!allMatch) return false;
            }

            return true;
        });

        updateTabCounts();
    }

    function getSortedMarkets() {
        let sorted = [...filteredMarkets];

        switch (currentView) {
            case 'biggest_moves':
                // Volume-weighted moves: heavily prioritize high-volume markets
                // Score = abs(price_change) * log(volume)³ - surfaces moves on markets DC cares about
                const MIN_VOLUME = 100000;  // $100K minimum to filter noise
                sorted = sorted.filter(m => {
                    const vol = m.total_volume || m.volume || 0;
                    return m.price_change_24h !== null && vol >= MIN_VOLUME;
                });
                sorted.sort((a, b) => {
                    const volA = a.total_volume || a.volume || 0;
                    const volB = b.total_volume || b.volume || 0;
                    const logA = Math.log10(Math.max(volA, 1));
                    const logB = Math.log10(Math.max(volB, 1));
                    const scoreA = Math.abs(a.price_change_24h || 0) * logA * logA * logA;
                    const scoreB = Math.abs(b.price_change_24h || 0) * logB * logB * logB;
                    return scoreB - scoreA;
                });
                break;
            case 'highest_volume':
                // Sort by volume, then dedupe by event slug (one market per event)
                sorted.sort((a, b) => (b.total_volume || b.volume || 0) - (a.total_volume || a.volume || 0));
                const seenSlugs = new Set();
                sorted = sorted.filter(m => {
                    // Extract event slug from pm_url or k_url
                    const pmSlug = m.pm_url ? m.pm_url.split('/event/')[1]?.split('/')[0] : null;
                    const kSlug = m.k_url ? m.k_url.split('/events/')[1]?.split('/')[0] : null;
                    const slug = pmSlug || kSlug || m.key;
                    if (seenSlugs.has(slug)) return false;
                    seenSlugs.add(slug);
                    return true;
                });
                break;
            case 'divergences':
                // Only elections with both platforms and spread > 5%
                // Check for entry_type === 'election' OR old format (has_both with pm_price/k_price)
                sorted = sorted.filter(m => {
                    const isElection = m.entry_type === 'election' || (m.has_both && m.pm_price !== undefined);
                    return isElection && m.has_both && m.spread !== null && m.spread > 0.05;
                });
                sorted.sort((a, b) => (b.spread || 0) - (a.spread || 0));
                break;
        }

        return sorted;
    }

    function renderCards() {
        const container = document.getElementById('monitor-cards');
        const loadMoreContainer = document.getElementById('monitor-load-more');
        const loadMoreBtn = document.getElementById('load-more-btn');
        const showLessBtn = document.getElementById('show-less-btn');
        if (!container) return;

        const sorted = getSortedMarkets();

        if (sorted.length === 0) {
            container.innerHTML = `<div class="monitor-empty">No markets found matching these filters</div>`;
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
            return;
        }

        const toShow = sorted.slice(0, displayCount);
        container.innerHTML = toShow.map((m, i) => renderCard(m, i)).join('');

        setupCardClickHandlers();

        // Fetch live data for visible cards
        fetchLiveDataForCards(toShow);

        // Re-add checkboxes if in review mode
        if (reviewMode) {
            addCheckboxesToCards();
        }

        // Show/hide load more container and buttons
        if (loadMoreContainer) {
            const hasMore = sorted.length > displayCount;
            const canShowLess = displayCount > CARDS_PER_PAGE;

            loadMoreContainer.style.display = (hasMore || canShowLess) ? 'flex' : 'none';
            if (loadMoreBtn) loadMoreBtn.style.display = hasMore ? 'inline-block' : 'none';
            if (showLessBtn) showLessBtn.style.display = canShowLess ? 'inline-block' : 'none';
        }
    }

    function updateTabCounts() {
        const movesCount = document.getElementById('tab-count-moves');
        const volumeCount = document.getElementById('tab-count-volume');
        const divergencesCount = document.getElementById('tab-count-divergences');

        const MIN_VOLUME_FOR_MOVES = 10000;
        const withChange = filteredMarkets.filter(m => {
            const vol = m.total_volume || m.volume || 0;
            return m.price_change_24h !== null && vol >= MIN_VOLUME_FOR_MOVES;
        });
        const withVolume = filteredMarkets.filter(m => m.total_volume > 0 || m.volume > 0);
        const divergences = filteredMarkets.filter(m => {
            const isElection = m.entry_type === 'election' || (m.has_both && m.pm_price !== undefined);
            return isElection && m.has_both && m.spread !== null && m.spread > 0.05;
        });

        if (movesCount) movesCount.textContent = withChange.length;
        if (volumeCount) volumeCount.textContent = withVolume.length;
        if (divergencesCount) divergencesCount.textContent = divergences.length;
    }

    function updateMarketCount() {
        const countEl = document.getElementById('monitor-market-count');
        if (countEl) countEl.textContent = filteredMarkets.length.toLocaleString();
    }

    function populateCategoryFilter() {
        const categorySelect = document.getElementById('filter-category');
        if (!categorySelect || !monitorData) return;

        const categories = new Set();
        allMarkets.forEach(m => {
            if (m.category_display) categories.add(m.category_display);
        });

        const sorted = Array.from(categories).sort();

        let optionsHtml = '<option value="all">All Categories</option>';
        sorted.forEach(cat => {
            const count = allMarkets.filter(m => m.category_display === cat).length;
            optionsHtml += `<option value="${cat}">${cat} (${count})</option>`;
        });

        categorySelect.innerHTML = optionsHtml;
    }

    function switchView(view) {
        currentView = view;
        displayCount = CARDS_PER_PAGE;

        document.querySelectorAll('.monitor-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        renderCards();
    }

    function loadMore() {
        displayCount += CARDS_PER_PAGE;
        renderCards();
    }

    function showLess() {
        displayCount = CARDS_PER_PAGE;
        renderCards();
        // Scroll back to top of monitor section
        const monitor = document.getElementById('monitor');
        if (monitor) monitor.scrollIntoView({ behavior: 'smooth' });
    }

    function onFilterChange() {
        const categorySelect = document.getElementById('filter-category');
        const platformSelect = document.getElementById('filter-platform');
        const searchInput = document.getElementById('filter-search');

        filters.category = categorySelect ? categorySelect.value : 'all';
        filters.platform = platformSelect ? platformSelect.value : 'all';
        filters.search = searchInput ? searchInput.value.trim() : '';

        displayCount = CARDS_PER_PAGE;

        applyFilters();
        updateMarketCount();
        renderCards();
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    async function loadMonitorData() {
        try {
            const response = await fetch('data/active_markets.json?v=' + Date.now());
            if (!response.ok) throw new Error('Failed to load monitor data');
            monitorData = await response.json();

            allMarkets = monitorData.markets || monitorData.elections || [];
            filteredMarkets = [...allMarkets];

            populateCategoryFilter();
            applyFilters();
            updateMarketCount();
            updateTabCounts();
            renderCards();

            const timestampEl = document.getElementById('monitor-last-update');
            if (timestampEl && monitorData.generated_at) {
                timestampEl.textContent = formatRelativeTime(monitorData.generated_at);
            }
        } catch (err) {
            console.error('Error loading monitor data:', err);
            const container = document.getElementById('monitor-cards');
            if (container) {
                container.innerHTML = '<div class="monitor-empty">Unable to load market data. Please refresh the page.</div>';
            }
        }
    }

    function init() {
        document.querySelectorAll('.monitor-tab').forEach(tab => {
            tab.addEventListener('click', () => switchView(tab.dataset.view));
        });

        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMore);

        const showLessBtn = document.getElementById('show-less-btn');
        if (showLessBtn) showLessBtn.addEventListener('click', showLess);

        const categorySelect = document.getElementById('filter-category');
        const platformSelect = document.getElementById('filter-platform');
        const searchInput = document.getElementById('filter-search');

        if (categorySelect) categorySelect.addEventListener('change', onFilterChange);
        if (platformSelect) platformSelect.addEventListener('change', onFilterChange);
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(onFilterChange, 200);
            });
        }

        const modal = document.getElementById('election-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
                closeFeedbackModal();
            }
        });

        // Initialize review mode
        initReviewMode();

        // Load banner stats
        loadBannerStats();

        // Load election timeline
        loadElectionTimeline();

        loadMonitorData();
    }

    // Load summary stats for the research finding banner
    function loadBannerStats() {
        fetch('data/summary.json')
            .then(r => r.json())
            .then(data => {
                const accEl = document.getElementById('banner-accuracy');
                const electionsEl = document.getElementById('banner-elections');
                const brierEl = document.getElementById('banner-brier');

                if (accEl && data.directional_accuracy) {
                    accEl.textContent = data.directional_accuracy.toFixed(1) + '%';
                }
                if (electionsEl && data.overlapping_elections) {
                    electionsEl.textContent = data.overlapping_elections.toLocaleString();
                }
                if (brierEl && data.combined_brier) {
                    brierEl.textContent = data.combined_brier.toFixed(2);
                }
            })
            .catch(err => console.warn('Failed to load banner stats:', err));
    }

    // =============================================================================
    // ELECTION TIMELINE (Google Civic API Integration)
    // =============================================================================

    let civicData = null;
    let activeElectionFilter = null;

    async function loadElectionTimeline() {
        try {
            const response = await fetch('data/civic_elections.json');
            if (!response.ok) {
                console.warn('Civic elections data not available');
                hideTimeline();
                return;
            }
            civicData = await response.json();
            renderTimeline(civicData.elections || []);
            initTimelineClickHandlers();
        } catch (err) {
            console.warn('Failed to load election timeline:', err);
            hideTimeline();
        }
    }

    function hideTimeline() {
        const timeline = document.getElementById('election-timeline');
        if (timeline) {
            timeline.style.display = 'none';
        }
    }

    function renderTimeline(elections) {
        const container = document.getElementById('timeline-content');
        if (!container) return;

        if (!elections || elections.length === 0) {
            container.innerHTML = '<div class="timeline-loading">No upcoming elections</div>';
            return;
        }

        // Filter to future elections only
        const futureElections = elections.filter(e => e.daysUntil === null || e.daysUntil >= 0);

        if (futureElections.length === 0) {
            container.innerHTML = '<div class="timeline-loading">No upcoming elections</div>';
            return;
        }

        let html = '<div class="timeline-stem"></div>';
        html += '<div class="timeline-nodes">';

        // Today marker
        const today = new Date();
        const todayStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `
            <div class="timeline-today">
                <span class="timeline-today-label">TODAY</span>
                <span class="timeline-today-date">${todayStr}</span>
            </div>
        `;

        // Election nodes
        futureElections.forEach((election, index) => {
            const dateStr = formatElectionDate(election.electionDay);
            const marketCount = election.matchedMarketCount || 0;
            const spacing = calculateSpacing(election.daysUntil, index);

            html += `
                <div class="timeline-election" data-election-id="${election.id}" style="margin-top: ${spacing}px;">
                    <div class="timeline-election-date">${dateStr}</div>
                    <div class="timeline-election-name">${truncateElectionName(election.name)}</div>
                    ${marketCount > 0 ? `
                        <div class="timeline-election-markets">
                            <span class="timeline-election-markets-count">${marketCount}</span> markets
                        </div>
                    ` : ''}
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    function formatElectionDate(dateStr) {
        if (!dateStr) return 'TBD';
        try {
            const date = new Date(dateStr + 'T00:00:00');
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return dateStr;
        }
    }

    function truncateElectionName(name) {
        if (!name) return 'Election';
        // Shorten common patterns
        name = name.replace('General Election', 'General');
        name = name.replace('Primary Election', 'Primary');
        name = name.replace('Special Election', 'Special');
        if (name.length > 28) {
            return name.substring(0, 25) + '...';
        }
        return name;
    }

    function calculateSpacing(daysUntil, index) {
        // Base spacing for first item
        if (index === 0) return 0;

        // Proportional spacing based on days until election
        // Min 20px, max 60px
        if (daysUntil === null) return 40;

        if (daysUntil <= 7) return 20;
        if (daysUntil <= 30) return 30;
        if (daysUntil <= 90) return 40;
        if (daysUntil <= 180) return 50;
        return 60;
    }

    function initTimelineClickHandlers() {
        document.querySelectorAll('.timeline-election').forEach(node => {
            node.addEventListener('click', () => {
                const electionId = node.dataset.electionId;
                filterByElection(electionId);
            });
        });

        // Dismiss filter chip
        const dismissBtn = document.getElementById('election-filter-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', clearElectionFilter);
        }
    }

    function filterByElection(electionId) {
        if (!civicData) return;

        const election = civicData.elections.find(e => e.id === electionId);
        if (!election) return;

        activeElectionFilter = election;

        // Show filter chip
        const chip = document.getElementById('election-filter-chip');
        const nameEl = document.getElementById('election-filter-name');
        if (chip && nameEl) {
            nameEl.textContent = election.name;
            chip.style.display = 'flex';
        }

        // Mark active in timeline
        document.querySelectorAll('.timeline-election').forEach(node => {
            node.classList.toggle('active', node.dataset.electionId === electionId);
        });

        // Filter markets
        applyElectionFilter(election);
    }

    // State abbreviation to full name mapping
    const STATE_NAMES = {
        'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas',
        'CA': 'california', 'CO': 'colorado', 'CT': 'connecticut', 'DE': 'delaware',
        'FL': 'florida', 'GA': 'georgia', 'HI': 'hawaii', 'ID': 'idaho',
        'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas',
        'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland',
        'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi',
        'MO': 'missouri', 'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada',
        'NH': 'new hampshire', 'NJ': 'new jersey', 'NM': 'new mexico', 'NY': 'new york',
        'NC': 'north carolina', 'ND': 'north dakota', 'OH': 'ohio', 'OK': 'oklahoma',
        'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode island', 'SC': 'south carolina',
        'SD': 'south dakota', 'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah',
        'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington', 'WV': 'west virginia',
        'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district of columbia'
    };

    function applyElectionFilter(election) {
        if (!election || !election.matchedMarkets || election.matchedMarkets.length === 0) {
            // No matched markets - filter by state/year/type instead
            const stateAbbrev = election.state;
            const stateName = stateAbbrev ? STATE_NAMES[stateAbbrev] : null;
            const year = election.electionDay ? election.electionDay.substring(0, 4) : null;
            const electionName = (election.name || '').toLowerCase();
            const isPrimary = electionName.includes('primary');
            const isDemocratic = electionName.includes('democratic');
            const isRepublican = electionName.includes('republican');

            filteredMarkets = allMarkets.filter(m => {
                // Only Electoral markets (US or general)
                const cat = (m.category_display || '').toLowerCase();
                if (!cat.includes('electoral')) return false;

                // Build searchable text from all relevant fields
                const searchable = [
                    m.label || '',
                    m.pm_question || '',
                    m.k_question || '',
                    m.location || '',
                    m.country || '',
                    m.party || '',
                    m.type || ''
                ].join(' ').toLowerCase();

                // Match state if available (check both abbreviation and full name)
                if (stateAbbrev) {
                    const stateMatch = searchable.includes(stateAbbrev.toLowerCase()) ||
                                      (stateName && searchable.includes(stateName));
                    if (!stateMatch) return false;
                }

                // Match year if available
                if (year) {
                    if (!searchable.includes(year)) return false;
                }

                // Match election type (primary vs general)
                if (isPrimary) {
                    if (!searchable.includes('primary')) return false;
                }

                // Match party if specified
                if (isDemocratic) {
                    if (!searchable.includes('democrat')) return false;
                }
                if (isRepublican) {
                    if (!searchable.includes('republican')) return false;
                }

                return true;
            });
        } else {
            // Filter to matched market keys
            const matchedKeys = new Set(election.matchedMarkets);
            filteredMarkets = allMarkets.filter(m => matchedKeys.has(m.key));
        }

        displayCount = CARDS_PER_PAGE;
        updateMarketCount();
        updateTabCounts();
        renderCards();
    }

    function clearElectionFilter() {
        activeElectionFilter = null;

        // Hide filter chip
        const chip = document.getElementById('election-filter-chip');
        if (chip) chip.style.display = 'none';

        // Remove active class from timeline
        document.querySelectorAll('.timeline-election').forEach(node => {
            node.classList.remove('active');
        });

        // Reset to all markets
        applyFilters();
        updateMarketCount();
        renderCards();
    }

    // =============================================================================
    // RACE CONTEXT (Modal Enrichment)
    // =============================================================================

    function getRaceContext(market) {
        if (!civicData || !civicData.elections) return null;

        // Try to match market to an election with contests
        const state = extractStateFromMarket(market);
        const year = extractYearFromMarket(market);

        for (const election of civicData.elections) {
            if (!election.contests || election.contests.length === 0) continue;

            // Check if this election matches the market
            const electionYear = election.electionDay ? election.electionDay.substring(0, 4) : null;
            const electionState = election.state;

            if (state && electionState && state === electionState) {
                if (!year || !electionYear || year === electionYear) {
                    return {
                        election: election,
                        contests: election.contests
                    };
                }
            }
        }

        return null;
    }

    function extractStateFromMarket(market) {
        const label = (market.label || market.pm_question || market.k_question || '').toUpperCase();

        // Check for state abbreviations
        const stateAbbrevs = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
                             'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
                             'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                             'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
                             'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'];

        for (const abbrev of stateAbbrevs) {
            // Match as word boundary
            const regex = new RegExp('\\b' + abbrev + '\\b');
            if (regex.test(label)) {
                return abbrev;
            }
        }

        return null;
    }

    function extractYearFromMarket(market) {
        const label = (market.label || market.pm_question || market.k_question || '');
        const match = label.match(/\b(202[4-9]|203[0-9])\b/);
        return match ? match[1] : null;
    }

    function renderRaceContextSection(raceContext) {
        if (!raceContext || !raceContext.contests || raceContext.contests.length === 0) {
            return '';
        }

        const contest = raceContext.contests[0];  // Use first contest
        const candidates = contest.candidates || [];

        if (candidates.length === 0) {
            return '';
        }

        let candidatesHtml = candidates.map(c => {
            const partyClass = getPartyClass(c.party);
            const initials = getInitials(c.name);
            const photoHtml = c.photoUrl
                ? `<img src="${c.photoUrl}" alt="${c.name}">`
                : `<div class="candidate-photo-placeholder">${initials}</div>`;

            return `
                <div class="candidate-card ${partyClass}">
                    <div class="candidate-photo">${photoHtml}</div>
                    <div class="candidate-name">${c.name}</div>
                    <div class="candidate-party ${partyClass}">(${partyAbbrev(c.party)})</div>
                </div>
            `;
        }).join('');

        return `
            <div class="modal-race-context">
                <div class="race-context-header">RACE CONTEXT</div>
                <div class="race-context-metadata">
                    <span>${contest.type || 'General'}</span>
                    <span>${contest.office || 'Office'}</span>
                </div>
                <div class="race-candidates">
                    ${candidatesHtml}
                </div>
            </div>
        `;
    }

    function getPartyClass(party) {
        if (!party) return 'other';
        const p = party.toLowerCase();
        if (p.includes('democrat')) return 'dem';
        if (p.includes('republican')) return 'rep';
        return 'other';
    }

    function partyAbbrev(party) {
        if (!party) return '?';
        const p = party.toLowerCase();
        if (p.includes('democrat')) return 'D';
        if (p.includes('republican')) return 'R';
        if (p.includes('libertarian')) return 'L';
        if (p.includes('green')) return 'G';
        if (p.includes('independent')) return 'I';
        return party.charAt(0).toUpperCase();
    }

    function getInitials(name) {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
        }
        return name.charAt(0).toUpperCase();
    }

    // =============================================================================
    // REVIEW MODE - Data Quality Feedback
    // =============================================================================

    function initReviewMode() {
        const startBtn = document.getElementById('start-review-btn');
        const cancelBtn = document.getElementById('cancel-review-btn');
        const submitBtn = document.getElementById('submit-review-btn');
        const feedbackModal = document.getElementById('feedback-modal');
        const feedbackCloseBtn = document.getElementById('feedback-modal-close');
        const feedbackCancelBtn = document.getElementById('feedback-cancel-btn');
        const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');

        if (startBtn) {
            startBtn.addEventListener('click', enterReviewMode);
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', exitReviewMode);
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', openFeedbackModal);
        }

        if (feedbackModal) {
            feedbackModal.addEventListener('click', (e) => {
                if (e.target === feedbackModal) closeFeedbackModal();
            });
        }

        if (feedbackCloseBtn) {
            feedbackCloseBtn.addEventListener('click', closeFeedbackModal);
        }

        if (feedbackCancelBtn) {
            feedbackCancelBtn.addEventListener('click', closeFeedbackModal);
        }

        if (feedbackSubmitBtn) {
            feedbackSubmitBtn.addEventListener('click', submitFeedback);
        }
    }

    function enterReviewMode() {
        reviewMode = true;
        selectedMarkets.clear();
        document.body.classList.add('review-mode');
        updateSelectedCount();
        addCheckboxesToCards();
    }

    function exitReviewMode() {
        reviewMode = false;
        selectedMarkets.clear();
        document.body.classList.remove('review-mode');
        removeCheckboxesFromCards();
    }

    function addCheckboxesToCards() {
        const cards = document.querySelectorAll('.market-card');
        cards.forEach(card => {
            if (card.querySelector('.market-card-checkbox')) return;

            const checkbox = document.createElement('div');
            checkbox.className = 'market-card-checkbox';
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCardSelection(card, checkbox);
            });
            card.appendChild(checkbox);
        });
    }

    function removeCheckboxesFromCards() {
        const checkboxes = document.querySelectorAll('.market-card-checkbox');
        checkboxes.forEach(cb => cb.remove());
        const cards = document.querySelectorAll('.market-card.selected');
        cards.forEach(card => card.classList.remove('selected'));
    }

    function toggleCardSelection(card, checkbox) {
        const key = card.dataset.marketKey;
        if (!key) return;

        if (selectedMarkets.has(key)) {
            selectedMarkets.delete(key);
            checkbox.classList.remove('checked');
            card.classList.remove('selected');
        } else {
            selectedMarkets.add(key);
            checkbox.classList.add('checked');
            card.classList.add('selected');
        }
        updateSelectedCount();
    }

    function updateSelectedCount() {
        const countEl = document.getElementById('selected-count');
        const submitBtn = document.getElementById('submit-review-btn');
        if (countEl) countEl.textContent = selectedMarkets.size;
        if (submitBtn) submitBtn.disabled = selectedMarkets.size === 0;
    }

    function openFeedbackModal() {
        const modal = document.getElementById('feedback-modal');
        const countEl = document.getElementById('feedback-count');
        if (countEl) countEl.textContent = selectedMarkets.size;
        if (modal) modal.classList.add('visible');
        // Reset form
        const radios = document.querySelectorAll('input[name="feedback-type"]');
        radios.forEach(r => r.checked = false);
        const notes = document.getElementById('feedback-notes-input');
        if (notes) notes.value = '';
    }

    function closeFeedbackModal() {
        const modal = document.getElementById('feedback-modal');
        if (modal) modal.classList.remove('visible');
    }

    function submitFeedback() {
        const feedbackType = document.querySelector('input[name="feedback-type"]:checked');
        const notes = document.getElementById('feedback-notes-input');

        if (!feedbackType) {
            showToast('Please select a feedback type');
            return;
        }

        if (!notes || !notes.value.trim()) {
            showToast('Please add a note');
            return;
        }

        // Gather selected market data
        const marketKeys = Array.from(selectedMarkets);
        const marketData = marketKeys.map(key => {
            const market = allMarkets.find(m => m.key === key);
            return market ? {
                key: market.key,
                label: market.label,
                platform: market.platform || (market.has_both ? 'Both' : market.has_pm ? 'Polymarket' : 'Kalshi'),
                category: market.category_display || market.category
            } : { key };
        });

        const payload = {
            timestamp: new Date().toISOString(),
            feedbackType: feedbackType.value,
            notes: notes ? notes.value : '',
            markets: marketData
        };

        // Submit to Google Form (we'll use a webhook/form URL)
        submitToGoogleForm(payload);

        closeFeedbackModal();
        exitReviewMode();
        showToast('Thanks! Your feedback has been submitted.');
    }

    function submitToGoogleForm(payload) {
        // Google Apps Script Web App URL
        const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgU7PdbBeNHtTdayn8pqb99JEsEc3JXfxKP5yXxHzuzXm5zQXm-nnNg6xa9G6zrixVnQ/exec';

        // Store locally as backup
        const existing = JSON.parse(localStorage.getItem('marketFeedback') || '[]');
        existing.push(payload);
        localStorage.setItem('marketFeedback', JSON.stringify(existing));

        console.log('Feedback submitted:', payload);

        // Submit to Google Sheet if URL is configured
        if (GOOGLE_SCRIPT_URL) {
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(err => console.error('Failed to submit to Google Sheet:', err));
        }
    }

    function showToast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
