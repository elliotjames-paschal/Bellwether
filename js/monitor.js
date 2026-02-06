/**
 * Market Monitor - Election markets with dual-platform display
 */

(function() {
    'use strict';

    let monitorData = null;
    let allElections = [];
    let filteredElections = [];
    let currentView = 'biggest_moves';
    let displayCount = 10;
    const CARDS_PER_PAGE = 10;

    // Filter state
    let filters = {
        type: 'all',
        region: 'all',
        search: ''
    };

    // Type options for elections
    const TYPE_OPTIONS = [
        { value: 'all', label: 'All Types' },
        { value: 'presidential', label: 'Presidential' },
        { value: 'parliamentary', label: 'Parliamentary' },
        { value: 'senate', label: 'Senate' },
        { value: 'house', label: 'House' },
        { value: 'governor', label: 'Governor' },
        { value: 'mayoral', label: 'Mayoral' },
        { value: 'primary', label: 'Primary' },
        { value: 'other', label: 'Other' },
    ];

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

    // Format election title as: Country, Location, Office, Year
    function formatElectionTitle(e) {
        const parts = [];
        if (e.country) parts.push(e.country);
        if (e.location && e.location !== e.country) parts.push(e.location);
        if (e.office) parts.push(e.office);
        if (e.year) parts.push(e.year);
        return parts.length > 0 ? parts.join(', ') : (e.label || 'Unknown Election');
    }

    // Get spread status
    function getSpreadStatus(pts) {
        if (pts === null) return { class: '', note: '' };
        if (pts < 3) return { class: 'aligned', note: 'Platforms aligned' };
        if (pts <= 5) return { class: '', note: '' };
        return { class: 'divergent', note: 'Notable divergence' };
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

    // Render a single election card
    function renderCard(e, index) {
        const change = formatChange(e.price_change_24h);
        const spread = formatSpread(e.pm_price, e.k_price);
        const spreadStatus = getSpreadStatus(spread.pts);
        const cardClass = index === 0 ? 'market-card is-featured clickable' : 'market-card clickable';

        // Candidate subtitle (shows which candidate the price is for)
        const candidate = e.pm_candidate || e.k_candidate || '';
        const candidateHtml = candidate
            ? `<div class="market-card-candidate">${candidate}</div>`
            : '';

        // Price boxes (no links - clicking card opens modal)
        const pmPrice = formatPrice(e.pm_price);
        const kPrice = formatPrice(e.k_price);

        const pmBox = `<div class="price-box">
            <div class="price-box-label">Polymarket</div>
            <div class="price-box-value pm">${pmPrice}</div>
        </div>`;

        const kBox = `<div class="price-box">
            <div class="price-box-label">Kalshi</div>
            <div class="price-box-value kalshi">${kPrice}</div>
        </div>`;

        // Spread box
        const spreadClass = spreadStatus.class ? `spread ${spreadStatus.class}` : 'spread';
        const spreadBox = `<div class="price-box">
            <div class="price-box-label">Spread</div>
            <div class="price-box-value ${spreadClass}">${spread.text}</div>
        </div>`;

        // Layout: 3-column for matched, single-column for single-platform
        let pricesHtml;
        if (e.has_both) {
            pricesHtml = `<div class="market-card-prices three-col">
                ${pmBox}
                ${kBox}
                ${spreadBox}
            </div>`;
        } else if (e.has_pm) {
            // Single platform - PM only (single column layout)
            pricesHtml = `<div class="market-card-prices single-col">
                ${pmBox}
            </div>`;
        } else {
            // Single platform - Kalshi only (single column layout)
            pricesHtml = `<div class="market-card-prices single-col">
                ${kBox}
            </div>`;
        }

        // Note for divergence
        let noteHtml = '';
        if (spreadStatus.note) {
            noteHtml = `<div class="market-card-note">${spreadStatus.note}</div>`;
        }

        // Thin market indicator
        let thinMarketHtml = '';
        if (e.total_volume < 5000) {
            thinMarketHtml = `<div class="market-card-thin">Thin market</div>`;
        }

        // Change display
        const changeArrow = change.raw > 0 ? '↑' : change.raw < 0 ? '↓' : '';
        const changeText = change.raw !== 0 ? `${changeArrow} ${change.text} (24h)` : change.text;

        const electionTitle = formatElectionTitle(e);

        return `
            <div class="${cardClass}" data-election-key="${e.key}">
                <div class="market-card-header">
                    <div class="market-card-title">${electionTitle}</div>
                    ${candidateHtml}
                </div>

                ${pricesHtml}

                <div class="market-card-footer">
                    <span class="market-card-change ${change.class}">${changeText}</span>
                    <span class="market-card-volume">${formatVolume(e.total_volume)}</span>
                </div>
                ${noteHtml}
                ${thinMarketHtml}
            </div>
        `;
    }

    // =========================================================================
    // MODAL FUNCTIONALITY
    // =========================================================================

    // Get country flag emoji (simple mapping)
    function getCountryFlag(country) {
        const flags = {
            'United States': '🇺🇸',
            'United Kingdom': '🇬🇧',
            'Canada': '🇨🇦',
            'Germany': '🇩🇪',
            'France': '🇫🇷',
            'Australia': '🇦🇺',
            'Brazil': '🇧🇷',
            'Mexico': '🇲🇽',
            'Japan': '🇯🇵',
            'India': '🇮🇳',
            'South Korea': '🇰🇷',
            'Italy': '🇮🇹',
            'Spain': '🇪🇸',
            'Poland': '🇵🇱',
            'Argentina': '🇦🇷',
            'Colombia': '🇨🇴',
            'Chile': '🇨🇱',
            'Peru': '🇵🇪',
            'Israel': '🇮🇱',
            'Turkey': '🇹🇷',
            'South Africa': '🇿🇦',
            'Nigeria': '🇳🇬',
            'New Zealand': '🇳🇿',
        };
        return flags[country] || '🌍';
    }

    // Render modal content for an election
    function renderModalContent(e) {
        const spread = formatSpread(e.pm_price, e.k_price);
        const spreadStatus = getSpreadStatus(spread.pts);
        const flag = getCountryFlag(e.country);
        const candidate = e.pm_candidate || e.k_candidate || '';
        const electionTitle = formatElectionTitle(e);

        // Meta line (just flag since title has the details)
        const metaLine = flag;

        // Price boxes
        let pricesHtml = '';
        let pricesClass = '';

        if (e.has_both) {
            pricesClass = '';
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

        // Single platform notice
        let singleNotice = '';
        if (!e.has_both) {
            const platform = e.has_pm ? 'Polymarket' : 'Kalshi';
            const otherPlatform = e.has_pm ? 'Kalshi' : 'Polymarket';
            singleNotice = `
                <div class="modal-single-notice">
                    <span class="modal-single-notice-icon">ℹ️</span>
                    <span class="modal-single-notice-text">
                        This market is only available on ${platform}.
                        Bell can't calculate cross-platform divergence for single-platform markets.
                    </span>
                </div>
            `;
        }

        // Platform links (clickable boxes to open in new tab)
        let linksHtml = '';
        const linksClass = (e.has_pm && e.has_k) ? '' : ' single';

        if (e.has_pm || e.has_k) {
            let pmLink = '';
            let kLink = '';

            if (e.has_pm && e.pm_url) {
                pmLink = `
                    <a href="${e.pm_url}" target="_blank" rel="noopener" class="modal-link-box pm">
                        <div class="modal-link-info">
                            <span class="modal-link-platform">Polymarket</span>
                            <span class="modal-link-text">View market details & trade</span>
                        </div>
                        <span class="modal-link-arrow">↗</span>
                    </a>
                `;
            }

            if (e.has_k && e.k_url) {
                kLink = `
                    <a href="${e.k_url}" target="_blank" rel="noopener" class="modal-link-box kalshi">
                        <div class="modal-link-info">
                            <span class="modal-link-platform">Kalshi</span>
                            <span class="modal-link-text">View market details & trade</span>
                        </div>
                        <span class="modal-link-arrow">↗</span>
                    </a>
                `;
            }

            linksHtml = `
                <div class="modal-links${linksClass}">
                    ${pmLink}
                    ${kLink}
                </div>
            `;
        }

        // Build embed URLs
        let pmEmbedUrl = e.pm_embed_url;
        let kEmbedUrl = e.k_embed_url;

        // Kalshi: construct embed URL from k_url if not provided
        // Uses events-categorical format with light color scheme
        if (!kEmbedUrl && e.k_url) {
            const kMatch = e.k_url.match(/\/events\/([A-Z0-9-]+)/i);
            if (kMatch) {
                kEmbedUrl = `https://kalshi.com/external-widget/events-categorical/${kMatch[1]}?color_scheme=light&widget_size=large&period=all`;
            }
        }

        // Embeds for both platforms
        let embedsHtml = '';
        if (pmEmbedUrl || kEmbedUrl) {
            let pmEmbed = '';
            let kEmbed = '';

            if (e.has_pm && pmEmbedUrl) {
                pmEmbed = `
                    <div class="modal-embed-wrapper">
                        <div class="modal-embed-header">
                            <span>Polymarket</span>
                            <a href="${e.pm_url || '#'}" target="_blank" rel="noopener">Open ↗</a>
                        </div>
                        <div class="modal-embed-frame">
                            <iframe src="${pmEmbedUrl}" loading="lazy"></iframe>
                        </div>
                    </div>
                `;
            }

            if (e.has_k && kEmbedUrl) {
                kEmbed = `
                    <div class="modal-embed-wrapper">
                        <div class="modal-embed-header">
                            <span>Kalshi</span>
                            <a href="${e.k_url || '#'}" target="_blank" rel="noopener">Open ↗</a>
                        </div>
                        <div class="modal-embed-frame">
                            <iframe src="${kEmbedUrl}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>
                        </div>
                    </div>
                `;
            }

            embedsHtml = `
                <div class="modal-embeds">
                    <div class="modal-embeds-header">Live Charts</div>
                    <div class="modal-embeds-grid" style="grid-template-columns: ${pmEmbed && kEmbed ? '1fr 1fr' : '1fr'};">
                        ${pmEmbed}
                        ${kEmbed}
                    </div>
                </div>
            `;
        }

        return `
            <div class="modal-header">
                <div class="modal-header-info">
                    <div class="modal-meta">${metaLine}</div>
                    <h2 class="modal-title">${electionTitle}</h2>
                    ${candidate ? `<div class="modal-candidate">${candidate}</div>` : ''}
                </div>
                <button class="modal-close" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                ${singleNotice}
                <div class="modal-prices${pricesClass}">
                    ${pricesHtml}
                </div>
                ${linksHtml}
                ${embedsHtml}
            </div>
        `;
    }

    // Open modal for an election
    function openModal(electionKey) {
        const election = allElections.find(e => e.key === electionKey);
        if (!election) return;

        const modal = document.getElementById('election-modal');
        const modalContent = document.getElementById('election-modal-content');

        if (!modal || !modalContent) return;

        modalContent.innerHTML = renderModalContent(election);
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';

        // Set up close button
        const closeBtn = modalContent.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
    }

    // Close modal
    function closeModal() {
        const modal = document.getElementById('election-modal');
        if (modal) {
            modal.classList.remove('visible');
            document.body.style.overflow = '';
        }
    }

    // Set up card click handlers (called after rendering)
    function setupCardClickHandlers() {
        document.querySelectorAll('.market-card.clickable').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't open modal if clicking a link
                if (e.target.tagName === 'A') return;
                const key = card.dataset.electionKey;
                if (key) openModal(key);
            });
        });
    }

    // Apply filters to elections
    function applyFilters() {
        filteredElections = allElections.filter(e => {
            // Only show elections with at least one platform
            if (!e.has_pm && !e.has_k) {
                return false;
            }

            // Type filter
            if (filters.type !== 'all' && e.type !== filters.type) {
                return false;
            }

            // Region filter
            if (filters.region !== 'all' && e.region !== filters.region) {
                return false;
            }

            // Search filter
            if (filters.search) {
                const search = filters.search.toLowerCase();
                const label = (e.label || '').toLowerCase();
                const country = (e.country || '').toLowerCase();
                const location = (e.location || '').toLowerCase();
                if (!label.includes(search) && !country.includes(search) && !location.includes(search)) {
                    return false;
                }
            }

            return true;
        });

        updateTabCounts();
    }

    // Sort elections by current view
    function getSortedElections() {
        let sorted = [...filteredElections];

        switch (currentView) {
            case 'biggest_moves':
                sorted = sorted.filter(e => e.price_change_24h !== null);
                sorted.sort((a, b) => Math.abs(b.price_change_24h || 0) - Math.abs(a.price_change_24h || 0));
                break;
            case 'highest_volume':
                sorted.sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0));
                break;
            case 'divergences':
                sorted = sorted.filter(e => e.has_both && e.spread !== null && e.spread > 0.05);
                sorted.sort((a, b) => (b.spread || 0) - (a.spread || 0));
                break;
        }

        return sorted;
    }

    // Render cards
    function renderCards() {
        const container = document.getElementById('monitor-cards');
        const loadMoreBtn = document.getElementById('monitor-load-more');

        if (!container) return;

        const sorted = getSortedElections();

        if (sorted.length === 0) {
            const emptyMessages = {
                'biggest_moves': 'No significant price movements matching these filters',
                'highest_volume': 'No active elections matching these filters',
                'divergences': 'No platform divergences detected matching these filters'
            };
            container.innerHTML = `<div class="monitor-empty">${emptyMessages[currentView] || 'No elections found'}</div>`;
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }

        const toShow = sorted.slice(0, displayCount);
        container.innerHTML = toShow.map((e, i) => renderCard(e, i)).join('');

        // Set up click handlers for the cards
        setupCardClickHandlers();

        if (loadMoreBtn) {
            loadMoreBtn.style.display = sorted.length > displayCount ? 'block' : 'none';
        }
    }

    // Update tab counts
    function updateTabCounts() {
        const movesCount = document.getElementById('tab-count-moves');
        const volumeCount = document.getElementById('tab-count-volume');
        const divergencesCount = document.getElementById('tab-count-divergences');

        const withChange = filteredElections.filter(e => e.price_change_24h !== null);
        const divergences = filteredElections.filter(e => e.has_both && e.spread !== null && e.spread > 0.05);

        if (movesCount) movesCount.textContent = withChange.length;
        if (volumeCount) volumeCount.textContent = filteredElections.length;
        if (divergencesCount) divergencesCount.textContent = divergences.length;
    }

    // Update election count
    function updateElectionCount() {
        const countEl = document.getElementById('monitor-market-count');
        if (countEl) {
            countEl.textContent = filteredElections.length.toLocaleString();
        }
    }

    // Update sidebar
    function updateSidebar() {
        if (!monitorData) return;

        // Divergence summary
        const divergenceSummary = document.getElementById('divergence-summary');
        if (divergenceSummary) {
            const divergences = filteredElections.filter(e => e.has_both && e.spread !== null && e.spread > 0.05);
            if (divergences.length > 0) {
                divergenceSummary.textContent = `Bell flagged ${divergences.length} election${divergences.length !== 1 ? 's' : ''} where Polymarket and Kalshi disagree by more than 5 points.`;
            } else {
                divergenceSummary.textContent = 'No significant disagreements between platforms right now.';
            }
        }
    }

    // Switch view
    function switchView(view) {
        currentView = view;
        displayCount = CARDS_PER_PAGE;

        document.querySelectorAll('.monitor-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        renderCards();
    }

    // Load more
    function loadMore() {
        displayCount += CARDS_PER_PAGE;
        renderCards();
    }

    // Handle filter change
    function onFilterChange() {
        const typeSelect = document.getElementById('filter-type');
        const regionSelect = document.getElementById('filter-region');
        const searchInput = document.getElementById('filter-search');

        filters.type = typeSelect ? typeSelect.value : 'all';
        filters.region = regionSelect ? regionSelect.value : 'all';
        filters.search = searchInput ? searchInput.value.trim() : '';

        // Reset display count
        displayCount = CARDS_PER_PAGE;

        // Re-apply filters and render
        applyFilters();
        updateElectionCount();
        updateSidebar();
        renderCards();
    }

    // Load monitor data
    async function loadMonitorData() {
        try {
            const response = await fetch('data/monitor_elections.json');
            if (!response.ok) throw new Error('Failed to load monitor data');
            monitorData = await response.json();

            allElections = monitorData.elections || [];
            filteredElections = [...allElections];

            applyFilters();
            updateElectionCount();
            updateTabCounts();
            updateSidebar();
            renderCards();

            // Update timestamp
            const timestampEl = document.getElementById('monitor-last-update');
            if (timestampEl && monitorData.generated_at) {
                timestampEl.textContent = formatRelativeTime(monitorData.generated_at);
            }
        } catch (err) {
            console.error('Error loading monitor data:', err);
            const container = document.getElementById('monitor-cards');
            if (container) {
                container.innerHTML = '<div class="monitor-empty">Unable to load election data. Please refresh the page.</div>';
            }
        }
    }

    // Initialize
    function init() {
        // Set up tab click handlers
        document.querySelectorAll('.monitor-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                switchView(tab.dataset.view);
            });
        });

        // Set up load more button
        const loadMoreBtn = document.getElementById('load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', loadMore);
        }

        // Set up filter handlers
        const typeSelect = document.getElementById('filter-type');
        const regionSelect = document.getElementById('filter-region');
        const searchInput = document.getElementById('filter-search');

        if (typeSelect) {
            typeSelect.addEventListener('change', onFilterChange);
        }

        if (regionSelect) {
            regionSelect.addEventListener('change', onFilterChange);
        }

        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(onFilterChange, 200);
            });
        }

        // Set up modal close on overlay click
        const modal = document.getElementById('election-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });
        }

        // Set up modal close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        // Load data
        loadMonitorData();
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
