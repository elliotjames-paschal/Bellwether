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

    // Fullscreen button - pill style with text
    var fsBtn = document.createElement('button');
    fsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg><span style="margin-left:6px;">Explore</span>';
    fsBtn.style.cssText = 'position:absolute;bottom:16px;right:16px;z-index:10;' +
        'background:rgba(255,255,255,0.92);border:1px solid #c5ddf5;border-radius:20px;' +
        'padding:8px 16px 8px 12px;cursor:pointer;display:flex;align-items:center;' +
        'color:#4285f4;font-size:13px;font-weight:500;font-family:system-ui,-apple-system,sans-serif;' +
        'transition:all 0.2s ease;backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(66,133,244,0.15);' +
        'opacity:1;';
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
    var liveElections = [];
    var completedElections = [];
    var hoveredMarker = null;
    var zoomLevel = 1;
    var baseScale = size * 0.485;

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

        // Land
        if (landFeature) {
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
        completedElections.forEach(function(e, idx) {
            if (!isVisible(e.lng, e.lat)) return;
            var coords = projection([e.lng, e.lat]);
            if (!coords) return;

            completedProjected.push({ x: coords[0], y: coords[1], idx: idx, data: e });

            var isHovered = hoveredMarker && hoveredMarker.type === 'completed' && hoveredMarker.idx === idx;
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", (isHovered ? 7 : 4) * markerScale)
                .attr("fill", isHovered ? "#2563eb" : "#3b82f6")
                .attr("stroke", isHovered ? "#fff" : "none")
                .attr("stroke-width", (isHovered ? 1.5 : 0) * markerScale)
                .attr("opacity", isHovered ? 1 : 0.82);
        });

        // Live elections (pulsing rings + solid dots)
        liveElections.forEach(function(e, idx) {
            if (!isVisible(e.lng, e.lat)) return;
            var coords = projection([e.lng, e.lat]);
            if (!coords) return;

            liveProjected.push({ x: coords[0], y: coords[1], idx: idx, data: e });

            var phase = livePulse + (e.lat * 0.7 + e.lng * 0.3);
            var ringPulse = 0.3 + Math.sin(phase) * 0.25;
            var ringSize = (10 + Math.sin(phase) * 3) * markerScale;

            // Outer pulsing ring
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", ringSize)
                .attr("fill", "none")
                .attr("stroke", "#1d6ff2")
                .attr("stroke-width", 2 * markerScale)
                .attr("opacity", ringPulse);

            // Solid dot
            var isHovered = hoveredMarker && hoveredMarker.type === 'live' && hoveredMarker.idx === idx;
            svg.append("circle")
                .attr("cx", coords[0]).attr("cy", coords[1])
                .attr("r", (isHovered ? 8 : 5.5) * markerScale)
                .attr("fill", isHovered ? "#1a56cc" : "#1d6ff2")
                .attr("stroke", isHovered ? "#fff" : "#e0eaff")
                .attr("stroke-width", (isHovered ? 2 : 1) * markerScale);
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

            // Build rich tooltip
            var statusColor = hit.type === 'completed' ? '#9ca3af' : '#4285f4';
            var statusLabel = hit.type === 'completed' ? 'Completed' : 'Live';
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
            lines.push('<span style="font-size:11px;color:' + statusColor + ';">' + statusDot + statusLabel + '</span>');

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

            tooltipContent.innerHTML = lines.join('<br>');
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

    // Drag to rotate
    svgNode.addEventListener('mousedown', function(evt) {
        // Don't initiate drag on marker hover (let clicks pass through)
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
        // Convert px delta to degrees (scale sensitivity by zoom so drag feels consistent when zoomed in)
        var dragSensitivity = 0.3 / zoomLevel;
        rotation = (dragStartRotation + dx * dragSensitivity) % 360;
        tilt = Math.max(-90, Math.min(90, dragStartTilt - dy * dragSensitivity));
        tooltip.style.opacity = '0';
        tooltip.style.pointerEvents = 'none';
        hoveredMarker = null;
    });

    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        isDragging = false;
        updateCursor();
        scheduleResume();
    });

    // Scroll-wheel zoom (only in fullscreen/expand mode)
    svgNode.addEventListener('wheel', function(evt) {
        if (!isFullscreen) return;
        evt.preventDefault();
        var delta = evt.deltaY > 0 ? -0.08 : 0.08;
        zoomLevel = Math.max(0.5, Math.min(4, zoomLevel + delta));
    }, { passive: false });

    // Load data — use countries topology for borders
    Promise.all([
        fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(function(r) { return r.json(); }),
        fetch('data/globe_elections.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
        var topology = results[0];
        var electionData = results[1];

        // Land mass (merged) for fill
        landFeature = topoFeature(topology, topology.objects.land);
        // Country borders (internal shared edges)
        borderMesh = topoMesh(topology, topology.objects.countries);

        liveElections = electionData.live || [];
        completedElections = electionData.completed || [];

        animate();
    }).catch(function(err) {
        console.error('Globe error:', err);
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9ca3af;font-size:13px;">Globe unavailable</div>';
    });

    return function cleanup() {
        if (animationId) cancelAnimationFrame(animationId);
        clearTimeout(resumeTimer);
        if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    };
}

// ============================================
// Auto-initialize on page load
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('globe-container')) {
        initGlobe('globe-container', { size: 640, rotationSpeed: 0.08 });
    }
});
