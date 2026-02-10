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

    // Render election card (cross-platform comparison)
    function renderElectionCard(e, index) {
        const change = formatChange(e.price_change_24h);
        const spread = formatSpread(e.pm_price, e.k_price);
        const spreadStatus = getSpreadStatus(spread.pts);
        const cardClass = index === 0 ? 'market-card is-featured clickable' : 'market-card clickable';

        // Use question as title, fall back to label
        const title = e.pm_question || e.k_question || e.label || 'Unknown market';

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

        const spreadClass = spreadStatus.class ? `spread ${spreadStatus.class}` : 'spread';
        const spreadBox = `<div class="price-box">
            <div class="price-box-label">Spread</div>
            <div class="price-box-value ${spreadClass}">${spread.text}</div>
        </div>`;

        let pricesHtml;
        if (e.has_both) {
            pricesHtml = `<div class="market-card-prices three-col">${pmBox}${kBox}${spreadBox}</div>`;
        } else if (e.has_pm) {
            pricesHtml = `<div class="market-card-prices single-col">${pmBox}</div>`;
        } else {
            pricesHtml = `<div class="market-card-prices single-col">${kBox}</div>`;
        }

        let noteHtml = spreadStatus.note ? `<div class="market-card-note">${spreadStatus.note}</div>` : '';

        const changeArrow = change.raw > 0 ? '↑' : change.raw < 0 ? '↓' : '';
        const changeText = change.raw !== 0 ? `${changeArrow} ${change.text} (24h)` : change.text;

        // Image thumbnail (PM only)
        const imageHtml = e.image ? `<div class="market-card-image"><img src="${e.image}" alt="" loading="lazy"></div>` : '';
        const headerClass = e.image ? 'market-card-header has-image' : 'market-card-header';

        return `
            <div class="${cardClass}" data-market-key="${e.key}">
                <div class="${headerClass}">
                    ${imageHtml}
                    <div class="market-card-header-text">
                        <div class="market-card-badges">
                            <span class="category-tag">${e.category_display || 'Electoral'}</span>
                        </div>
                        <div class="market-card-title">${truncate(title, 100)}</div>
                    </div>
                </div>
                ${pricesHtml}
                <div class="market-card-footer">
                    <span class="market-card-change ${change.class}">${changeText}</span>
                    <span class="market-card-volume">${formatVolume(e.total_volume)}</span>
                </div>
                ${noteHtml}
            </div>
        `;
    }

    // Render individual market card (non-electoral)
    function renderMarketCard(m, index) {
        const change = formatChange(m.price_change_24h);
        const cardClass = index === 0 ? 'market-card is-featured clickable' : 'market-card clickable';
        const platformClass = m.platform === 'Polymarket' ? 'pm' : 'kalshi';
        const platformLabel = m.platform === 'Polymarket' ? 'PM' : 'K';

        const changeArrow = change.raw > 0 ? '↑' : change.raw < 0 ? '↓' : '';
        const changeText = change.raw !== 0 ? `${changeArrow} ${change.text}` : change.text;

        // Image thumbnail (PM only)
        const imageHtml = m.image ? `<div class="market-card-image"><img src="${m.image}" alt="" loading="lazy"></div>` : '';
        const headerClass = m.image ? 'market-card-header has-image' : 'market-card-header';

        return `
            <div class="${cardClass}" data-market-key="${m.key}">
                <div class="${headerClass}">
                    ${imageHtml}
                    <div class="market-card-header-text">
                        <div class="market-card-badges">
                            <span class="platform-badge ${platformClass}">${platformLabel}</span>
                            <span class="category-tag">${m.category_display || 'Other'}</span>
                        </div>
                        <div class="market-card-title">${truncate(m.label, 100)}</div>
                    </div>
                </div>
                <div class="market-card-prices single-col">
                    <div class="price-box">
                        <div class="price-box-label">Price</div>
                        <div class="price-box-value ${platformClass}">${formatPrice(m.price)}</div>
                    </div>
                </div>
                <div class="market-card-footer">
                    <span class="market-card-change ${change.class}">${changeText}</span>
                    <span class="market-card-volume">${formatVolume(m.volume || m.total_volume)}</span>
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

            // Search filter
            if (filters.search) {
                const search = filters.search.toLowerCase();
                const label = (m.label || '').toLowerCase();
                const question = (m.pm_question || m.k_question || '').toLowerCase();
                if (!label.includes(search) && !question.includes(search)) return false;
            }

            return true;
        });

        updateTabCounts();
    }

    function getSortedMarkets() {
        let sorted = [...filteredMarkets];

        switch (currentView) {
            case 'biggest_moves':
                sorted = sorted.filter(m => m.price_change_24h !== null);
                sorted.sort((a, b) => Math.abs(b.price_change_24h || 0) - Math.abs(a.price_change_24h || 0));
                break;
            case 'highest_volume':
                sorted.sort((a, b) => (b.total_volume || b.volume || 0) - (a.total_volume || a.volume || 0));
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
        const loadMoreBtn = document.getElementById('monitor-load-more');
        if (!container) return;

        const sorted = getSortedMarkets();

        if (sorted.length === 0) {
            container.innerHTML = `<div class="monitor-empty">No markets found matching these filters</div>`;
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }

        const toShow = sorted.slice(0, displayCount);
        container.innerHTML = toShow.map((m, i) => renderCard(m, i)).join('');

        setupCardClickHandlers();

        // Re-add checkboxes if in review mode
        if (reviewMode) {
            addCheckboxesToCards();
        }

        if (loadMoreBtn) {
            loadMoreBtn.style.display = sorted.length > displayCount ? 'block' : 'none';
        }
    }

    function updateTabCounts() {
        const movesCount = document.getElementById('tab-count-moves');
        const volumeCount = document.getElementById('tab-count-volume');
        const divergencesCount = document.getElementById('tab-count-divergences');

        const withChange = filteredMarkets.filter(m => m.price_change_24h !== null);
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
            const response = await fetch('data/active_markets.json');
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

        loadMonitorData();
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
