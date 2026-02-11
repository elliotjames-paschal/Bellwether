/**
 * InteractiveGlobe - Vanilla JS/D3 rotating globe
 *
 * Loads election data from data/globe_elections.json and displays:
 *   - Live elections: pulsing blue rings (hoverable with tooltip)
 *   - Completed elections: smaller muted dots
 *
 * Auto-rotates until user interacts (hover or drag), then hands off control.
 * Resumes auto-rotation after 5 seconds of inactivity.
 * Tooltip renders above the CSS mask gradient at full opacity.
 */

// ============================================
// TopoJSON Parser
// ============================================
function topoFeature(topology, o) {
    if (typeof o === "string") o = topology.objects[o];
    return o.type === "GeometryCollection"
        ? { type: "FeatureCollection", features: o.geometries.map(function(g) { return topoToFeature(topology, g); }) }
        : topoToFeature(topology, o);
}

function topoToFeature(topology, o) {
    return { type: "Feature", id: o.id, properties: o.properties || {}, geometry: topoToGeometry(topology, o) };
}

function topoToGeometry(topology, o) {
    var type = o.type;
    if (type === "GeometryCollection") return { type: type, geometries: o.geometries.map(function(g) { return topoToGeometry(topology, g); }) };
    if (type === "Point") return { type: type, coordinates: topoPoint(topology, o.coordinates) };
    if (type === "MultiPoint") return { type: type, coordinates: o.coordinates.map(function(c) { return topoPoint(topology, c); }) };
    var arcs = o.arcs;
    if (type === "LineString") return { type: type, coordinates: topoLine(topology, arcs) };
    if (type === "MultiLineString") return { type: type, coordinates: arcs.map(function(a) { return topoLine(topology, a); }) };
    if (type === "Polygon") return { type: type, coordinates: arcs.map(function(a) { return topoRing(topology, a); }) };
    if (type === "MultiPolygon") return { type: type, coordinates: arcs.map(function(p) { return p.map(function(a) { return topoRing(topology, a); }); }) };
    return null;
}

function topoPoint(topology, position) {
    var t = topology.transform;
    return t ? [position[0] * t.scale[0] + t.translate[0], position[1] * t.scale[1] + t.translate[1]] : position;
}

function topoLine(topology, arcs) {
    var points = [];
    for (var i = 0; i < arcs.length; i++) {
        var arc = arcs[i];
        var arcData = arc < 0 ? topology.arcs[~arc].slice().reverse() : topology.arcs[arc];
        for (var j = 0; j < arcData.length; j++) {
            if (j > 0 || i === 0) {
                var p = arcData[j];
                if (topology.transform) {
                    if (j === 0 && i > 0) continue;
                    p = p.slice();
                    if (points.length > 0) {
                        var prev = points[points.length - 1];
                        p[0] = prev[0] + p[0] * topology.transform.scale[0];
                        p[1] = prev[1] + p[1] * topology.transform.scale[1];
                    } else {
                        p[0] = p[0] * topology.transform.scale[0] + topology.transform.translate[0];
                        p[1] = p[1] * topology.transform.scale[1] + topology.transform.translate[1];
                    }
                }
                points.push(p);
            }
        }
    }
    return points;
}

function topoRing(topology, arcs) {
    var coords = topoLine(topology, arcs);
    if (coords.length > 0) {
        var first = coords[0], last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first.slice());
    }
    return coords;
}

// Helper: extract shared borders from topology
function topoMesh(topology, o, filter) {
    var geom = { type: "MultiLineString", coordinates: [] };
    if (typeof o === "string") o = topology.objects[o];
    var geometries = o.geometries;
    var arcsUsed = {};

    geometries.forEach(function(g, i) {
        var rings = g.type === "Polygon" ? g.arcs : g.type === "MultiPolygon" ? [].concat.apply([], g.arcs) : [];
        rings.forEach(function(ring) {
            ring.forEach(function(arcIdx) {
                var absIdx = arcIdx < 0 ? ~arcIdx : arcIdx;
                var key = absIdx;
                if (!arcsUsed[key]) arcsUsed[key] = [];
                arcsUsed[key].push(i);
            });
        });
    });

    Object.keys(arcsUsed).forEach(function(key) {
        var indices = arcsUsed[key];
        // Only include arcs shared by 2+ geometries (internal borders)
        if (indices.length >= 2) {
            var arcData = topology.arcs[parseInt(key)];
            if (arcData) {
                var coords = [];
                arcData.forEach(function(p, j) {
                    p = p.slice();
                    if (topology.transform) {
                        if (j === 0) {
                            p[0] = p[0] * topology.transform.scale[0] + topology.transform.translate[0];
                            p[1] = p[1] * topology.transform.scale[1] + topology.transform.translate[1];
                        } else {
                            var prev = coords[coords.length - 1];
                            p[0] = prev[0] + p[0] * topology.transform.scale[0];
                            p[1] = prev[1] + p[1] * topology.transform.scale[1];
                        }
                    }
                    coords.push(p);
                });
                geom.coordinates.push(coords);
            }
        }
    });

    return geom;
}

// ============================================
// Globe
// ============================================
function initGlobe(containerId, options) {
    options = options || {};
    var size = options.size || 640;
    var rotationSpeed = options.rotationSpeed || 0.08;
    var RESUME_DELAY = 800; // ms before auto-rotate resumes

    var container = document.getElementById(containerId);
    if (!container) return;

    container.style.width = size + 'px';
    container.style.height = size + 'px';
    container.style.transition = 'transform 0.1s ease-out';
    container.style.transformOrigin = 'center center';
    container.style.position = 'relative';

    // Create SVG
    var svg = d3.select(container).append('svg')
        .attr('width', size)
        .attr('height', size)
        .style('overflow', 'visible');

    // Create tooltip on document.body so it escapes the CSS mask-image on .hero-symbol
    var tooltip = document.createElement('div');
    tooltip.className = 'globe-tooltip';
    tooltip.style.cssText = 'position:fixed;pointer-events:none;opacity:0;' +
        'background:rgba(17,17,17,0.92);color:#fff;padding:8px 12px;border-radius:8px;' +
        'font-size:12px;line-height:1.5;z-index:10000;' +
        'transition:opacity 0.15s;transform:translate(-50%,-100%);margin-top:-14px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,0.25);max-width:260px;overflow:visible;';

    // Content wrapper (so innerHTML updates don't destroy the stem)
    var tooltipContent = document.createElement('div');
    tooltipContent.style.cssText = 'overflow:hidden;';
    tooltip.appendChild(tooltipContent);

    // Tooltip stem: visible arrow + invisible bridge to the dot (prevents losing hover on dense dots)
    var tooltipStem = document.createElement('div');
    tooltipStem.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);width:24px;bottom:-18px;height:18px;';
    var tooltipArrow = document.createElement('div');
    tooltipArrow.style.cssText = 'position:absolute;top:-1px;left:50%;transform:translateX(-50%);' +
        'width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;' +
        'border-top:7px solid rgba(17,17,17,0.92);';
    tooltipStem.appendChild(tooltipArrow);
    tooltip.appendChild(tooltipStem);

    // Add marquee keyframes once
    if (!document.getElementById('globe-marquee-style')) {
        var marqStyle = document.createElement('style');
        marqStyle.id = 'globe-marquee-style';
        marqStyle.textContent = '@keyframes globe-marquee-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}' +
            '.globe-marquee-track{display:inline-block;white-space:nowrap;animation:globe-marquee-scroll var(--marquee-dur,10s) linear infinite;}';
        document.head.appendChild(marqStyle);
    }
    document.body.appendChild(tooltip);

    // Keep tooltip visible when hovering over it (for clickable links)
    var tooltipHovered = false;
    var tooltipHideTimer = null;

    function delayedHideTooltip() {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = setTimeout(function() {
            if (!tooltipHovered) {
                hoveredMarker = null;
                tooltip.style.opacity = '0';
                tooltip.style.pointerEvents = 'none';
                // Notify globe page hover ended
                if (window.onGlobeMarkerHover) {
                    window.onGlobeMarkerHover(null);
                }
                scheduleResume();
            }
        }, 150);
    }

    tooltip.addEventListener('mouseenter', function() {
        tooltipHovered = true;
        clearTimeout(tooltipHideTimer);
    });
    tooltip.addEventListener('mouseleave', function() {
        tooltipHovered = false;
        delayedHideTooltip();
    });

    // Fullscreen button - HIDDEN (functionality preserved for globe page)
    var fsBtn = document.createElement('button');
    fsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg><span style="margin-left:6px;">Explore</span>';
    fsBtn.style.cssText = 'display:none !important;';
    fsBtn.title = 'Explore globe in fullscreen';
    fsBtn.addEventListener('mouseenter', function() {
        fsBtn.style.background = '#4285f4';
        fsBtn.style.color = '#fff';
        fsBtn.style.borderColor = '#4285f4';
        fsBtn.style.boxShadow = '0 4px 12px rgba(66,133,244,0.3)';
    });
    fsBtn.addEventListener('mouseleave', function() {
        fsBtn.style.background = 'rgba(255,255,255,0.92)';
        fsBtn.style.color = '#4285f4';
        fsBtn.style.borderColor = '#c5ddf5';
        fsBtn.style.boxShadow = '0 2px 8px rgba(66,133,244,0.15)';
    });
    container.appendChild(fsBtn);

    // Expanded state (slides hero elements, expands globe in place)
    var isFullscreen = false;
    var heroSection = document.querySelector('.hero');
    var heroSymbol = document.querySelector('.hero-symbol');
    var backdrop = null;
    var closeBtn = null;
    var originalSize = options.size || 640;
    var transitionDuration = 600; // ms, matches CSS

    function enterFullscreen() {
        isFullscreen = true;

        // Get current globe position
        var rect = heroSymbol.getBoundingClientRect();
        var currentCenterX = rect.left + rect.width / 2;
        var currentCenterY = rect.top + rect.height / 2;

        // Calculate target position (center of viewport) and size
        var viewportCenterX = window.innerWidth / 2;
        var viewportCenterY = window.innerHeight / 2;
        var fsSize = Math.min(window.innerWidth, window.innerHeight) * 0.8;
        var scaleFactor = fsSize / originalSize;

        // Calculate translation needed
        var translateX = viewportCenterX - currentCenterX;
        var translateY = viewportCenterY - currentCenterY;

        // Create backdrop
        backdrop = document.createElement('div');
        backdrop.className = 'globe-expanded-backdrop';
        backdrop.addEventListener('click', exitFullscreen);
        document.body.appendChild(backdrop);

        // Create close button
        closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l12 12M16 4L4 16"/></svg>';
        closeBtn.style.cssText = 'position:fixed;top:24px;right:24px;z-index:1001;background:rgba(255,255,255,0.9);' +
            'border:1px solid #d1d1d1;border-radius:8px;color:#333;cursor:pointer;padding:10px;' +
            'opacity:0;transition:opacity 0.3s ease 0.3s;backdrop-filter:blur(4px);';
        closeBtn.addEventListener('click', exitFullscreen);
        document.body.appendChild(closeBtn);

        // Add expanded class for hero text/stats animation
        heroSection.classList.add('globe-expanded');

        // Show backdrop and close button
        requestAnimationFrame(function() {
            backdrop.classList.add('visible');
            closeBtn.style.opacity = '1';

            // Apply transform to globe (translate + scale)
            heroSymbol.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scaleFactor + ')';
        });

        // After animation completes, swap to full-resolution globe
        setTimeout(function() {
            if (!isFullscreen) return; // user may have closed early

            // Remove transform and reposition with actual size
            heroSymbol.style.transition = 'none';
            heroSymbol.style.transform = '';
            heroSymbol.style.position = 'fixed';
            heroSymbol.style.top = '50%';
            heroSymbol.style.left = '50%';
            heroSymbol.style.right = 'auto';
            heroSymbol.style.marginTop = (-fsSize / 2) + 'px';
            heroSymbol.style.marginLeft = (-fsSize / 2) + 'px';
            heroSymbol.style.width = fsSize + 'px';
            heroSymbol.style.height = fsSize + 'px';

            // Resize SVG and projection to full resolution
            size = fsSize;
            baseScale = size * 0.485;
            container.style.width = fsSize + 'px';
            container.style.height = fsSize + 'px';
            svg.attr('width', fsSize).attr('height', fsSize);
            projection.scale(baseScale * zoomLevel).translate([size / 2, size / 2]);

            // Re-enable transition for exit
            requestAnimationFrame(function() {
                heroSymbol.style.transition = '';
            });
        }, transitionDuration + 50);

        // Hide explore button
        fsBtn.style.opacity = '0';
        fsBtn.style.pointerEvents = 'none';

        // ESC to close
        document.addEventListener('keydown', fsEscHandler);
    }

    function exitFullscreen() {
        if (!isFullscreen) return;
        isFullscreen = false;

        // Reset zoom level
        zoomLevel = 1;

        // Get current fullscreen position for smooth exit
        var fsSize = parseFloat(heroSymbol.style.width) || (Math.min(window.innerWidth, window.innerHeight) * 0.8);

        // First, restore to original size but keep position
        size = originalSize;
        baseScale = size * 0.485;
        container.style.width = originalSize + 'px';
        container.style.height = originalSize + 'px';
        svg.attr('width', originalSize).attr('height', originalSize);
        projection.scale(baseScale * zoomLevel).translate([size / 2, size / 2]);

        // Calculate scale factor to match current visual size
        var scaleFactor = fsSize / originalSize;

        // Reset heroSymbol to original CSS positioning but with transform to match current visual
        heroSymbol.style.transition = 'none';
        heroSymbol.style.position = '';
        heroSymbol.style.top = '';
        heroSymbol.style.left = '';
        heroSymbol.style.right = '';
        heroSymbol.style.marginTop = '';
        heroSymbol.style.marginLeft = '';
        heroSymbol.style.width = '';
        heroSymbol.style.height = '';

        // Get original position
        var rect = heroSymbol.getBoundingClientRect();
        var currentCenterX = rect.left + rect.width / 2;
        var currentCenterY = rect.top + rect.height / 2;
        var viewportCenterX = window.innerWidth / 2;
        var viewportCenterY = window.innerHeight / 2;
        var translateX = viewportCenterX - currentCenterX;
        var translateY = viewportCenterY - currentCenterY;

        // Start from expanded position
        heroSymbol.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scaleFactor + ')';

        // Re-enable transition and animate back
        requestAnimationFrame(function() {
            heroSymbol.style.transition = '';
            requestAnimationFrame(function() {
                heroSymbol.style.transform = '';
            });
        });

        // Remove expanded class
        heroSection.classList.remove('globe-expanded');

        // Hide backdrop and close button
        if (backdrop) {
            backdrop.classList.remove('visible');
            setTimeout(function() { backdrop.remove(); backdrop = null; }, 500);
        }
        if (closeBtn) {
            closeBtn.style.opacity = '0';
            setTimeout(function() { closeBtn.remove(); closeBtn = null; }, 300);
        }

        // Show explore button
        setTimeout(function() {
            fsBtn.style.opacity = '1';
            fsBtn.style.pointerEvents = 'auto';
        }, 300);

        document.removeEventListener('keydown', fsEscHandler);
    }

    function fsEscHandler(evt) {
        if (evt.key === 'Escape') exitFullscreen();
    }

    fsBtn.addEventListener('click', function(evt) {
        evt.stopPropagation();
        if (isFullscreen) exitFullscreen();
        else enterFullscreen();
    });

    // State
    var rotation = 0;
    var tilt = -25;
    var DEFAULT_TILT = -25;
    var pulse = 0;
    var livePulse = 0;
    var animationId = null;
    var landFeature = null;
    var borderMesh = null;
    var countriesFeatures = null; // Individual country geometries for choropleth
    var liveElections = [];
    var completedElections = [];
    var allMarkets = [];
    var categoryColors = {};
    var activeFilter = { category: 'all', region: 'all' };
    var activeVdemIndex = 'v2x_polyarchy'; // Default V-Dem index to display
    var hoveredMarker = null;
    var zoomLevel = 1;
    var baseScale = size * 0.485;

    // Layer visibility state
    var layerVisibility = {
        markets: true,
        vdem: false,
        acled: false
    };

    // V-Dem and ACLED data (loaded on demand)
    var vdemData = null;
    var acledData = null;

    // ISO 3166-1 numeric code to V-Dem country name mapping
    var isoToCountry = {
        // A
        4: 'Afghanistan', 8: 'Albania', 12: 'Algeria', 24: 'Angola', 32: 'Argentina',
        51: 'Armenia', 36: 'Australia', 40: 'Austria', 31: 'Azerbaijan',
        // B
        44: 'Bahamas', 48: 'Bahrain', 50: 'Bangladesh', 52: 'Barbados', 112: 'Belarus',
        56: 'Belgium', 84: 'Belize', 204: 'Benin', 64: 'Bhutan', 68: 'Bolivia',
        70: 'Bosnia and Herzegovina', 72: 'Botswana', 76: 'Brazil', 96: 'Brunei',
        100: 'Bulgaria', 854: 'Burkina Faso', 108: 'Burundi',
        // C
        132: 'Cape Verde', 116: 'Cambodia', 120: 'Cameroon', 124: 'Canada',
        140: 'Central African Republic', 148: 'Chad', 152: 'Chile', 156: 'China',
        170: 'Colombia', 174: 'Comoros', 178: 'Congo', 180: 'DR Congo',
        188: 'Costa Rica', 384: 'Ivory Coast', 191: 'Croatia', 192: 'Cuba', 196: 'Cyprus',
        203: 'Czech Republic',
        // D
        208: 'Denmark', 262: 'Djibouti', 214: 'Dominican Republic',
        // E
        218: 'Ecuador', 818: 'Egypt', 222: 'El Salvador', 226: 'Equatorial Guinea',
        232: 'Eritrea', 233: 'Estonia', 748: 'Eswatini', 231: 'Ethiopia',
        // F
        242: 'Fiji', 246: 'Finland', 250: 'France',
        // G
        266: 'Gabon', 270: 'The Gambia', 268: 'Georgia', 276: 'Germany', 288: 'Ghana',
        300: 'Greece', 304: 'Denmark', 320: 'Guatemala', 324: 'Guinea', 624: 'Guinea-Bissau', 328: 'Guyana',
        // H
        332: 'Haiti', 340: 'Honduras', 344: 'Hong Kong', 348: 'Hungary',
        // I
        352: 'Iceland', 356: 'India', 360: 'Indonesia', 364: 'Iran', 368: 'Iraq',
        372: 'Ireland', 376: 'Israel', 380: 'Italy',
        // J
        388: 'Jamaica', 392: 'Japan', 400: 'Jordan',
        // K
        398: 'Kazakhstan', 404: 'Kenya', 408: 'North Korea', 410: 'South Korea',
        383: 'Kosovo', 414: 'Kuwait', 417: 'Kyrgyzstan',
        // L
        418: 'Laos', 428: 'Latvia', 422: 'Lebanon', 426: 'Lesotho', 430: 'Liberia',
        434: 'Libya', 440: 'Lithuania', 442: 'Luxembourg',
        // M
        450: 'Madagascar', 454: 'Malawi', 458: 'Malaysia', 462: 'Maldives', 466: 'Mali',
        470: 'Malta', 478: 'Mauritania', 480: 'Mauritius', 484: 'Mexico', 498: 'Moldova',
        496: 'Mongolia', 499: 'Montenegro', 504: 'Morocco', 508: 'Mozambique', 104: 'Myanmar',
        // N
        516: 'Namibia', 524: 'Nepal', 528: 'Netherlands', 554: 'New Zealand',
        558: 'Nicaragua', 562: 'Niger', 566: 'Nigeria', 807: 'North Macedonia', 578: 'Norway',
        // O
        512: 'Oman',
        // P
        586: 'Pakistan', 275: 'Palestine/West Bank', 591: 'Panama', 598: 'Papua New Guinea',
        600: 'Paraguay', 604: 'Peru', 608: 'Philippines', 616: 'Poland', 620: 'Portugal',
        // Q
        634: 'Qatar',
        // R
        642: 'Romania', 643: 'Russia', 646: 'Rwanda',
        // S
        678: 'Sao Tome and Principe', 682: 'Saudi Arabia', 686: 'Senegal', 688: 'Serbia',
        690: 'Seychelles', 694: 'Sierra Leone', 702: 'Singapore', 703: 'Slovakia',
        705: 'Slovenia', 90: 'Solomon Islands', 706: 'Somalia', 710: 'South Africa',
        728: 'South Sudan', 724: 'Spain', 144: 'Sri Lanka', 729: 'Sudan', 740: 'Suriname',
        752: 'Sweden', 756: 'Switzerland', 760: 'Syria',
        // T
        158: 'Taiwan', 762: 'Tajikistan', 834: 'Tanzania', 764: 'Thailand',
        626: 'Timor-Leste', 768: 'Togo', 780: 'Trinidad and Tobago', 788: 'Tunisia',
        792: 'Türkiye', 795: 'Turkmenistan',
        // U
        800: 'Uganda', 804: 'Ukraine', 784: 'United Arab Emirates', 826: 'United Kingdom',
        840: 'United States', 858: 'Uruguay', 860: 'Uzbekistan',
        // V
        548: 'Vanuatu', 862: 'Venezuela', 704: 'Vietnam',
        // Y
        887: 'Yemen',
        // Z
        894: 'Zambia', 716: 'Zimbabwe'
    };

    // Alternative country name mappings for V-Dem lookup
    var countryNameAliases = {
        'Turkey': 'Türkiye',
        'Turkiye': 'Türkiye',
        'Republic of the Congo': 'Congo',
        'Democratic Republic of the Congo': 'DR Congo',
        'Gambia': 'The Gambia',
        'Swaziland': 'Eswatini',
        'East Timor': 'Timor-Leste',
        'Macedonia': 'North Macedonia',
        'Burma': 'Myanmar',
        'Cote d\'Ivoire': 'Ivory Coast',
        'Cabo Verde': 'Cape Verde'
    };

    // Get V-Dem color for a country
    function getVdemColor(countryId) {
        if (!vdemData || !layerVisibility.vdem) return null;
        var countryName = isoToCountry[countryId];
        if (!countryName) return null;

        // Try direct lookup first, then try alias
        var country = vdemData.countries[countryName];
        if (!country && countryNameAliases[countryName]) {
            country = vdemData.countries[countryNameAliases[countryName]];
        }
        if (!country || !country.scores || !country.scores[activeVdemIndex]) return null;

        var score = country.scores[activeVdemIndex].value;
        var indexInfo = vdemData.indices[activeVdemIndex];

        // Color scale: dark blue (bad) to light blue (good)
        var invert = indexInfo && indexInfo.invert;
        var t = invert ? (1 - score) : score;

        // Blue gradient: #94a9bd (muted blue) -> #dbeafe (light)
        // t=0: muted blue, t=1: light blue
        var r = Math.round(148 + (219 - 148) * t);
        var g = Math.round(169 + (234 - 169) * t);
        var b = Math.round(189 + (254 - 189) * t);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    // Load V-Dem data when layer is enabled
    function loadVdemData() {
        if (vdemData) return Promise.resolve(vdemData);

        return fetch('data/vdem_scores.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                vdemData = data;
                console.log('Loaded V-Dem data for', Object.keys(data.countries).length, 'countries');
                return data;
            })
            .catch(function(err) {
                console.error('Failed to load V-Dem data:', err);
                return null;
            });
    }

    // Load ACLED data when layer is enabled
    function loadAcledData() {
        if (acledData) return Promise.resolve(acledData);

        return fetch('data/acled_events.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                acledData = data;
                console.log('Loaded ACLED data:', data.events ? data.events.length : 0, 'events');
                return data;
            })
            .catch(function(err) {
                console.error('Failed to load ACLED data:', err);
                return null;
            });
    }

    // Drag & auto-rotate state
    var autoRotate = true;
    var isDragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragStartRotation = 0;
    var dragStartTilt = 0;
    var resumeTimer = null;

    // Track projected positions for hit testing
    var liveProjected = [];
    var completedProjected = [];

    // Projection
    var projection = d3.geoOrthographic()
        .scale(baseScale)
        .center([0, 0])
        .translate([size / 2, size / 2]);

    var path = d3.geoPath().projection(projection);

    function isVisible(lng, lat) {
        var center = projection.invert([size / 2, size / 2]);
        return center && d3.geoDistance([lng, lat], center) < Math.PI / 2;
    }

    function scheduleResume() {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function() {
            if (!isDragging && !hoveredMarker && !tooltipHovered) {
                autoRotate = true;
            }
        }, RESUME_DELAY);
    }

    function render() {
        svg.selectAll("*").remove();
        liveProjected = [];
        completedProjected = [];

        projection.scale(baseScale * zoomLevel);
        projection.rotate([rotation, tilt, -15]);

        // Heartbeat pulse
        var pulseScale = 1 + Math.sin(pulse) * 0.006;
        container.style.transform = 'scale(' + pulseScale + ')';

        // Gradient
        var defs = svg.append("defs");
        var gradient = defs.append("radialGradient")
            .attr("id", "oceanGrad").attr("cx", "30%").attr("cy", "30%");
        gradient.append("stop").attr("offset", "0%").attr("stop-color", "#f0f5fc");
        gradient.append("stop").attr("offset", "100%").attr("stop-color", "#d4e4f7");

        // Ocean
        svg.append("path")
            .datum({ type: "Sphere" })
            .attr("d", path)
            .attr("fill", "url(#oceanGrad)")
            .attr("stroke", "#c5ddf5")
            .attr("stroke-width", 1.5);

        // Land - either merged (default) or individual countries (for choropleth)
        if (layerVisibility.vdem && vdemData && countriesFeatures) {
            // Draw individual countries with V-Dem coloring
            countriesFeatures.features.forEach(function(feature) {
                var countryId = parseInt(feature.id);
                var vdemColor = getVdemColor(countryId);
                var fillColor = vdemColor || '#b5cde2';

                svg.append("path")
                    .datum(feature)
                    .attr("d", path)
                    .attr("fill", fillColor)
                    .attr("stroke", "none")
                    .attr("opacity", vdemColor ? 0.85 : 1);
            });
        } else if (landFeature) {
            // Default: draw merged land mass
            svg.append("path")
                .datum(landFeature)
                .attr("d", path)
                .attr("fill", "#b5cde2")
                .attr("stroke", "none");
        }

        // Country borders (internal borders between countries)
        if (borderMesh) {
            svg.append("path")
                .datum(borderMesh)
                .attr("d", path)
                .attr("fill", "none")
                .attr("stroke", "#92b8d8")
                .attr("stroke-width", 0.5)
                .attr("opacity", 0.8);
        }

        // Coastline
        if (landFeature) {
            svg.append("path")
                .datum(landFeature)
                .attr("d", path)
                .attr("fill", "none")
                .attr("stroke", "#8ab4d6")
                .attr("stroke-width", 0.7);
        }

        // Graticule
        svg.append("path")
            .datum(d3.geoGraticule().step([30, 30]))
            .attr("d", path)
            .attr("fill", "none")
            .attr("stroke", "#d4e4f7")
            .attr("stroke-width", 0.3);

        // Scale factor for markers (so they scale with globe size)
        var markerScale = size / originalSize;

        // Completed elections (hoverable dots)
        if (!layerVisibility.markets) {
            // Skip rendering markets if layer is disabled
        } else completedElections.forEach(function(e, idx) {
            if (!e.lat || !e.lng || !isVisible(e.lng, e.lat)) return;

            // Apply category and region filters
            if (activeFilter.category !== 'all') {
                var cat = e.category_display || 'Other';
                if (cat !== activeFilter.category) return;
            }
            if (activeFilter.region !== 'all') {
                var region = e.region;
                if (region === 'north_america' || region === 'south_america') region = 'americas';
                if (region === 'middle_east') region = 'asia';
                if (region !== activeFilter.region) return;
            }

            var coords = projection([e.lng, e.lat]);
            if (!coords) return;

            completedProjected.push({ x: coords[0], y: coords[1], idx: idx, data: e });

            // Get category color (new format) or default blue, but muted for completed
            var baseColor = e.color || categoryColors[e.category] || '#3b82f6';

            var isHovered = hoveredMarker && hoveredMarker.type === 'completed' && hoveredMarker.idx === idx;
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", (isHovered ? 6 : 3.5) * markerScale)
                .attr("fill", isHovered ? baseColor : d3.color(baseColor).darker(0.5))
                .attr("stroke", isHovered ? "#fff" : "none")
                .attr("stroke-width", (isHovered ? 1.5 : 0) * markerScale)
                .attr("opacity", isHovered ? 1 : 0.65);
        });

        // Live elections / markets (pulsing rings + solid dots)
        if (!layerVisibility.markets) {
            // Skip rendering markets if layer is disabled
        } else liveElections.forEach(function(e, idx) {
            if (!e.lat || !e.lng || !isVisible(e.lng, e.lat)) return;

            // Apply category and region filters
            if (activeFilter.category !== 'all') {
                var cat = e.category_display || 'Other';
                if (cat !== activeFilter.category) return;
            }
            if (activeFilter.region !== 'all') {
                var region = e.region;
                // Map internal regions to filter values
                if (region === 'north_america' || region === 'south_america') region = 'americas';
                if (region === 'middle_east') region = 'asia';
                if (region !== activeFilter.region) return;
            }

            var coords = projection([e.lng, e.lat]);
            if (!coords) return;

            liveProjected.push({ x: coords[0], y: coords[1], idx: idx, data: e });

            // Get category color (new format) or default blue
            var dotColor = e.color || categoryColors[e.category] || '#1d6ff2';
            var ringColor = dotColor;

            var phase = livePulse + (e.lat * 0.7 + e.lng * 0.3);
            var ringPulse = 0.3 + Math.sin(phase) * 0.25;
            var ringSize = (8 + Math.sin(phase) * 2.5) * markerScale;

            // Outer pulsing ring (color matches dot)
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", ringSize)
                .attr("fill", "none")
                .attr("stroke", ringColor)
                .attr("stroke-width", 1.5 * markerScale)
                .attr("opacity", ringPulse);

            // Solid dot
            var isHovered = hoveredMarker && hoveredMarker.type === 'live' && hoveredMarker.idx === idx;
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", (isHovered ? 7 : 4.5) * markerScale)
                .attr("fill", isHovered ? d3.color(dotColor).darker(0.3) : dotColor)
                .attr("stroke", isHovered ? "#fff" : "#e0eaff")
                .attr("stroke-width", (isHovered ? 1.5 : 0.75) * markerScale);
        });

    }

    function animate() {
        if (autoRotate && !isDragging && !hoveredMarker && !tooltipHovered) {
            rotation = (rotation + rotationSpeed) % 360;
            // Smoothly ease tilt back to default
            tilt += (DEFAULT_TILT - tilt) * 0.04;
        }
        pulse += 0.008;
        livePulse += 0.04;
        render();
        animationId = requestAnimationFrame(animate);
    }

    // Hit testing for hover
    function findNearestMarker(mx, my) {
        var best = null;
        var bestDist = 20;
        liveProjected.forEach(function(p) {
            var dist = Math.sqrt((p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
            if (dist < bestDist) {
                bestDist = dist;
                best = { type: 'live', idx: p.idx, data: p.data, x: p.x, y: p.y };
            }
        });
        completedProjected.forEach(function(p) {
            var dist = Math.sqrt((p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
            if (dist < bestDist) {
                bestDist = dist;
                best = { type: 'completed', idx: p.idx, data: p.data, x: p.x, y: p.y };
            }
        });
        return best;
    }

    // Convert SVG-space coords to viewport coords for the fixed tooltip
    function svgToViewport(sx, sy) {
        var rect = svgNode.getBoundingClientRect();
        return { x: rect.left + sx, y: rect.top + sy };
    }

    function updateCursor() {
        if (isDragging) {
            svgNode.style.cursor = 'grabbing';
        } else if (hoveredMarker) {
            svgNode.style.cursor = 'pointer';
        } else {
            svgNode.style.cursor = 'grab';
        }
    }

    // Mouse events
    var svgNode = svg.node();
    svgNode.style.cursor = 'grab';

    // Hover
    svgNode.addEventListener('mousemove', function(evt) {
        if (isDragging) return; // drag handler handles rotation

        var rect = svgNode.getBoundingClientRect();
        var mx = evt.clientX - rect.left;
        var my = evt.clientY - rect.top;

        var hit = findNearestMarker(mx, my);
        if (hit) {
            hoveredMarker = { type: hit.type, idx: hit.idx };
            autoRotate = false;
            clearTimeout(resumeTimer);
            var e = hit.data;

            // Notify globe page of hover (for sidebar highlighting)
            if (window.onGlobeMarkerHover) {
                window.onGlobeMarkerHover(e);
            }

            // Build rich tooltip
            // Use category color if available, otherwise status-based color
            var catColor = e.color || categoryColors[e.category] || '#4285f4';
            var statusColor = hit.type === 'completed' ? '#9ca3af' : catColor;
            var categoryLabel = e.category_display || (hit.type === 'completed' ? 'Completed' : 'Live');
            var statusDot = '<span style="color:' + statusColor + ';">\u25CF</span> ';

            // Build label — use marquee scroll for long text
            var labelText = e.label;
            var labelHtml;
            if (labelText.length > 28) {
                var dur = Math.max(6, labelText.length * 0.22).toFixed(1);
                var gap = '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0';
                labelHtml = '<div style="overflow:hidden;max-width:236px;">' +
                    '<span class="globe-marquee-track" style="--marquee-dur:' + dur + 's;">' +
                    '<strong style="font-size:13px;">' + labelText + '</strong>' + gap +
                    '<strong style="font-size:13px;">' + labelText + '</strong>' + gap +
                    '</span></div>';
            } else {
                labelHtml = '<strong style="font-size:13px;white-space:nowrap;">' + labelText + '</strong>';
            }

            var lines = [];
            lines.push(labelHtml);
            lines.push('<span style="font-size:11px;color:' + statusColor + ';">' + statusDot + categoryLabel + '</span>');

            if (e.markets) {
                var detail = e.markets + ' market' + (e.markets > 1 ? 's' : '');
                if (e.elections > 1) detail += ' &middot; ' + e.elections + ' elections';
                lines.push('<span style="font-size:11px;opacity:0.7;">' + detail + '</span>');
            }

            // Add platform links (fullscreen only)
            if (isFullscreen) {
                var linkParts = [];
                if (e.has_pm) {
                    var pmUrl = e.pm_event
                        ? 'https://polymarket.com/event/' + e.pm_event
                        : 'https://polymarket.com/search?_q=' + encodeURIComponent(e.search_query);
                    linkParts.push('<a href="' + pmUrl + '" target="_blank" rel="noopener" ' +
                        'style="color:#60a5fa;text-decoration:none;">Polymarket &nearr;</a>');
                }
                if (e.has_k && e.kalshi_event) {
                    linkParts.push('<a href="https://kalshi.com/events/' + e.kalshi_event + '" target="_blank" rel="noopener" ' +
                        'style="color:#34d399;text-decoration:none;">Kalshi &nearr;</a>');
                }
                if (linkParts.length) {
                    lines.push('<span style="font-size:11px;margin-top:2px;display:inline-flex;gap:8px;">' +
                        linkParts.join('') + '</span>');
                }
            }

            // Add View link on globe page
            if (isGlobePage) {
                lines.push('<div style="text-align:right;margin-top:4px;">' +
                    '<span class="globe-tooltip-view" style="font-size:11px;color:rgba(255,255,255,0.6);cursor:pointer;' +
                    'transition:color 0.15s;" ' +
                    'onmouseover="this.style.color=\'#fff\'" ' +
                    'onmouseout="this.style.color=\'rgba(255,255,255,0.6)\'">' +
                    'View →</span></div>');
            }

            tooltipContent.innerHTML = lines.join('<br>');

            // Attach click handler to View button
            var viewBtn = tooltipContent.querySelector('.globe-tooltip-view');
            if (viewBtn) {
                viewBtn.addEventListener('click', function() {
                    if (window.onGlobeMarkerClick) {
                        window.onGlobeMarkerClick(e);
                    }
                    // Hide tooltip after clicking
                    tooltip.style.opacity = '0';
                    tooltip.style.pointerEvents = 'none';
                    hoveredMarker = null;
                    scheduleResume();
                });
            }
            clearTimeout(tooltipHideTimer);
            tooltip.style.pointerEvents = 'auto';
            tooltip.style.opacity = '1';
            // Position in viewport coords (tooltip is position:fixed on body)
            var vp = svgToViewport(hit.x, hit.y);
            tooltip.style.left = vp.x + 'px';
            tooltip.style.top = vp.y + 'px';
        } else {
            if (hoveredMarker && !tooltipHovered) {
                delayedHideTooltip();
            }
        }
        updateCursor();
    });

    svgNode.addEventListener('mouseleave', function() {
        if (!isDragging) {
            delayedHideTooltip();
            updateCursor();
        }
    });

    // Drag to rotate (with click detection for markers)
    var clickStartMarker = null;
    var hasDragged = false;

    svgNode.addEventListener('mousedown', function(evt) {
        var rect = svgNode.getBoundingClientRect();
        var mx = evt.clientX - rect.left;
        var my = evt.clientY - rect.top;
        clickStartMarker = findNearestMarker(mx, my);
        hasDragged = false;

        isDragging = true;
        autoRotate = false;
        clearTimeout(resumeTimer);
        dragStartX = evt.clientX;
        dragStartY = evt.clientY;
        dragStartRotation = rotation;
        dragStartTilt = tilt;
        svgNode.style.cursor = 'grabbing';
        evt.preventDefault();
    });

    document.addEventListener('mousemove', function(evt) {
        if (!isDragging) return;
        var dx = evt.clientX - dragStartX;
        var dy = evt.clientY - dragStartY;

        // Detect if user has actually dragged (moved more than 5px)
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            hasDragged = true;
        }

        // Convert px delta to degrees (scale sensitivity by zoom so drag feels consistent when zoomed in)
        var dragSensitivity = 0.3 / zoomLevel;
        rotation = (dragStartRotation + dx * dragSensitivity) % 360;
        tilt = Math.max(-90, Math.min(90, dragStartTilt - dy * dragSensitivity));
        tooltip.style.opacity = '0';
        tooltip.style.pointerEvents = 'none';
        hoveredMarker = null;
    });

    document.addEventListener('mouseup', function(evt) {
        if (!isDragging) return;
        isDragging = false;
        updateCursor();
        clickStartMarker = null;
        scheduleResume();
    });

    // Check if we're on the globe page (dedicated globe view)
    var isGlobePage = document.body.classList.contains('globe-page');

    // Scroll-wheel zoom (fullscreen mode OR globe page)
    svgNode.addEventListener('wheel', function(evt) {
        if (!isFullscreen && !isGlobePage) return;
        evt.preventDefault();
        var delta = evt.deltaY > 0 ? -0.08 : 0.08;
        zoomLevel = Math.max(0.5, Math.min(4, zoomLevel + delta));
    }, { passive: false });

    // Load data — use countries topology for borders
    Promise.all([
        fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(function(r) { return r.json(); }),
        fetch('data/globe_markets.json').then(function(r) { return r.json(); }).catch(function() {
            // Fallback to globe_elections.json for backward compatibility
            return fetch('data/globe_elections.json').then(function(r) { return r.json(); });
        })
    ]).then(function(results) {
        var topology = results[0];
        var marketData = results[1];

        // Land mass (merged) for fill
        landFeature = topoFeature(topology, topology.objects.land);
        // Individual countries for choropleth - use topojson library for correct parsing
        if (typeof topojson !== 'undefined') {
            countriesFeatures = topojson.feature(topology, topology.objects.countries);
            console.log('Using topojson library for countries, parsed', countriesFeatures.features.length, 'features');
        } else {
            countriesFeatures = topoFeature(topology, topology.objects.countries);
            console.warn('topojson library not loaded, using fallback parser');
        }
        // Country borders (internal shared edges)
        borderMesh = topoMesh(topology, topology.objects.countries);

        // New format: globe_markets.json with markets array
        if (marketData.markets) {
            allMarkets = marketData.markets || [];
            categoryColors = marketData.category_colors || {};
            // For backward compat, split into live (all) and completed (none)
            liveElections = allMarkets;
            completedElections = [];
        } else {
            // Old format: globe_elections.json with live/completed
            liveElections = marketData.live || [];
            completedElections = marketData.completed || [];
            allMarkets = liveElections.concat(completedElections);
        }

        console.log('Globe loaded', allMarkets.length, 'market points');
        animate();

        // Country coordinates for globe navigation
        var countryCoords = {
            'United States': { lng: -98, lat: 39 },
            'Germany': { lng: 10, lat: 51 },
            'France': { lng: 2, lat: 47 },
            'United Kingdom': { lng: -2, lat: 54 },
            'Brazil': { lng: -48, lat: -15 },
            'Mexico': { lng: -102, lat: 23 },
            'India': { lng: 78, lat: 21 },
            'Japan': { lng: 138, lat: 36 },
            'Australia': { lng: 134, lat: -25 },
            'Canada': { lng: -106, lat: 56 },
            'Italy': { lng: 12, lat: 43 },
            'Spain': { lng: -4, lat: 40 },
            'Poland': { lng: 20, lat: 52 },
            'Portugal': { lng: -8, lat: 39 },
            'Netherlands': { lng: 5, lat: 52 },
            'Belgium': { lng: 4, lat: 51 },
            'Austria': { lng: 14, lat: 47 },
            'Switzerland': { lng: 8, lat: 47 },
            'Sweden': { lng: 18, lat: 62 },
            'Norway': { lng: 10, lat: 62 },
            'Denmark': { lng: 10, lat: 56 },
            'Finland': { lng: 26, lat: 64 },
            'Ireland': { lng: -8, lat: 53 },
            'Greece': { lng: 22, lat: 39 },
            'Czech Republic': { lng: 15, lat: 50 },
            'Czechia': { lng: 15, lat: 50 },
            'Hungary': { lng: 20, lat: 47 },
            'Romania': { lng: 25, lat: 46 },
            'Bulgaria': { lng: 25, lat: 43 },
            'Ukraine': { lng: 32, lat: 49 },
            'Russia': { lng: 100, lat: 60 },
            'Turkey': { lng: 35, lat: 39 },
            'Israel': { lng: 35, lat: 31 },
            'South Africa': { lng: 25, lat: -29 },
            'Nigeria': { lng: 8, lat: 10 },
            'Egypt': { lng: 30, lat: 27 },
            'Kenya': { lng: 38, lat: 0 },
            'Argentina': { lng: -64, lat: -34 },
            'Chile': { lng: -71, lat: -33 },
            'Colombia': { lng: -74, lat: 4 },
            'Peru': { lng: -76, lat: -10 },
            'Venezuela': { lng: -66, lat: 8 },
            'Ecuador': { lng: -78, lat: -2 },
            'Costa Rica': { lng: -84, lat: 10 },
            'South Korea': { lng: 128, lat: 36 },
            'Korea': { lng: 128, lat: 36 },
            'Taiwan': { lng: 121, lat: 24 },
            'Thailand': { lng: 101, lat: 15 },
            'Indonesia': { lng: 118, lat: -2 },
            'Philippines': { lng: 122, lat: 12 },
            'Vietnam': { lng: 106, lat: 16 },
            'Malaysia': { lng: 102, lat: 4 },
            'Singapore': { lng: 104, lat: 1 },
            'China': { lng: 105, lat: 35 },
            'New Zealand': { lng: 174, lat: -41 }
        };

        // Region center coordinates
        var regionCoords = {
            'europe': { lng: 15, lat: 50 },
            'americas': { lng: -80, lat: 15 },
            'asia': { lng: 100, lat: 30 },
            'africa': { lng: 20, lat: 5 },
            'oceania': { lng: 140, lat: -25 },
            'all': null // Don't move for "all"
        };

        // Animation for smooth rotation
        var targetRotation = null;
        var targetTilt = null;
        var animatingTo = false;

        function animateToTarget() {
            if (!animatingTo || targetRotation === null) return;

            var diffR = targetRotation - rotation;
            var diffT = targetTilt - tilt;

            // Normalize rotation difference to -180 to 180
            while (diffR > 180) diffR -= 360;
            while (diffR < -180) diffR += 360;

            // Ease towards target
            rotation += diffR * 0.08;
            tilt += diffT * 0.08;

            // Check if close enough
            if (Math.abs(diffR) < 0.5 && Math.abs(diffT) < 0.5) {
                rotation = targetRotation;
                tilt = targetTilt;
                animatingTo = false;
                // Schedule resume of auto-rotation after 5 seconds
                clearTimeout(resumeTimer);
                resumeTimer = setTimeout(function() {
                    autoRotate = true;
                }, 5000);
            }
        }

        // Override the animate function to include target animation
        var originalAnimate = animate;
        animate = function() {
            if (animatingTo) {
                animateToTarget();
            } else if (autoRotate && !isDragging && !hoveredMarker && !tooltipHovered) {
                rotation = (rotation + rotationSpeed) % 360;
                tilt += (DEFAULT_TILT - tilt) * 0.04;
            }
            pulse += 0.008;
            livePulse += 0.04;
            render();
            animationId = requestAnimationFrame(animate);
        };

        // Expose function to rotate globe to a location
        window.rotateGlobeTo = function(target) {
            var coords = null;

            // Check if it's a region
            if (regionCoords[target]) {
                coords = regionCoords[target];
            }
            // Check if it's a country name
            else if (countryCoords[target]) {
                coords = countryCoords[target];
            }
            // Check if target contains a known country
            else {
                for (var country in countryCoords) {
                    if (target.toLowerCase().includes(country.toLowerCase())) {
                        coords = countryCoords[country];
                        break;
                    }
                }
            }

            if (coords) {
                autoRotate = false;
                animatingTo = true;
                // Rotation is negative of longitude to face that location
                targetRotation = -coords.lng;
                targetTilt = -coords.lat * 0.5; // Tilt partially towards latitude
            }
        };

        // Expose zoom controls
        window.globeZoomIn = function() {
            zoomLevel = Math.min(4, zoomLevel + 0.2);
        };

        window.globeZoomOut = function() {
            zoomLevel = Math.max(0.5, zoomLevel - 0.2);
        };

        // Expose filter function for category/region filtering
        window.setGlobeFilter = function(category, region) {
            activeFilter.category = category || 'all';
            activeFilter.region = region || 'all';
        };

        // Expose layer toggle function
        window.setGlobeLayer = function(layer, enabled) {
            layerVisibility[layer] = enabled;
            console.log('Globe layer', layer, enabled ? 'enabled' : 'disabled');

            // Load V-Dem data when enabled
            if (layer === 'vdem' && enabled) {
                loadVdemData().then(function(data) {
                    if (data) {
                        console.log('V-Dem data ready, indices:', Object.keys(data.indices));
                    }
                });
            }

            // Load ACLED data when enabled
            if (layer === 'acled' && enabled) {
                loadAcledData().then(function(data) {
                    if (data && data.events && data.events.length > 0) {
                        console.log('ACLED data ready, events:', data.events.length);
                    }
                });
            }
        };

        // Expose V-Dem index selector
        window.setVdemIndex = function(index) {
            activeVdemIndex = index;
            console.log('V-Dem index set to:', index);
        };

        // Get available V-Dem indices
        window.getVdemIndices = function() {
            if (!vdemData) return null;
            return vdemData.indices;
        };

        // Get V-Dem data for a country (for tooltip/sidebar)
        window.getVdemCountryData = function(countryName) {
            if (!vdemData || !vdemData.countries[countryName]) return null;
            return vdemData.countries[countryName];
        };

    }).catch(function(err) {
        console.error('Globe error:', err);
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9ca3af;font-size:13px;">Globe unavailable</div>';
    });

    return function cleanup() {
        if (animationId) cancelAnimationFrame(animationId);
        clearTimeout(resumeTimer);
        if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
        delete window.rotateGlobeTo;
        delete window.globeZoomIn;
        delete window.globeZoomOut;
    };
}

// ============================================
// Auto-initialize on page load
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('globe-container')) {
        // Use larger size on dedicated globe page
        var isGlobePage = document.body.classList.contains('globe-page');
        var globeSize = isGlobePage ? 850 : 640;
        initGlobe('globe-container', { size: globeSize, rotationSpeed: 0.08 });
    }
});
