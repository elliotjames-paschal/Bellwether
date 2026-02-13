/**
 * Political Prediction Markets Dashboard
 * Research-quality chart rendering with Plotly
 */

const COLORS = {
    pm: '#2563eb',
    kalshi: '#10b981',
    line: '#e5e7eb',
    text: '#6b7280',
    dark: '#1f2937',
    gray: '#9ca3af'
};

// Translucent colors for charts
const COLORS_SOFT = {
    pm: 'rgba(37, 99, 235, 0.6)',
    kalshi: 'rgba(16, 185, 129, 0.6)',
    pm_line: 'rgba(37, 99, 235, 0.8)',
    kalshi_line: 'rgba(16, 185, 129, 0.8)'
};

// Cohort colors - blues matching website theme
const COHORT_COLORS = {
    '7d': 'rgba(91, 141, 238, 0.4)',   // Blue - lightest
    '14d': 'rgba(91, 141, 238, 0.6)',  // Blue - light
    '30d': 'rgba(91, 141, 238, 0.8)',  // Blue - medium
    '60d': 'rgba(91, 141, 238, 1)'     // Blue - darkest (#5B8DEE)
};

const LAYOUT_DEFAULTS = {
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', size: 12, color: COLORS.text },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 50, r: 20, t: 10, b: 40 },
    showlegend: true,
    legend: { orientation: 'h', y: 1.12, x: 0, font: { size: 11 } }
};

const CONFIG = { responsive: true, displayModeBar: false };

// Category definitions (from GPT classification prompt in pipeline_classify_categories.py)
const CATEGORY_DEFINITIONS = {
    'Electoral': 'Elections at all levels (federal, state, local, international) — who wins, vote shares, candidate performance, election outcomes',
    'Monetary Policy': 'Fed decisions, interest rates, inflation, central bank',
    'Legislative': 'Congressional actions, bills, votes, legislation',
    'Appointments': 'Government nominations, confirmations, cabinet picks',
    'Regulatory': 'Agency decisions (SEC, FDA, EPA), regulatory approvals',
    'International': 'Foreign policy, sanctions, trade, diplomacy, treaties',
    'Judicial': 'Court decisions, legal rulings, Supreme Court cases',
    'Military Security': 'Military actions, defense, conflicts, cybersecurity',
    'Crisis Emergency': 'Disaster response, emergencies, pandemic response',
    'Government Operations': 'Budget, shutdowns, debt ceiling, contracts',
    'Party Politics': 'Internal party decisions, leadership, scandals (not elections)',
    'State Local': 'State/local non-election matters only (laws, ordinances, policies)',
    'Timing Events': 'Political timing, announcement scheduling',
    'Polling Approval': 'Opinion polls, approval ratings, public opinion',
    'Political Speech': 'What politicians will say, speech content'
};

function tooltipWrap(text, definitions) {
    const def = definitions[text];
    if (def) {
        return `<span class="has-tooltip">${text}<span class="tooltip-text">${def}</span></span>`;
    }
    return text;
}

// Animate number counting up
function animateValue(element, start, end, duration, isDecimal = false) {
    if (!element) return;
    const startTime = performance.now();
    const update = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = start + (end - start) * easeOut;
        if (isDecimal) {
            element.textContent = current.toFixed(2);
        } else {
            element.textContent = Math.floor(current).toLocaleString();
        }
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    };
    requestAnimationFrame(update);
}

// Animate volume counting up (special format: $X.XB)
function animateVolume(element, endBillions, duration) {
    if (!element) return;
    const startTime = performance.now();
    const update = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = endBillions * easeOut;
        element.textContent = '$' + current.toFixed(1) + 'B';
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    };
    requestAnimationFrame(update);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadSummary();
    await loadInsights();
    await loadAggregateStatistics();
    await loadElectionTypes();
    await loadMiniCalibration();
    await loadBrierByCategory();
    await loadBrierByElectionType();
    await loadBrierConvergence();
    await loadCalibration();
    await loadCalibrationDistribution();
    await loadPlatformComparison();
    await loadHeadToHead();
    await loadPlatformStats();
    await loadMarketDistribution();
    await loadVolumeTimeseries();
    await loadPartisanCalibration();
    await loadPartisanRegression();
    await loadTraderPartisanshipDistribution();
    await loadTraderAccuracyDistribution();
    await loadTraderPartisanshipActualVsPerfect();
    await loadCalibrationByCloseness();
    await loadPredictionVsVolume();
    await loadLiquidityByCategory();
    await loadLiquidityAccuracyAnalysis();
    await loadLiquidityPlatformComparison();
    await loadSpreadVsVolume();
    await loadLiquidityTimeseries();
});


async function fetchJSON(filename) {
    const cacheBuster = Date.now(); // Force reload every time
    const response = await fetch(`data/${filename}?v=${cacheBuster}`);
    if (!response.ok) throw new Error(`Failed to load ${filename}`);
    return response.json();
}

async function loadSummary() {
    try {
        const data = await fetchJSON('summary.json');

        const updateDate = document.getElementById('update-date');
        if (updateDate) {
            updateDate.textContent = new Date(data.last_updated).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
        }

        const heroMarkets = document.getElementById('hero-markets');
        if (heroMarkets && data.total_markets) {
            animateValue(heroMarkets, 0, data.total_markets, 1200);
        }

        const heroElectoral = document.getElementById('hero-electoral');
        if (heroElectoral && data.electoral_markets) {
            animateValue(heroElectoral, 0, data.electoral_markets, 1000);
        }

        const heroCountries = document.getElementById('hero-countries');
        if (heroCountries && data.electoral_countries) {
            heroCountries.textContent = data.electoral_countries;
        }

        const insightElectoral = document.getElementById('insight-electoral');
        const bannerElectoral = document.getElementById('banner-electoral');
        if (data.electoral_markets) {
            const electoralStr = data.electoral_markets.toLocaleString();
            if (insightElectoral) insightElectoral.textContent = electoralStr;
            if (bannerElectoral) bannerElectoral.textContent = electoralStr;
        }

        const insightBrier = document.getElementById('insight-brier');
        const bannerBrier = document.getElementById('banner-brier');
        if (data.combined_brier) {
            const brierStr = data.combined_brier.toFixed(2);
            if (insightBrier) insightBrier.textContent = brierStr;
            if (bannerBrier) bannerBrier.textContent = brierStr;
        }
    } catch (e) {
        console.warn('Could not load summary:', e);
    }
}

async function loadInsights() {
    try {
        const stats = await fetchJSON('election_winner_stats.json');

        const insightAccuracy = document.getElementById('insight-accuracy');
        const bannerAccuracy = document.getElementById('banner-accuracy');
        if (stats.shared_elections) {
            const src = stats.shared_elections.combined || stats.shared_elections.polymarket;
            const accStr = (src.accuracy * 100).toFixed(1) + '%';
            if (insightAccuracy) insightAccuracy.textContent = accStr;
            if (bannerAccuracy) bannerAccuracy.textContent = accStr;
        }

        const insightCorrelation = document.getElementById('insight-correlation');
        const bannerCorrelation = document.getElementById('banner-correlation');
        if (stats.head_to_head) {
            const corrStr = (stats.head_to_head.correlation * 100).toFixed(1) + '%';
            if (insightCorrelation) insightCorrelation.textContent = corrStr;
            if (bannerCorrelation) bannerCorrelation.textContent = corrStr;
        }

        const platformStats = await fetchJSON('platform_stats.json');
        if (platformStats.metrics) {
            const volIndex = platformStats.metrics.indexOf('Total Volume (USD)');
            if (volIndex >= 0) {
                const pmVol = platformStats.polymarket[volIndex];
                const kalshiVol = platformStats.kalshi[volIndex];
                const parseVol = (s) => parseFloat(s.replace(/[$,]/g, ''));
                const total = parseVol(pmVol) + parseVol(kalshiVol);
                const billions = (total / 1e9).toFixed(1);

                // Update hero volume with animation
                const heroVolume = document.getElementById('hero-volume');
                if (heroVolume) animateVolume(heroVolume, parseFloat(billions), 1200);
            }
        }
    } catch (e) {
        console.warn('Could not load insights:', e);
    }
}

async function loadAggregateStatistics() {
    try {
        const data = await fetchJSON('aggregate_statistics.json');
        const el = document.getElementById('table-aggregate');
        if (!el) return;

        // Find max values for bar scaling
        const maxMarkets = Math.max(...data.total_markets);
        const maxVolume = Math.max(...data.total_volume_m);

        let html = `
            <table class="platform-stats-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Total Markets</th>
                        <th>Avg Volume ($K)</th>
                        <th>Median Volume ($K)</th>
                        <th>Total Volume ($M)</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (let i = 0; i < data.categories.length; i++) {
            // Skip "Not Political" category
            if (data.categories[i] === 'Not Political') continue;

            const marketPct = (data.total_markets[i] / maxMarkets) * 100;
            const volumePct = (data.total_volume_m[i] / maxVolume) * 100;

            html += `
                <tr>
                    <td>${tooltipWrap(data.categories[i], CATEGORY_DEFINITIONS)}</td>
                    <td>
                        <div class="bar-cell">
                            <div class="bar-bg" style="width: ${marketPct}%; background: rgba(37, 99, 235, 0.15);"></div>
                            <span class="bar-value">${data.total_markets[i].toLocaleString()}</span>
                        </div>
                    </td>
                    <td>${data.avg_volume_k[i].toLocaleString()}</td>
                    <td>${data.median_volume_k[i].toLocaleString()}</td>
                    <td>
                        <div class="bar-cell">
                            <div class="bar-bg" style="width: ${volumePct}%; background: rgba(37, 99, 235, 0.15);"></div>
                            <span class="bar-value">${data.total_volume_m[i].toLocaleString()}</span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // Add totals row
        const totalMarkets = data.total_markets.reduce((a, b) => a + b, 0);
        const totalVolume = data.total_volume_m.reduce((a, b) => a + b, 0);
        html += `
                <tr style="font-weight: 600; border-top: 2px solid var(--gray-300);">
                    <td>Total</td>
                    <td>${totalMarkets.toLocaleString()}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>$${totalVolume.toLocaleString()}M</td>
                </tr>
        `;

        html += '</tbody></table>';
        el.innerHTML = html;
    } catch (e) {
        console.warn('Could not load aggregate statistics:', e);
        showError('table-aggregate');
    }
}

async function loadElectionTypes() {
    try {
        const data = await fetchJSON('election_types.json');
        const el = document.getElementById('table-election-types');
        if (!el) return;

        // Find max for bar scaling
        const maxTotal = Math.max(...data.total);

        let html = `
            <table class="platform-stats-table">
                <thead>
                    <tr>
                        <th>Election Type</th>
                        <th style="color: ${COLORS.pm}">Polymarket</th>
                        <th style="color: ${COLORS.kalshi}">Kalshi</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (let i = 0; i < data.election_types.length; i++) {
            const pm = data.polymarket[i];
            const kalshi = data.kalshi[i];
            const total = data.total[i];
            const pmPct = total > 0 ? (pm / total) * 100 : 0;
            const kalshiPct = total > 0 ? (kalshi / total) * 100 : 0;

            html += `
                <tr>
                    <td${data.election_types[i] === 'Other' ? ' title="Markets that could not be cleanly categorized into a specific election type by automated classification"' : ''}>${data.election_types[i]}</td>
                    <td>
                        <div class="bar-cell">
                            <div class="bar-bg" style="width: ${(pm / maxTotal) * 100}%; background: rgba(37, 99, 235, 0.2);"></div>
                            <span class="bar-value">${pm.toLocaleString()}</span>
                        </div>
                    </td>
                    <td>
                        <div class="bar-cell">
                            <div class="bar-bg" style="width: ${(kalshi / maxTotal) * 100}%; background: rgba(16, 185, 129, 0.2);"></div>
                            <span class="bar-value">${kalshi.toLocaleString()}</span>
                        </div>
                    </td>
                    <td>${total.toLocaleString()}</td>
                </tr>
            `;
        }

        // Add totals row
        const totalPM = data.polymarket.reduce((a, b) => a + b, 0);
        const totalKalshi = data.kalshi.reduce((a, b) => a + b, 0);
        const grandTotal = data.total.reduce((a, b) => a + b, 0);
        html += `
                <tr style="font-weight: 600; border-top: 2px solid var(--gray-300);">
                    <td>Total</td>
                    <td style="color: ${COLORS.pm}">${totalPM.toLocaleString()}</td>
                    <td style="color: ${COLORS.kalshi}">${totalKalshi.toLocaleString()}</td>
                    <td>${grandTotal.toLocaleString()}</td>
                </tr>
        `;

        html += '</tbody></table>';
        el.innerHTML = html;
    } catch (e) {
        console.warn('Could not load election types:', e);
        showError('table-election-types');
    }
}

async function loadMiniCalibration() {
    try {
        const data = await fetchJSON('calibration.json');

        const perfect = {
            x: [0, 1], y: [0, 1],
            mode: 'lines',
            line: { color: COLORS.line, dash: 'dash', width: 1 },
            showlegend: false,
            hoverinfo: 'skip'
        };

        const points = {
            x: data.quantile_bins.predicted,
            y: data.quantile_bins.actual,
            mode: 'markers',
            name: 'Quantile Bins',
            marker: {
                size: 6,
                color: COLORS_SOFT.pm,
                line: { color: COLORS.pm, width: 1 }
            },
            hovertemplate: 'Predicted: %{x:.0%}<br>Actual: %{y:.0%}<extra></extra>'
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            showlegend: false,
            xaxis: { title: 'Predicted', range: [0, 1], tickformat: '.0%', gridcolor: COLORS.line, zeroline: false },
            yaxis: { title: 'Actual', range: [0, 1], tickformat: '.0%', gridcolor: COLORS.line, zeroline: false },
            margin: { l: 50, r: 20, t: 10, b: 50 }
        };

        Plotly.newPlot('mini-calibration', [perfect, points], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load mini calibration:', e);
    }
}

async function loadBrierByCategory() {
    try {
        const data = await fetchJSON('brier_by_category.json');

        // Filter out "Not Political" category
        const validIndices = data.categories
            .map((cat, i) => ({ cat, i }))
            .filter(({ cat }) => cat !== 'Not Political')
            .map(({ i }) => i);

        // Sort by combined average Brier (best at top for horizontal bar)
        const indices = validIndices;
        indices.sort((a, b) => {
            const aAvg = ((data.polymarket.brier[a] || 0) + (data.kalshi.brier[a] || 0)) / 2;
            const bAvg = ((data.polymarket.brier[b] || 0) + (data.kalshi.brier[b] || 0)) / 2;
            return bAvg - aAvg;
        });

        const categories = indices.map(i => data.categories[i]);
        const pmBrier = indices.map(i => data.polymarket.brier[i]);
        const kalshiBrier = indices.map(i => data.kalshi.brier[i]);

        const pm = {
            y: categories, x: pmBrier,
            name: 'Polymarket',
            type: 'bar', orientation: 'h',
            marker: { color: COLORS_SOFT.pm }
        };

        const kalshi = {
            y: categories, x: kalshiBrier,
            name: 'Kalshi',
            type: 'bar', orientation: 'h',
            marker: { color: COLORS_SOFT.kalshi }
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'group',
            bargap: 0.2,
            xaxis: { title: 'Brier Score', gridcolor: COLORS.line, zeroline: false },
            yaxis: { automargin: true },
            margin: { l: 140, r: 20, t: 30, b: 50 }
        };

        Plotly.newPlot('chart-category', [pm, kalshi], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load category chart:', e);
        showError('chart-category');
    }
}

async function loadBrierByElectionType() {
    try {
        const data = await fetchJSON('brier_by_election_type.json');

        // Take top 10 by volume
        const indices = data.election_types.map((_, i) => i);
        indices.sort((a, b) => {
            const aCount = (data.polymarket.count[a] || 0) + (data.kalshi.count[a] || 0);
            const bCount = (data.polymarket.count[b] || 0) + (data.kalshi.count[b] || 0);
            return bCount - aCount;
        });

        const top = indices.slice(0, 10);
        const types = top.map(i => data.election_types[i]);
        const pmBrier = top.map(i => data.polymarket.brier[i]);
        const kalshiBrier = top.map(i => data.kalshi.brier[i]);

        const pm = {
            y: types.slice().reverse(), x: pmBrier.slice().reverse(),
            name: 'Polymarket',
            type: 'bar', orientation: 'h',
            marker: { color: COLORS_SOFT.pm }
        };

        const kalshi = {
            y: types.slice().reverse(), x: kalshiBrier.slice().reverse(),
            name: 'Kalshi',
            type: 'bar', orientation: 'h',
            marker: { color: COLORS_SOFT.kalshi }
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'group',
            bargap: 0.2,
            xaxis: { title: 'Brier Score', gridcolor: COLORS.line, zeroline: false },
            yaxis: { automargin: true },
            margin: { l: 120, r: 20, t: 30, b: 50 }
        };

        Plotly.newPlot('chart-election-type', [pm, kalshi], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load election type chart:', e);
        showError('chart-election-type');
    }
}

async function loadBrierByMargin() {
    try {
        const data = await fetchJSON('brier_by_margin.json');

        const pm = {
            x: data.margins,
            y: data.polymarket.brier,
            name: 'Polymarket',
            type: 'bar',
            marker: { color: COLORS_SOFT.pm }
        };

        const kalshi = {
            x: data.margins,
            y: data.kalshi.brier,
            name: 'Kalshi',
            type: 'bar',
            marker: { color: COLORS_SOFT.kalshi }
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'group',
            bargap: 0.3,
            xaxis: { title: 'Election Margin (Vote Difference)', gridcolor: COLORS.line },
            yaxis: { title: 'Brier Score', gridcolor: COLORS.line, zeroline: false },
            margin: { l: 60, r: 20, t: 30, b: 60 }
        };

        Plotly.newPlot('chart-margin', [pm, kalshi], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load margin chart:', e);
        showError('chart-margin');
    }
}

async function loadBrierConvergence() {
    try {
        const data = await fetchJSON('brier_convergence.json');

        const traces = [];
        const cohortOrder = ['60d', '30d', '14d', '7d'];

        for (const cohort of cohortOrder) {
            if (data.cohorts[cohort]) {
                const c = data.cohorts[cohort];
                traces.push({
                    x: c.days,
                    y: c.scores,
                    mode: 'lines+markers',
                    name: `${cohort} (n=${c.n.toLocaleString()})`,
                    line: { color: COHORT_COLORS[cohort], width: 2.5 },
                    marker: { size: 5 },
                    hovertemplate: `${cohort}: %{y:.4f} at %{x}d<extra></extra>`
                });
            }
        }

        const layout = {
            ...LAYOUT_DEFAULTS,
            xaxis: {
                title: 'Days Before Resolution',
                autorange: 'reversed',
                gridcolor: COLORS.line,
                zeroline: false
            },
            yaxis: {
                title: 'Brier Score',
                gridcolor: COLORS.line,
                zeroline: false,
                tickformat: '.2f'
            },
            legend: {
                orientation: 'h',
                y: -0.2,
                x: 0.5,
                xanchor: 'center',
                font: { size: 11 }
            },
            margin: { l: 60, r: 20, t: 20, b: 100 }
        };

        Plotly.newPlot('chart-convergence', traces, layout, CONFIG);
    } catch (e) {
        console.warn('Could not load convergence chart:', e);
        showError('chart-convergence');
    }
}

async function loadCalibration() {
    try {
        const data = await fetchJSON('calibration.json');

        // Perfect calibration line
        const perfect = {
            x: [0, 1], y: [0, 1],
            mode: 'lines',
            name: 'Perfect Calibration',
            line: { color: COLORS.gray, dash: 'dash', width: 2 },
            hoverinfo: 'skip'
        };

        // Quantile bins scatter plot (like paper)
        // Each point is a bin of ~160 predictions, not individual predictions
        const points = {
            x: data.quantile_bins.predicted,
            y: data.quantile_bins.actual,
            mode: 'markers',
            name: 'Quantile Bins',
            marker: {
                size: 10,
                color: COLORS_SOFT.pm,
                line: { color: COLORS.pm, width: 1 }
            },
            text: data.quantile_bins.count.map(c => `n=${c.toLocaleString()}`),
            hovertemplate: 'Predicted: %{x:.1%}<br>Actual: %{y:.1%}<br>%{text}<extra></extra>'
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            showlegend: false,
            xaxis: {
                title: 'Predicted Probability',
                range: [0, 1],
                tickformat: '.0%',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 0.2, 0.4, 0.6, 0.8, 1.0]
            },
            yaxis: {
                title: 'Actual Frequency',
                range: [0, 1],
                tickformat: '.0%',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 0.2, 0.4, 0.6, 0.8, 1.0]
            },
            margin: { l: 70, r: 30, t: 20, b: 60 },
            annotations: [{
                x: 0.98, y: 0.02,
                xref: 'paper', yref: 'paper',
                text: `Total: ${data.total_predictions.toLocaleString()} predictions`,
                showarrow: false,
                font: { size: 11, color: COLORS.text }
            }]
        };

        Plotly.newPlot('chart-calibration', [perfect, points], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load calibration:', e);
        showError('chart-calibration');
    }
}

async function loadCalibrationDistribution() {
    try {
        const data = await fetchJSON('calibration.json');

        // Combine both platforms for a cleaner view
        const combined = data.distribution.x.map((x, i) =>
            (data.distribution.polymarket[i] || 0) + (data.distribution.kalshi[i] || 0)
        );
        const totalCount = (data.polymarket_count || 0) + (data.kalshi_count || 0);

        const barTrace = {
            x: data.distribution.x,
            y: combined,
            type: 'bar',
            marker: {
                color: 'rgba(37, 99, 235, 0.4)',
                line: { color: 'rgba(37, 99, 235, 0.6)', width: 1 }
            },
            hovertemplate: '%{x:.0%}: %{y:,} predictions<extra></extra>'
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            showlegend: false,
            xaxis: {
                title: 'Market Prediction',
                range: [0, 1],
                tickformat: '.0%',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 0.25, 0.5, 0.75, 1.0]
            },
            yaxis: {
                title: 'Number of Predictions',
                gridcolor: COLORS.line,
                zeroline: false
            },
            margin: { l: 70, r: 30, t: 20, b: 60 },
            bargap: 0.1,
            annotations: [{
                x: 0.5, y: 0.95,
                xref: 'paper', yref: 'paper',
                text: `n = ${totalCount.toLocaleString()} total predictions`,
                showarrow: false,
                font: { size: 11, color: COLORS.text }
            }]
        };

        Plotly.newPlot('chart-calibration-dist', [barTrace], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load calibration distribution:', e);
        showError('chart-calibration-dist');
    }
}

async function loadPlatformComparison() {
    try {
        const data = await fetchJSON('platform_comparison.json');

        const diagonal = {
            x: [-0.02, 1.05], y: [-0.02, 1.05],
            mode: 'lines',
            name: 'Perfect Agreement',
            line: { color: COLORS.gray, dash: 'dash', width: 2 },
            hoverinfo: 'skip'
        };

        const scatter = {
            x: data.kalshi_predictions,
            y: data.polymarket_predictions,
            mode: 'markers',
            name: 'Shared Elections',
            marker: {
                color: 'rgba(37, 99, 235, 0.25)',
                size: 12,
                line: { color: 'rgba(37, 99, 235, 0.5)', width: 1.5 }
            },
            text: data.labels,
            hovertemplate: '%{text}<br>Kalshi: %{x:.1%}<br>Polymarket: %{y:.1%}<extra></extra>'
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            showlegend: false,
            xaxis: {
                title: 'Kalshi Prediction',
                range: [-0.02, 1.05],
                tickformat: '.0%',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 0.25, 0.5, 0.75, 1.0]
            },
            yaxis: {
                title: 'Polymarket Prediction',
                range: [-0.02, 1.05],
                tickformat: '.0%',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 0.25, 0.5, 0.75, 1.0]
            },
            margin: { l: 60, r: 20, t: 20, b: 50 },
            annotations: [{
                x: 0.98, y: 0.02,
                xref: 'paper', yref: 'paper',
                text: `n = ${data.labels.length} shared elections`,
                showarrow: false,
                font: { size: 11, color: COLORS.text }
            }]
        };

        Plotly.newPlot('chart-scatter', [diagonal, scatter], layout, { responsive: true, displayModeBar: false });
    } catch (e) {
        console.warn('Could not load platform comparison:', e);
        showError('chart-scatter');
    }
}

async function loadHeadToHead() {
    try {
        const data = await fetchJSON('election_winner_stats.json');
        const el = document.getElementById('chart-head-to-head');
        if (!el) return;

        const h2h = data.head_to_head || {};
        const shared = data.shared_elections || {};

        el.innerHTML = `
            <div class="stats-highlight">
                <div class="stats-highlight-value">${h2h.correlation ? (h2h.correlation * 100).toFixed(1) + '%' : '—'}</div>
                <div class="stats-highlight-label">Platform Correlation</div>
            </div>
            <div class="stats-grid">
                <div class="stat-box pm">
                    <div class="stat-box-value">${h2h.pm_wins || '—'}</div>
                    <div class="stat-box-label">PM More Accurate</div>
                </div>
                <div class="stat-box kalshi">
                    <div class="stat-box-value">${h2h.kalshi_wins || '—'}</div>
                    <div class="stat-box-label">Kalshi More Accurate</div>
                </div>
            </div>
            <div style="margin-top: 16px;">
                <div class="stats-row">
                    <span class="stats-row-label">Shared Elections</span>
                    <span class="stats-row-value">${h2h.n_shared || '—'}</span>
                </div>
                <div class="stats-row">
                    <span class="stats-row-label">Ties (Same Accuracy)</span>
                    <span class="stats-row-value">${h2h.ties || '—'}</span>
                </div>
                <div class="stats-row">
                    <span class="stats-row-label">PM Winner Accuracy</span>
                    <span class="stats-row-value">${shared.polymarket ? (shared.polymarket.accuracy * 100).toFixed(1) + '%' : '—'}</span>
                </div>
                <div class="stats-row">
                    <span class="stats-row-label">Kalshi Winner Accuracy</span>
                    <span class="stats-row-value">${shared.kalshi ? (shared.kalshi.accuracy * 100).toFixed(1) + '%' : '—'}</span>
                </div>
            </div>
        `;
    } catch (e) {
        console.warn('Could not load head to head:', e);
        showError('chart-head-to-head');
    }
}

async function loadPlatformStats() {
    try {
        const data = await fetchJSON('platform_stats.json');
        const el = document.getElementById('chart-platform-stats');
        if (!el) return;

        let html = `
            <table class="platform-stats-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th style="color: ${COLORS.pm}">Polymarket</th>
                        <th style="color: ${COLORS.kalshi}">Kalshi</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (let i = 0; i < data.metrics.length; i++) {
            html += `
                <tr>
                    <td>${data.metrics[i]}</td>
                    <td>${data.polymarket[i]}</td>
                    <td>${data.kalshi[i]}</td>
                </tr>
            `;
        }

        html += '</tbody></table>';
        el.innerHTML = html;
    } catch (e) {
        console.warn('Could not load platform stats:', e);
        showError('chart-platform-stats');
    }
}

async function loadMarketDistribution() {
    try {
        const data = await fetchJSON('market_distribution.json');

        const categories = data.categories;
        const pm = data.polymarket;
        const kalshi = data.kalshi;
        const total = data.total;

        // Filter out "Not Political" and sort by total (largest first)
        const indices = categories
            .map((cat, i) => ({ cat, i }))
            .filter(({ cat }) => cat !== 'Not Political')
            .map(({ i }) => i);
        indices.sort((a, b) => total[b] - total[a]);

        const pmTrace = {
            x: indices.map(i => pm[i]),
            y: indices.map(i => categories[i]),
            name: 'Polymarket',
            type: 'bar',
            orientation: 'h',
            marker: { color: COLORS_SOFT.pm }
        };

        const kalshiTrace = {
            x: indices.map(i => kalshi[i]),
            y: indices.map(i => categories[i]),
            name: 'Kalshi',
            type: 'bar',
            orientation: 'h',
            marker: { color: COLORS_SOFT.kalshi }
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'stack',
            bargap: 0.15,
            xaxis: { title: 'Number of Markets', gridcolor: COLORS.line, zeroline: false },
            yaxis: { automargin: true, autorange: 'reversed' },
            margin: { l: 150, r: 20, t: 30, b: 50 }
        };

        Plotly.newPlot('chart-distribution', [pmTrace, kalshiTrace], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load distribution chart:', e);
        showError('chart-distribution');
    }
}

// Volume chart state
let volumeData = null;
let volumeActiveCategories = new Set();
const MAX_VOLUME_CATEGORIES = 8;

// Category colors for volume chart
const VOLUME_CATEGORY_COLORS = {
    'Electoral': '#5B8DEE',           // Polymarket blue
    'Monetary Policy': '#E85D75',     // Muted red
    'Party Politics': '#2CB67D',      // Kalshi green
    'Military Security': '#F6A96C',   // Muted orange
    'International': '#9B72CB',       // Muted purple
    'Appointments': '#4ECDC4',        // Muted turquoise
    'Political Speech': '#E89F5B',    // Muted gold
    'Regulatory': '#36B3A8',          // Muted teal
    'Government Operations': '#7C8BA1', // Gray blue
    'Judicial': '#D4A373',            // Tan
    'Legislative': '#90BE6D',         // Light green
    'Crisis Emergency': '#F94144',    // Red
    'Timing Events': '#277DA1',       // Steel blue
    'Polling Approval': '#F8961E',    // Orange
    'State Local': '#43AA8B'          // Teal
};

async function loadVolumeTimeseries() {
    try {
        volumeData = await fetchJSON('volume_timeseries.json');

        // Initialize with default categories (top 8), excluding "Not Political"
        if (volumeData.defaultCategories && volumeData.defaultCategories.length > 0) {
            volumeActiveCategories = new Set(
                volumeData.defaultCategories.filter(cat => cat !== 'Not Political')
            );
        } else {
            // Take first 8 categories if no defaults specified, excluding "Not Political"
            const allCats = Object.keys(volumeData.categories).filter(cat => cat !== 'Not Political');
            volumeActiveCategories = new Set(allCats.slice(0, MAX_VOLUME_CATEGORIES));
        }

        // Build the dropdown
        buildVolumeCategoryDropdown();

        // Render the chart
        renderVolumeChart();
    } catch (e) {
        console.warn('Could not load volume chart:', e);
        showError('chart-volume');
    }
}

function buildVolumeCategoryDropdown() {
    const toggle = document.getElementById('volume-dropdown-toggle');
    const menu = document.getElementById('volume-dropdown-menu');
    const label = document.getElementById('volume-dropdown-label');
    if (!toggle || !menu || !volumeData) return;

    menu.innerHTML = '';

    // Create checkbox items for each category (exclude "Not Political")
    for (const cat of Object.keys(volumeData.categories)) {
        if (cat === 'Not Political') continue;

        const isChecked = volumeActiveCategories.has(cat);
        const item = document.createElement('div');
        item.className = 'category-dropdown-item';
        item.dataset.category = cat;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `vol-cat-${cat.replace(/\s+/g, '-')}`;
        checkbox.checked = isChecked;

        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.background = VOLUME_CATEGORY_COLORS[cat] || COLORS.gray;

        const labelEl = document.createElement('label');
        labelEl.htmlFor = checkbox.id;
        labelEl.textContent = cat;

        item.appendChild(checkbox);
        item.appendChild(dot);
        item.appendChild(labelEl);
        menu.appendChild(item);

        // Handle checkbox change
        checkbox.addEventListener('change', () => handleVolumeCategoryChange(cat, checkbox));

        // Click on row toggles checkbox
        item.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.click();
            }
        });
    }

    // Update disabled state
    updateVolumeDropdownState();

    // Toggle dropdown open/close
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('open');
        menu.classList.toggle('open');
        toggle.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!toggle.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('open');
            toggle.classList.remove('open');
        }
    });

    updateVolumeDropdownLabel();
}

function handleVolumeCategoryChange(category, checkbox) {
    if (checkbox.checked) {
        if (volumeActiveCategories.size >= MAX_VOLUME_CATEGORIES) {
            checkbox.checked = false;
            return;
        }
        volumeActiveCategories.add(category);
    } else {
        volumeActiveCategories.delete(category);
    }

    updateVolumeDropdownState();
    updateVolumeDropdownLabel();
    renderVolumeChart();
}

function updateVolumeDropdownState() {
    const menu = document.getElementById('volume-dropdown-menu');
    if (!menu) return;

    const atMax = volumeActiveCategories.size >= MAX_VOLUME_CATEGORIES;

    for (const item of menu.querySelectorAll('.category-dropdown-item')) {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (atMax && !checkbox.checked) {
            item.classList.add('disabled');
            checkbox.disabled = true;
        } else {
            item.classList.remove('disabled');
            checkbox.disabled = false;
        }
    }
}

function updateVolumeDropdownLabel() {
    const label = document.getElementById('volume-dropdown-label');
    if (!label) return;
    label.textContent = `${volumeActiveCategories.size}/${MAX_VOLUME_CATEGORIES} categories`;
}

function renderVolumeChart() {
    if (!volumeData) return;

    const traces = [];

    // Plot only active categories
    for (const cat of Object.keys(volumeData.categories)) {
        if (!volumeActiveCategories.has(cat)) continue;

        // Map zeros/small values to null (creates gaps) for log scale
        const values = volumeData.categories[cat].map(v => v > 0.001 ? v : null);
        traces.push({
            x: volumeData.months,
            y: values,
            name: cat,
            type: 'scatter',
            mode: 'lines+markers',
            line: {
                color: VOLUME_CATEGORY_COLORS[cat] || COLORS.gray,
                width: 2
            },
            marker: { size: 4 },
            connectgaps: true,
            hovertemplate: `${cat}: $%{y:.2f}M<extra></extra>`
        });
    }

    // Find July 2023 index for initial view (users can zoom out to see earlier data)
    const startMonthIndex = volumeData.months.indexOf('2023-07');
    const initialRange = startMonthIndex >= 0
        ? [volumeData.months[startMonthIndex], volumeData.months[volumeData.months.length - 1]]
        : [volumeData.months[0], volumeData.months[volumeData.months.length - 1]];

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: {
            title: '',
            gridcolor: COLORS.line,
            tickangle: -45,
            zeroline: false,
            showline: true,
            linecolor: COLORS.line,
            nticks: 15,
            tickfont: { size: 9 },
            range: initialRange
        },
        yaxis: {
            title: 'Total Volume ($M, log scale)',
            type: 'log',
            gridcolor: COLORS.line,
            zeroline: false,
            showline: true,
            linecolor: COLORS.line,
            tickvals: [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000],
            ticktext: ['$1K', '$10K', '$100K', '$1M', '$10M', '$100M', '$1,000M', '$10,000M'],
            range: [-3.5, 4]
        },
        legend: {
            orientation: 'h',
            y: 1.02,
            x: 0.5,
            xanchor: 'center',
            yanchor: 'bottom',
            font: { size: 9 }
        },
        margin: { l: 80, r: 20, t: 90, b: 80 },
        hovermode: 'x unified'
    };

    Plotly.newPlot('chart-volume', traces, layout, { responsive: true, displayModeBar: false });
}

// ============================================================================
// PARTISAN BIAS CHARTS
// ============================================================================

let calibrationData = null;

function renderCalibrationChart(platform) {
    if (!calibrationData) return;

    const platformConfig = {
        polymarket: { name: 'Polymarket', color: COLORS.pm, colorSoft: COLORS_SOFT.pm },
        kalshi: { name: 'Kalshi', color: COLORS.kalshi, colorSoft: COLORS_SOFT.kalshi }
    };

    const cfg = platformConfig[platform];
    const platformData = calibrationData[platform];
    if (!platformData || !cfg) return;

    // Perfect calibration line
    const perfect = {
        x: [0, 1], y: [0, 1],
        mode: 'lines',
        name: 'Perfect Calibration',
        line: { color: COLORS.gray, dash: 'dash', width: 2 },
        hoverinfo: 'skip'
    };

    const bins = platformData.bins;
    const dataTrace = {
        x: bins.map(b => b.predicted),
        y: bins.map(b => b.actual),
        mode: 'markers',
        name: `${cfg.name} (n=${platformData.n_elections})`,
        marker: {
            size: bins.map(b => Math.max(8, Math.sqrt(b.count) * 5)),
            color: cfg.colorSoft,
            line: { color: cfg.color, width: 1.5 }
        },
        text: bins.map(b => `n=${b.count}`),
        hovertemplate: `${cfg.name}<br>Predicted R: %{x:.0%}<br>Actual R: %{y:.0%}<br>%{text}<extra></extra>`
    };

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: {
            title: 'Predicted Republican Win Probability',
            range: [0, 1],
            tickformat: '.0%',
            gridcolor: COLORS.line,
            zeroline: false,
            tickvals: [0, 0.2, 0.4, 0.6, 0.8, 1.0]
        },
        yaxis: {
            title: 'Actual Republican Win Rate',
            range: [0, 1],
            tickformat: '.0%',
            gridcolor: COLORS.line,
            zeroline: false,
            tickvals: [0, 0.2, 0.4, 0.6, 0.8, 1.0]
        },
        legend: {
            orientation: 'h',
            y: -0.15,
            x: 0.5,
            xanchor: 'center',
            font: { size: 11 }
        },
        margin: { l: 70, r: 30, t: 20, b: 80 }
    };

    Plotly.newPlot('chart-partisan-calibration', [perfect, dataTrace], layout, CONFIG);
}

function switchCalibrationPlatform(platform, btn) {
    // Update button states
    btn.parentElement.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCalibrationChart(platform);
}

async function loadPartisanCalibration() {
    try {
        calibrationData = await fetchJSON('partisan_bias_calibration.json');
        renderCalibrationChart('polymarket');
    } catch (e) {
        console.warn('Could not load partisan calibration:', e);
        showError('chart-partisan-calibration');
    }
}

async function loadPartisanRegression() {
    try {
        const data = await fetchJSON('partisan_bias_regression.json');
        const el = document.getElementById('table-partisan-regression');
        if (!el) return;

        const models = data.models;

        // Collect all variable names across models
        const allVars = [];
        const varSet = new Set();
        for (const m of models) {
            for (const v of m.variables) {
                if (!varSet.has(v.name)) {
                    varSet.add(v.name);
                    allVars.push(v.name);
                }
            }
        }

        function formatCoef(v) {
            if (!v) return '—';
            const stars = v.p < 0.001 ? '***' : v.p < 0.01 ? '**' : v.p < 0.05 ? '*' : '';
            const bold = v.p < 0.05;
            const coefStr = v.coef.toFixed(4);
            const seStr = `(${v.se.toFixed(4)})`;
            return `<span style="${bold ? 'font-weight: 600;' : ''}">${coefStr}${stars}</span><br><span style="color: ${COLORS.text}; font-size: 0.85em;">${seStr}</span>`;
        }

        let html = `
            <table class="platform-stats-table">
                <thead>
                    <tr>
                        <th></th>
                        ${models.map(m => `<th>${m.name}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        for (const varName of allVars) {
            html += `<tr><td>${varName}</td>`;
            for (const m of models) {
                const v = m.variables.find(x => x.name === varName);
                html += `<td style="text-align: center;">${formatCoef(v)}</td>`;
            }
            html += '</tr>';
        }

        // R-squared and N rows
        html += `
                <tr style="border-top: 2px solid var(--gray-300);">
                    <td>R²</td>
                    ${models.map(m => `<td style="text-align: center;">${m.r_squared.toFixed(4)}</td>`).join('')}
                </tr>
                <tr>
                    <td>N</td>
                    ${models.map(m => `<td style="text-align: center;">${m.n.toLocaleString()}</td>`).join('')}
                </tr>
        `;

        html += '</tbody></table>';
        html += '<p style="font-size: 0.75rem; color: var(--gray-400); margin-top: 8px;">* p &lt; 0.05, ** p &lt; 0.01, *** p &lt; 0.001. Standard errors in parentheses.</p>';

        el.innerHTML = html;
    } catch (e) {
        console.warn('Could not load partisan regression:', e);
        showError('table-partisan-regression');
    }
}

// Store partisanship data globally for toggle
let partisanshipData = null;

async function loadTraderPartisanshipDistribution() {
    try {
        partisanshipData = await fetchJSON('trader_partisanship_distribution.json');
        renderPartisanshipChart('republican');

        // Populate election outcomes box
        const outcomesBox = document.getElementById('election-outcomes-box');
        if (outcomesBox && partisanshipData.election_outcomes) {
            const outcomes = partisanshipData.election_outcomes;
            outcomesBox.innerHTML = `
                <div class="label">Actual Election Outcomes (by count, n=${outcomes.n_elections}):</div>
                <div class="values">
                    <span><span class="dem-pct">Democrats won ${outcomes.dem_pct}%</span></span>
                    <span><span class="rep-pct">Republicans won ${outcomes.rep_pct}%</span></span>
                </div>
            `;
            outcomesBox.style.display = 'block';
        }
    } catch (e) {
        console.warn('Could not load trader partisanship distribution:', e);
        showError('chart-trader-partisanship');
    }
}

function renderPartisanshipChart(party) {
    if (!partisanshipData) return;

    const isRep = party === 'republican';
    const partyData = isRep ? partisanshipData.republican_bettors : partisanshipData.democrat_bettors;
    const partyColor = isRep ? '#ef4444' : '#2563eb';
    const partyLabel = isRep ? 'Pro-Republican' : 'Pro-Democrat';

    // Define colors for each bucket
    const bucketStyles = {
        'Total': { color: '#6b7280', fill: 'rgba(107, 114, 128, 0.2)' },        // gray (all traders)
        '2-5 trades': { color: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.25)' },   // purple
        '6+ trades': { color: '#10b981', fill: 'rgba(16, 185, 129, 0.25)' },    // green
    };

    // Create traces for each bucket
    const traces = [];
    const bucketOrder = ['Total', '2-5 trades', '6+ trades'];

    for (const bucket of bucketOrder) {
        const bucketData = partyData.by_trade_count[bucket];
        if (bucketData) {
            const style = bucketStyles[bucket];
            traces.push({
                x: bucketData.x,
                y: bucketData.y,
                type: 'scatter',
                mode: 'lines',
                name: `${bucket} (n=${bucketData.n.toLocaleString()})`,
                fill: 'tozeroy',
                fillcolor: style.fill,
                line: { color: style.color, width: 2 },
                hovertemplate: `${bucket}: %{x:.1f}% (mean=${bucketData.mean}%)<extra></extra>`
            });
        }
    }

    const layout = {
        ...LAYOUT_DEFAULTS,
        showlegend: true,
        xaxis: {
            title: `% of Volume Betting ${isRep ? 'Republican' : 'Democrat'}`,
            range: [0, 100],
            gridcolor: COLORS.line,
            zeroline: false
        },
        yaxis: {
            title: 'Density',
            gridcolor: COLORS.line,
            zeroline: false
        },
        margin: { l: 70, r: 30, t: 20, b: 80 },
        legend: {
            orientation: 'h',
            y: -0.15,
            x: 0.5,
            xanchor: 'center',
            font: { size: 10 }
        },
        annotations: [
            { x: 0.98, y: 0.98, xref: 'paper', yref: 'paper', text: `${partyLabel}: n=${partyData.n.toLocaleString()}, overall mean=${partyData.overall_mean}%`, showarrow: false, font: { size: 11, color: partyColor }, bgcolor: 'rgba(255,255,255,0.8)' }
        ]
    };

    Plotly.newPlot('chart-trader-partisanship', traces, layout, CONFIG);
}

function switchPartisanshipParty(party, btn) {
    const container = btn.parentElement;
    container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPartisanshipChart(party);
}

async function loadTraderAccuracyDistribution() {
    try {
        const data = await fetchJSON('trader_accuracy_distribution.json');

        // Define colors for each bucket
        const bucketStyles = {
            '1 trade': { color: '#f59e0b', fill: 'rgba(245, 158, 11, 0.25)' },      // amber
            '2-5 trades': { color: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.25)' },   // purple
            '6+ trades': { color: '#10b981', fill: 'rgba(16, 185, 129, 0.25)' },    // green
        };

        // Create traces for each bucket
        const traces = [];
        const bucketOrder = ['1 trade', '2-5 trades', '6+ trades'];

        for (const bucket of bucketOrder) {
            const bucketData = data.by_trade_count[bucket];
            if (bucketData) {
                const style = bucketStyles[bucket];
                traces.push({
                    x: bucketData.x,
                    y: bucketData.y,
                    type: 'scatter',
                    mode: 'lines',
                    name: `${bucket} (n=${bucketData.n.toLocaleString()}, mean=${bucketData.mean}%)`,
                    fill: 'tozeroy',
                    fillcolor: style.fill,
                    line: { color: style.color, width: 2 },
                    hovertemplate: `${bucket}: %{x:.1f}%<extra></extra>`
                });
            }
        }

        const layout = {
            ...LAYOUT_DEFAULTS,
            showlegend: true,
            xaxis: {
                title: '% Money Bet Correctly',
                range: [0, 100],
                gridcolor: COLORS.line,
                zeroline: false
            },
            yaxis: {
                title: 'Density',
                gridcolor: COLORS.line,
                zeroline: false
            },
            margin: { l: 70, r: 30, t: 20, b: 80 },
            legend: {
                orientation: 'h',
                y: -0.15,
                x: 0.5,
                xanchor: 'center',
                font: { size: 10 }
            },
            shapes: [
                { type: 'line', x0: 50, x1: 50, y0: 0, y1: 1, yref: 'paper', line: { color: COLORS.gray, dash: 'dash', width: 2 } }
            ],
            annotations: [
                { x: 50, y: 1.02, yref: 'paper', text: '50% (random)', showarrow: false, font: { size: 10, color: COLORS.gray } }
            ]
        };

        Plotly.newPlot('chart-trader-accuracy', traces, layout, CONFIG);
    } catch (e) {
        console.warn('Could not load trader accuracy distribution:', e);
        showError('chart-trader-accuracy');
    }
}

// Store actual vs perfect data globally for toggle
let actualVsPerfectData = null;

async function loadTraderPartisanshipActualVsPerfect() {
    try {
        actualVsPerfectData = await fetchJSON('trader_partisanship_actual_vs_perfect.json');
        renderActualVsPerfectChart('republican');
    } catch (e) {
        console.warn('Could not load trader partisanship actual vs perfect:', e);
        showError('chart-trader-actual-vs-perfect');
    }
}

function renderActualVsPerfectChart(party) {
    if (!actualVsPerfectData) return;

    const isRep = party === 'republican';
    const partyData = isRep ? actualVsPerfectData.republican_bettors : actualVsPerfectData.democrat_bettors;
    const partyLabel = isRep ? 'Pro-Republican' : 'Pro-Democrat';
    const axisLabel = isRep ? '% Volume for Republican' : '% Volume for Democrat';

    if (!partyData) return;

    // Actual KDE (filled)
    const actualTrace = {
        x: partyData.actual.x,
        y: partyData.actual.y,
        type: 'scatter',
        mode: 'lines',
        name: `Actual (mean=${partyData.actual.mean}%)`,
        fill: 'tozeroy',
        fillcolor: 'rgba(37, 99, 235, 0.3)',
        line: { color: '#2563eb', width: 2 },
        hovertemplate: 'Actual: %{x:.1f}%<extra></extra>'
    };

    // Counterfactual KDE (filled)
    const cfTrace = {
        x: partyData.counterfactual.x,
        y: partyData.counterfactual.y,
        type: 'scatter',
        mode: 'lines',
        name: `If All Correct (mean=${partyData.counterfactual.mean}%)`,
        fill: 'tozeroy',
        fillcolor: 'rgba(16, 185, 129, 0.3)',
        line: { color: '#10b981', width: 2 },
        hovertemplate: 'If Correct: %{x:.1f}%<extra></extra>'
    };

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: {
            title: axisLabel,
            range: [0, 100],
            gridcolor: COLORS.line,
            zeroline: false
        },
        yaxis: {
            title: 'Density',
            gridcolor: COLORS.line,
            zeroline: false
        },
        margin: { l: 70, r: 30, t: 20, b: 80 },
        legend: {
            orientation: 'h',
            y: -0.15,
            x: 0.5,
            xanchor: 'center',
            font: { size: 11 }
        },
        shapes: [
            { type: 'line', x0: partyData.actual.mean, x1: partyData.actual.mean, y0: 0, y1: 1, yref: 'paper', line: { color: '#2563eb', dash: 'dash', width: 2 } },
            { type: 'line', x0: partyData.counterfactual.mean, x1: partyData.counterfactual.mean, y0: 0, y1: 1, yref: 'paper', line: { color: '#10b981', dash: 'dash', width: 2 } }
        ],
        annotations: [
            { x: 0.98, y: 0.98, xref: 'paper', yref: 'paper', text: `${partyLabel}: n=${partyData.n.toLocaleString()}, shift=${partyData.shift > 0 ? '+' : ''}${partyData.shift}pp`, showarrow: false, font: { size: 11, color: COLORS.dark }, bgcolor: 'rgba(255,255,255,0.8)', borderpad: 4 }
        ]
    };

    Plotly.newPlot('chart-trader-actual-vs-perfect', [cfTrace, actualTrace], layout, CONFIG);
}

function switchActualVsPerfectParty(party, btn) {
    const container = btn.parentElement;
    container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderActualVsPerfectChart(party);
}

async function loadCalibrationByCloseness() {
    try {
        const data = await fetchJSON('calibration_by_closeness.json');
        const buckets = data.buckets;

        const labels = buckets.map(b => b.label);
        const pmBrier = buckets.map(b => b.pm_brier);
        const kBrier = buckets.map(b => b.k_brier);
        const pmN = buckets.map(b => b.pm_n);
        const kN = buckets.map(b => b.k_n);

        const pm = {
            x: labels,
            y: pmBrier,
            name: 'Polymarket',
            type: 'bar',
            marker: { color: COLORS_SOFT.pm },
            text: pmN.map(n => `n=${n}`),
            textposition: 'outside',
            textfont: { size: 10, color: COLORS.text },
            hovertemplate: 'Polymarket<br>Margin: %{x}<br>Brier: %{y:.4f}<br>n=%{customdata}<extra></extra>',
            customdata: pmN
        };

        const kalshi = {
            x: labels,
            y: kBrier,
            name: 'Kalshi',
            type: 'bar',
            marker: { color: COLORS_SOFT.kalshi },
            text: kN.map(n => `n=${n}`),
            textposition: 'outside',
            textfont: { size: 10, color: COLORS.text },
            hovertemplate: 'Kalshi<br>Margin: %{x}<br>Brier: %{y:.4f}<br>n=%{customdata}<extra></extra>',
            customdata: kN
        };

        const layout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'group',
            bargap: 0.3,
            xaxis: { title: 'Election Margin (Vote Difference)', gridcolor: COLORS.line },
            yaxis: { title: 'Brier Score', gridcolor: COLORS.line, zeroline: false },
            margin: { l: 60, r: 20, t: 30, b: 60 }
        };

        Plotly.newPlot('chart-closeness', [pm, kalshi], layout, CONFIG);
    } catch (e) {
        console.warn('Could not load calibration by closeness:', e);
        showError('chart-closeness');
    }
}

// Store prediction vs volume data and current platform
let _predVolumeData = null;
let _predVolPlatform = 'polymarket';

async function loadPredictionVsVolume() {
    try {
        _predVolumeData = await fetchJSON('prediction_vs_volume.json');
        renderPredVolumeChart();
    } catch (e) {
        console.warn('Could not load prediction vs volume:', e);
        showError('chart-pred-volume');
    }
}

function renderPredVolumeChart() {
    const data = _predVolumeData;
    if (!data || !data[_predVolPlatform]) {
        showError('chart-pred-volume');
        return;
    }

    const platData = data[_predVolPlatform];
    // Use 'yes' tokens only (handle both old and new data format)
    const plat = platData.yes || platData;

    if (!plat || !plat.points) {
        showError('chart-pred-volume');
        return;
    }

    const isKalshi = _predVolPlatform === 'kalshi';
    const markerColor = isKalshi ? 'rgba(16, 185, 129, 0.3)' : 'rgba(37, 99, 235, 0.3)';
    const lineColor = isKalshi ? 'rgba(16, 185, 129, 0.5)' : 'rgba(37, 99, 235, 0.5)';

    const scatterTrace = {
        x: plat.points.map(p => p.price),
        y: plat.points.map(p => p.volume),
        mode: 'markers',
        name: 'Markets',
        marker: {
            size: 4,
            color: markerColor,
            line: { color: lineColor, width: 0.5 }
        },
        hovertemplate: 'Price: %{x:.2f}<br>Volume: $%{y:,.0f}<extra></extra>'
    };

    const trendTrace = {
        x: plat.bins.map(b => b.price_mid),
        y: plat.bins.map(b => b.median_volume),
        mode: 'lines+markers',
        name: 'Median Volume',
        line: { color: COLORS.dark, width: 2.5 },
        marker: { size: 5, color: COLORS.dark },
        hovertemplate: 'Price: %{x:.2f}<br>Median Volume: $%{y:,.0f}<extra></extra>'
    };

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: {
            title: 'Prediction Price',
            range: [0, 1],
            gridcolor: COLORS.line,
            zeroline: false
        },
        yaxis: {
            title: 'Volume (USD, log scale)',
            type: 'log',
            gridcolor: COLORS.line,
            zeroline: false
        },
        showlegend: false,
        margin: { l: 70, r: 30, t: 20, b: 60 },
        annotations: [{
            x: 0.98, y: 0.98,
            xref: 'paper', yref: 'paper',
            text: `r = ${plat.correlation.toFixed(3)} (n=${plat.n.toLocaleString()})`,
            showarrow: false,
            font: { size: 12, color: COLORS.dark },
            bgcolor: 'rgba(255,255,255,0.8)',
            borderpad: 4
        }]
    };

    Plotly.newPlot('chart-pred-volume', [scatterTrace, trendTrace], layout, CONFIG);
}

function switchPredVolPlatform(platform, btn) {
    _predVolPlatform = platform;
    // Update button states within the same container
    const container = btn.parentElement;
    container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPredVolumeChart();
}

function showError(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerHTML = '<p style="color: #9ca3af; text-align: center; padding: 60px 20px;">Data not available</p>';
    }
}

// Helper function to resize Plotly charts in a container
function resizeChartsInContainer(container) {
    if (!container) return;
    setTimeout(() => {
        container.querySelectorAll('.chart, .chart-stats').forEach(chart => {
            if (chart.id && document.getElementById(chart.id)._fullLayout) {
                Plotly.Plots.resize(chart.id);
            }
        });
    }, 100);
}

// Tab navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        this.classList.add('active');
        const tabId = 'tab-' + this.dataset.tab;
        const tab = document.getElementById(tabId);
        tab.classList.add('active');

        // Resize all Plotly charts in the newly visible tab
        resizeChartsInContainer(tab);
    });
});

// Sub-tab navigation
function switchSubtab(subtabName, btn) {
    // Find the parent tab content
    const parentTab = btn.closest('.tab-content');

    // Remove active from subtab buttons and content within this parent only
    parentTab.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    parentTab.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

    // Add active to clicked button and corresponding content
    btn.classList.add('active');
    const subtab = document.getElementById('subtab-' + subtabName);
    subtab.classList.add('active');

    // Resize charts in the newly visible subtab
    resizeChartsInContainer(subtab);
}

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// ============================================================================
// SHARE FUNCTIONALITY
// ============================================================================

const SITE_URL = window.location.origin || 'https://bellwether.stanford.edu';

// Chart metadata for sharing
const CHART_META = {
    'chart-convergence': {
        title: 'Accuracy Improves Near Election Day',
        slug: 'convergence',
        description: 'How prediction accuracy improves as elections approach'
    },
    'chart-election-type': {
        title: 'Brier Score by Election Type',
        slug: 'election-type',
        description: 'Prediction accuracy across different election types'
    },
    'chart-category': {
        title: 'Brier Score by Political Category',
        slug: 'category',
        description: 'Prediction accuracy across political market categories'
    },
    'chart-calibration': {
        title: 'Predicted vs Actual Outcomes',
        slug: 'calibration',
        description: 'How well market predictions match actual outcomes'
    },
    'chart-calibration-dist': {
        title: 'Market Confidence Distribution',
        slug: 'confidence',
        description: 'Distribution of prediction confidence levels'
    },
    'chart-scatter': {
        title: 'Platform Agreement',
        slug: 'agreement',
        description: 'Polymarket vs Kalshi predictions on shared elections'
    },
    'chart-distribution': {
        title: 'Markets by Category',
        slug: 'distribution',
        description: 'Market coverage across political categories'
    },
    'chart-volume': {
        title: 'Trading Volume Over Time',
        slug: 'volume',
        description: 'Monthly trading volume trends by category'
    },
    'chart-margin': {
        title: 'Brier Score by Election Margin',
        slug: 'margin',
        description: 'Prediction accuracy by margin of victory'
    },
    'mini-calibration': {
        title: 'Calibration Preview',
        slug: 'mini-calibration',
        description: 'Quick view of market calibration'
    },
    'chart-partisan-calibration': {
        title: 'Republican Win Probability Calibration',
        slug: 'partisan-calibration',
        description: 'Predicted vs actual Republican win rates across platforms'
    },
    'chart-closeness': {
        title: 'Accuracy by Race Closeness',
        slug: 'closeness',
        description: 'Prediction accuracy by election margin'
    },
    'chart-pred-volume': {
        title: 'Prediction vs Volume',
        slug: 'pred-volume',
        description: 'How trading volume relates to prediction confidence'
    },
    'chart-trader-partisanship': {
        title: 'Distribution of Trader Partisanship',
        slug: 'trader-partisanship',
        description: 'How traders distribute their bets between Republican and Democrat candidates'
    },
    'chart-trader-accuracy': {
        title: 'Distribution of Trader Accuracy',
        slug: 'trader-accuracy',
        description: 'Distribution of trader accuracy in predicting election outcomes'
    },
    'chart-trader-actual-vs-perfect': {
        title: 'Trader Partisanship: Actual vs Perfect',
        slug: 'trader-actual-vs-perfect',
        description: 'Comparing actual trader partisanship with counterfactual if all bets were correct'
    }
};

// Toggle share dropdown
function toggleShareDropdown(btn) {
    const dropdown = btn.nextElementSibling;
    const isOpen = dropdown.classList.contains('show');

    // Close all other dropdowns
    document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));

    if (!isOpen) {
        dropdown.classList.add('show');
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.share-container')) {
        document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));
    }
});

// Copy shareable link
function copyShareLink(chartId) {
    const meta = CHART_META[chartId] || { slug: chartId };
    const url = `${SITE_URL}/#chart/${meta.slug}`;

    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('Link copied to clipboard!');
    });

    // Close dropdown
    document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));
}

// Download chart as PNG
async function downloadChartPNG(chartId) {
    const meta = CHART_META[chartId] || { title: 'Chart' };
    const chartEl = document.getElementById(chartId);

    if (!chartEl || !chartEl._fullLayout) {
        showToast('Chart not ready for export');
        return;
    }

    try {
        const dataUrl = await Plotly.toImage(chartId, {
            format: 'png',
            width: 1200,
            height: 800,
            scale: 2 // High resolution
        });

        // Create download link
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `bellwether-${meta.slug || chartId}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast('Chart downloaded!');
    } catch (e) {
        console.error('Export error:', e);
        showToast('Could not export chart');
    }

    // Close dropdown
    document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));
}

// Copy embed code
function copyEmbedCode(chartId) {
    const meta = CHART_META[chartId] || { slug: chartId, title: 'Chart' };
    const embedUrl = `${SITE_URL}/embed/${meta.slug}`;
    const embedCode = `<iframe src="${embedUrl}" width="100%" height="500" frameborder="0" title="${meta.title} - Bellwether"></iframe>`;

    navigator.clipboard.writeText(embedCode).then(() => {
        showToast('Embed code copied!');
    }).catch(() => {
        showToast('Could not copy embed code');
    });

    // Close dropdown
    document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));
}

// Share to Twitter/X
function shareToTwitter(chartId) {
    const meta = CHART_META[chartId] || { slug: chartId, title: 'Chart', description: '' };
    const url = `${SITE_URL}/#chart/${meta.slug}`;
    const text = `${meta.title} - ${meta.description}\n\nFrom Bellwether, tracking political prediction markets at scale.`;

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, '_blank', 'width=550,height=420');

    // Close dropdown
    document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('show'));
}

// Toast notification
function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.share-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'share-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 2.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// Initialize share buttons after DOM is ready
function initShareButtons() {
    document.querySelectorAll('.chart-header').forEach(header => {
        // Skip if already has share button
        if (header.querySelector('.share-container')) return;

        // Find the chart ID from the sibling chart div
        const chartCard = header.closest('.chart-card');
        if (!chartCard) return;

        const chartDiv = chartCard.querySelector('.chart, .chart-stats');
        if (!chartDiv || !chartDiv.id) return;

        const chartId = chartDiv.id;

        // Create share button container
        const shareContainer = document.createElement('div');
        shareContainer.className = 'share-container';
        shareContainer.innerHTML = `
            <button class="share-btn" onclick="toggleShareDropdown(this)" title="Share this chart">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
            </button>
            <div class="share-dropdown">
                <button onclick="copyShareLink('${chartId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    Copy Link
                </button>
                <button onclick="downloadChartPNG('${chartId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download PNG
                </button>
                <button onclick="shareToTwitter('${chartId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    Share on X
                </button>
                <button onclick="copyEmbedCode('${chartId}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="16 18 22 12 16 6"/>
                        <polyline points="8 6 2 12 8 18"/>
                    </svg>
                    Copy Embed
                </button>
            </div>
        `;

        header.appendChild(shareContainer);
    });
}

// ============================================================================
// LIQUIDITY CHARTS
// ============================================================================

let liquidityCategoryData = null;
let brierCategoryData = null;
let currentLiquidityCategoryMetric = 'spread';

async function loadLiquidityByCategory() {
    try {
        liquidityCategoryData = await fetchJSON('liquidity_by_category.json');
        brierCategoryData = await fetchJSON('brier_by_category.json');

        renderLiquidityCategory('spread');
    } catch (e) {
        console.warn('Could not load liquidity by category:', e);
        showError('chart-liquidity-category');
    }
}

function renderLiquidityCategory(metric) {
    if (!liquidityCategoryData) return;
    const data = liquidityCategoryData;

    // Filter out "Not Political" category
    const validIndices = data.categories
        .map((cat, i) => ({ cat, i }))
        .filter(({ cat }) => cat !== 'Not Political')
        .map(({ i }) => i);

    const filteredCategories = validIndices.map(i => data.categories[i]);
    const filteredPmSpread = validIndices.map(i => data.polymarket.spread[i]);
    const filteredPmDepth = validIndices.map(i => data.polymarket.depth[i]);
    const filteredKalshiSpread = validIndices.map(i => data.kalshi.spread[i]);
    const filteredKalshiDepth = validIndices.map(i => data.kalshi.depth[i]);

    const isSpread = metric === 'spread';
    const title = document.getElementById('liquidity-category-title');
    const desc = document.getElementById('liquidity-category-desc');

    if (title) title.textContent = isSpread ? 'Bid-Ask Spread by Category' : 'Order Book Depth by Category';
    if (desc) desc.textContent = isSpread
        ? 'Median relative spread (%) by political category. Lower spreads indicate tighter markets with better liquidity.'
        : 'Median total depth (contracts) by political category. Higher depth means more liquidity available at posted prices.';

    const pmTrace = {
        y: filteredCategories,
        x: isSpread ? filteredPmSpread : filteredPmDepth,
        name: 'Polymarket',
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS_SOFT.pm },
        hovertemplate: isSpread ? '%{y}: %{x:.1f}%<extra>Polymarket</extra>' : '%{y}: %{x:,.0f}<extra>Polymarket</extra>'
    };

    const kalshiTrace = {
        y: filteredCategories,
        x: isSpread ? filteredKalshiSpread : filteredKalshiDepth,
        name: 'Kalshi',
        type: 'bar',
        orientation: 'h',
        marker: { color: COLORS_SOFT.kalshi },
        hovertemplate: isSpread ? '%{y}: %{x:.1f}%<extra>Kalshi</extra>' : '%{y}: %{x:,.0f}<extra>Kalshi</extra>'
    };

    const layout = {
        ...LAYOUT_DEFAULTS,
        barmode: 'group',
        bargap: 0.2,
        xaxis: {
            title: isSpread ? 'Median Relative Spread (%)' : 'Median Depth (contracts)',
            type: isSpread ? 'linear' : 'log',
            gridcolor: COLORS.line,
            zeroline: false
        },
        yaxis: { automargin: true },
        margin: { l: 140, r: 20, t: 30, b: 50 },
        annotations: [{
            x: 0.98, y: 0.02,
            xref: 'paper', yref: 'paper',
            text: `n = ${data.total_markets.toLocaleString()} markets`,
            showarrow: false,
            font: { size: 11, color: COLORS.text }
        }]
    };

    Plotly.newPlot('chart-liquidity-category', [pmTrace, kalshiTrace], layout, CONFIG);
}

function switchLiquidityCategoryMetric(metric, btn) {
    currentLiquidityCategoryMetric = metric;
    document.querySelectorAll('#subtab-liquidity-by-category .chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLiquidityCategory(metric);
}

let liquidityAccuracyData = null;
let selectedLiquidityMetric = 'depth';  // 'spread' or 'depth'
let selectedLiquidityCategory = 'overall';

async function loadLiquidityAccuracyAnalysis() {
    try {
        liquidityAccuracyData = await fetchJSON('liquidity_accuracy_analysis.json');
        renderLiquidityAccuracy();
    } catch (e) {
        console.warn('Could not load liquidity accuracy analysis:', e);
        showError('chart-liquidity-accuracy');
    }
}

function setLiquidityMetric(metric) {
    selectedLiquidityMetric = metric;
    // Update button states
    document.getElementById('btn-metric-spread').classList.toggle('active', metric === 'spread');
    document.getElementById('btn-metric-depth').classList.toggle('active', metric === 'depth');
    renderLiquidityAccuracy();
}

function setLiquidityCategory(category) {
    selectedLiquidityCategory = category;
    renderLiquidityAccuracy();
}

function renderLiquidityAccuracy() {
    if (!liquidityAccuracyData) return;

    const metricData = liquidityAccuracyData[selectedLiquidityMetric];
    if (!metricData) return;

    const binCenters = liquidityAccuracyData.bin_centers;
    const traces = [];

    // Determine which data to use (overall or category)
    let sourceData, displayName, totalMarkets;
    if (selectedLiquidityCategory === 'overall') {
        sourceData = metricData.overall;
        displayName = 'All Markets';
        totalMarkets = sourceData.total_markets;
    } else {
        sourceData = metricData.categories[selectedLiquidityCategory];
        if (!sourceData) {
            sourceData = metricData.overall;
            displayName = 'All Markets';
            totalMarkets = sourceData.total_markets;
        } else {
            displayName = selectedLiquidityCategory.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            totalMarkets = sourceData.total_markets;
        }
    }

    // Get valid data points (non-null brier scores)
    const validIndices = sourceData.brier.map((b, i) => b !== null ? i : null).filter(i => i !== null);
    const counts = validIndices.map(i => sourceData.n[i]);

    // Main line - website blue
    traces.push({
        x: validIndices.map(i => binCenters[i]),
        y: validIndices.map(i => sourceData.brier[i]),
        text: counts.map(n => `n=${n}`),
        mode: 'lines',
        name: `${displayName} (n=${totalMarkets.toLocaleString()})`,
        line: { color: '#2563eb', width: 2.5, shape: 'spline', smoothing: 0.8 },
        hovertemplate: displayName + '<br>' + (selectedLiquidityMetric === 'spread' ? 'Spread' : 'Depth') + ' Percentile: %{x:.0f}%<br>Brier Score: %{y:.4f}<br>%{text}<extra></extra>'
    });

    // Determine y-axis range based on data
    const brierValues = validIndices.map(i => sourceData.brier[i]).filter(v => v !== null);
    const maxBrier = Math.max(...brierValues);
    const yMax = Math.min(Math.ceil(maxBrier * 10) / 10 + 0.05, 0.5);

    const metricLabel = selectedLiquidityMetric === 'spread' ? 'Tighter Spread' : 'Greater Depth';
    const xAxisTitle = selectedLiquidityMetric === 'spread'
        ? 'Spread Percentile (100% = tightest spread) →'
        : 'Depth Percentile (100% = most liquid) →';

    const layout = {
        ...LAYOUT_DEFAULTS,
        showlegend: false,
        xaxis: {
            title: xAxisTitle,
            gridcolor: '#e5e7eb',
            zeroline: false,
            range: [0, 100],
            tickvals: [0, 25, 50, 75, 100],
            ticktext: ['0%', '25%', '50%', '75%', '100%'],
            tickfont: { color: '#6b7280' },
            titlefont: { color: '#374151' }
        },
        yaxis: {
            title: 'Brier Score (lower = more accurate)',
            gridcolor: '#e5e7eb',
            zeroline: false,
            range: [0, yMax],
            tickfont: { color: '#6b7280' },
            titlefont: { color: '#374151' }
        },
        margin: { l: 60, r: 40, t: 40, b: 60 },
        annotations: [
            {
                x: 0.02, y: 0.98,
                xref: 'paper', yref: 'paper',
                text: `r = ${metricData.correlation.toFixed(3)}`,
                showarrow: false,
                font: { size: 12, color: '#6b7280' },
                bgcolor: 'rgba(255,255,255,0.8)',
                borderpad: 4
            },
            {
                x: 0.98, y: 0.02,
                xref: 'paper', yref: 'paper',
                text: `n = ${totalMarkets.toLocaleString()} markets`,
                showarrow: false,
                font: { size: 11, color: '#9ca3af' }
            }
        ]
    };

    Plotly.newPlot('chart-liquidity-accuracy', traces, layout, CONFIG);
}

async function loadLiquidityPlatformComparison() {
    try {
        const data = await fetchJSON('liquidity_platform_comparison.json');

        // Spread distribution
        const pmSpreadHist = {
            x: data.spread.bins,
            y: data.spread.polymarket,
            name: `Polymarket (n=${data.spread.pm_count.toLocaleString()})`,
            type: 'bar',
            marker: { color: COLORS_SOFT.pm },
            opacity: 0.7
        };

        const kSpreadHist = {
            x: data.spread.bins,
            y: data.spread.kalshi,
            name: `Kalshi (n=${data.spread.k_count.toLocaleString()})`,
            type: 'bar',
            marker: { color: COLORS_SOFT.kalshi },
            opacity: 0.7
        };

        const spreadLayout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'overlay',
            xaxis: { title: 'Relative Spread (%)', gridcolor: COLORS.line, zeroline: false, range: [0, 30] },
            yaxis: { title: 'Number of Markets', gridcolor: COLORS.line, zeroline: false },
            margin: { l: 60, r: 20, t: 30, b: 50 },
            shapes: [
                { type: 'line', x0: data.spread.pm_median, x1: data.spread.pm_median, y0: 0, y1: 1, yref: 'paper', line: { color: COLORS.pm, dash: 'dash', width: 2 } },
                { type: 'line', x0: data.spread.k_median, x1: data.spread.k_median, y0: 0, y1: 1, yref: 'paper', line: { color: COLORS.kalshi, dash: 'dash', width: 2 } }
            ],
            annotations: [
                { x: data.spread.pm_median, y: 1.05, yref: 'paper', text: `PM: ${data.spread.pm_median}%`, showarrow: false, font: { size: 10, color: COLORS.pm } },
                { x: data.spread.k_median, y: 1.05, yref: 'paper', text: `K: ${data.spread.k_median}%`, showarrow: false, font: { size: 10, color: COLORS.kalshi } }
            ]
        };

        Plotly.newPlot('chart-liquidity-spread-dist', [pmSpreadHist, kSpreadHist], spreadLayout, CONFIG);

        // Depth distribution (log scale x-axis)
        const depthBinsLog = data.depth.bins.map(b => Math.log10(Math.max(1, b)));

        const pmDepthHist = {
            x: depthBinsLog,
            y: data.depth.polymarket,
            name: `Polymarket (n=${data.depth.pm_count.toLocaleString()})`,
            type: 'bar',
            marker: { color: COLORS_SOFT.pm },
            opacity: 0.7
        };

        const kDepthHist = {
            x: depthBinsLog,
            y: data.depth.kalshi,
            name: `Kalshi (n=${data.depth.k_count.toLocaleString()})`,
            type: 'bar',
            marker: { color: COLORS_SOFT.kalshi },
            opacity: 0.7
        };

        const depthLayout = {
            ...LAYOUT_DEFAULTS,
            barmode: 'overlay',
            xaxis: {
                title: 'Depth (contracts, log scale)',
                gridcolor: COLORS.line,
                zeroline: false,
                tickvals: [0, 1, 2, 3, 4, 5, 6],
                ticktext: ['1', '10', '100', '1K', '10K', '100K', '1M']
            },
            yaxis: { title: 'Number of Markets', gridcolor: COLORS.line, zeroline: false },
            margin: { l: 60, r: 20, t: 30, b: 50 },
            annotations: [
                { x: 0.98, y: 0.98, xref: 'paper', yref: 'paper', text: `PM median: ${data.depth.pm_median.toLocaleString()}`, showarrow: false, font: { size: 10, color: COLORS.pm }, bgcolor: 'rgba(255,255,255,0.8)' },
                { x: 0.98, y: 0.90, xref: 'paper', yref: 'paper', text: `K median: ${data.depth.k_median.toLocaleString()}`, showarrow: false, font: { size: 10, color: COLORS.kalshi }, bgcolor: 'rgba(255,255,255,0.8)' }
            ]
        };

        Plotly.newPlot('chart-liquidity-depth-dist', [pmDepthHist, kDepthHist], depthLayout, CONFIG);
    } catch (e) {
        console.warn('Could not load liquidity platform comparison:', e);
        showError('chart-liquidity-spread-dist');
        showError('chart-liquidity-depth-dist');
    }
}

// Store liquidity scatter data globally for platform switching
let _liquidityScatterData = null;

async function loadSpreadVsVolume() {
    try {
        _liquidityScatterData = await fetchJSON('liquidity_spread_vs_volume.json');
        renderLiquidityScatter('polymarket');
    } catch (e) {
        console.warn('Could not load spread vs volume:', e);
        showError('chart-spread-volume');
    }
}

function renderLiquidityScatter(platform) {
    const data = _liquidityScatterData;
    if (!data || !data[platform]) {
        showError('chart-spread-volume');
        return;
    }

    const plat = data[platform];

    const scatter = {
        x: plat.points.map(p => p.volume),
        y: plat.points.map(p => p.spread),
        mode: 'markers',
        name: 'Markets',
        marker: {
            size: 5,
            color: platform === 'polymarket' ? COLORS_SOFT.pm : COLORS_SOFT.kalshi,
            opacity: 0.5
        },
        text: plat.points.map(p => p.category),
        hovertemplate: '%{text}<br>Volume: $%{x:,.0f}<br>Spread: %{y:.1f}%<extra></extra>'
    };

    const trend = {
        x: plat.trend.volume,
        y: plat.trend.spread,
        mode: 'lines+markers',
        name: 'Median Trend',
        line: { color: COLORS.dark, width: 2.5 },
        marker: { size: 5, color: COLORS.dark }
    };

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: { title: 'Volume (USD)', type: 'log', gridcolor: COLORS.line, zeroline: false },
        yaxis: { title: 'Relative Spread (%)', gridcolor: COLORS.line, zeroline: false, range: [0, Math.min(50, Math.max(...plat.points.map(p => p.spread)) * 1.1)] },
        margin: { l: 60, r: 20, t: 30, b: 50 },
        showlegend: false,
        annotations: [{
            x: 0.98, y: 0.98,
            xref: 'paper', yref: 'paper',
            text: `r = ${plat.correlation.toFixed(3)} (n=${plat.n.toLocaleString()})`,
            showarrow: false,
            font: { size: 12, color: COLORS.dark },
            bgcolor: 'rgba(255,255,255,0.8)',
            borderpad: 4
        }]
    };

    Plotly.newPlot('chart-spread-volume', [scatter, trend], layout, CONFIG);
}

function switchLiquidityPlatform(platform, btn) {
    const container = btn.parentElement;
    container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLiquidityScatter(platform);
}

let liquidityTimeseriesData = null;

function renderLiquidityTimeseries(metric) {
    if (!liquidityTimeseriesData) return;

    const data = liquidityTimeseriesData;

    // Filter out null values for each platform
    const pmX = [], pmY = [];
    const kX = [], kY = [];

    data.dates.forEach((date, i) => {
        if (data.polymarket[metric][i] !== null) {
            pmX.push(date);
            pmY.push(data.polymarket[metric][i]);
        }
        if (data.kalshi[metric][i] !== null) {
            kX.push(date);
            kY.push(data.kalshi[metric][i]);
        }
    });

    const pmTrace = {
        x: pmX,
        y: pmY,
        mode: 'lines',
        name: 'Polymarket',
        line: { color: COLORS_SOFT.pm, width: 2 }
    };

    const kTrace = {
        x: kX,
        y: kY,
        mode: 'lines+markers',
        name: 'Kalshi',
        line: { color: COLORS_SOFT.kalshi, width: 2 },
        marker: { size: 6 }
    };

    const yAxisConfig = metric === 'spread'
        ? { title: 'Median Relative Spread (%)', gridcolor: COLORS.line, zeroline: false }
        : { title: 'Median Depth (contracts)', gridcolor: COLORS.line, zeroline: false, type: 'log' };

    const layout = {
        ...LAYOUT_DEFAULTS,
        xaxis: { title: 'Date', gridcolor: COLORS.line, zeroline: false },
        yaxis: yAxisConfig,
        margin: { l: 70, r: 20, t: 30, b: 50 },
        legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(255,255,255,0.8)' },
        hovermode: 'x unified'
    };

    Plotly.newPlot('chart-liquidity-timeseries', [pmTrace, kTrace], layout, CONFIG);
}

function switchLiquidityTimeseriesMetric(metric, btn) {
    btn.parentElement.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLiquidityTimeseries(metric);

    // Update description
    const descEl = document.getElementById('liquidity-timeseries-description');
    if (descEl) {
        if (metric === 'spread') {
            descEl.textContent = 'Daily median relative spread (%) across all active markets. Lower spreads indicate tighter, more liquid markets. Data available from Oct 2025.';
        } else {
            descEl.textContent = 'Daily median order book depth (contracts) across all active markets. Higher depth means more liquidity available at posted prices. Data available from Oct 2025.';
        }
    }
}

function switchLiquidityPlatformMetric(metric, btn) {
    btn.parentElement.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const spreadChart = document.getElementById('chart-liquidity-spread-dist');
    const depthChart = document.getElementById('chart-liquidity-depth-dist');
    const titleEl = document.getElementById('liquidity-platform-title');
    const descEl = document.getElementById('liquidity-platform-desc');

    if (metric === 'spread') {
        spreadChart.style.display = '';
        depthChart.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Spread Distribution by Platform';
        if (descEl) descEl.textContent = 'Distribution of relative spreads across platforms. Which platform offers tighter markets?';
    } else {
        spreadChart.style.display = 'none';
        depthChart.style.display = '';
        if (titleEl) titleEl.textContent = 'Depth Distribution by Platform';
        if (descEl) descEl.textContent = 'Distribution of order book depth across platforms (log scale).';
    }
}

async function loadLiquidityTimeseries() {
    try {
        liquidityTimeseriesData = await fetchJSON('liquidity_timeseries.json');
        renderLiquidityTimeseries('spread');
    } catch (e) {
        console.warn('Could not load liquidity timeseries:', e);
        showError('chart-liquidity-timeseries');
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Delay to ensure charts are rendered
    setTimeout(initShareButtons, 500);
});
