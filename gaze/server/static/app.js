/**
 * Project Gaze — Court Availability Dashboard
 *
 * Each court is a vertical card in a horizontal strip, containing:
 *   1. Court name + time-ago
 *   2. SVG tennis court visual with a duration-driven heat halo
 *   3. Status pill (AVAILABLE / OCCUPIED) — reflects slider time, not just "now"
 *   4. 24-hour sparkline of real history from /api/courts/{id}/history
 *   5. Quick stats (Now / Peak / Best) from /api/courts/{id}/predictions
 *
 * Below the courts, a timeline scrubber covers the last 24 hours in 288
 * five-minute slots. Dragging it repaints every court's status pill + heat
 * halo to reflect the state at that historical moment. Halo intensity grows
 * with how long the court had been in use at the slider time (0-60 min linear).
 * When the slider is at the rightmost position ("now"), live WebSocket updates
 * drive the view; scrubbing away pins to history.
 *
 * Clicking a court opens a detailed predictions panel with gauge, next-6-hours,
 * peak hours, best times to play, and the full 7×24 weekly heatmap.
 */

// ---------- Constants ----------

const SLOTS = 288;                     // 24h ÷ 5min
const SLOT_MS = 5 * 60 * 1000;         // 5 minutes in ms

// ---------- State ----------

const courts = new Map();              // court_id -> { court_id, name, status, last_updated }
const predictionsCache = new Map();    // court_id -> predictions response
const courtElements = new Map();       // court_id -> { card, canvas, ... }
const courtHistories = new Map();      // court_id -> Array<{ts, status}> sorted ascending by ts
let ws = null;
let reconnectDelay = 1000;

// Scrubber anchor — "now" is relative to page load. Refreshing the page re-anchors.
let sliderAnchorMs = Date.now();
let sliderValue = SLOTS - 1;           // starts at "now"

// ---------- DOM refs ----------

const row = document.getElementById('courtsRow');
const emptyState = document.getElementById('emptyState');
const connStatus = document.getElementById('connStatus');
const lastUpdatedEl = document.getElementById('lastUpdated');

const timelineSlider = document.getElementById('timelineSlider');
const timelineTimeEl = document.getElementById('timelineTime');
const timelineLiveBadge = document.getElementById('timelineLiveBadge');
const timelineNowBtn = document.getElementById('timelineNowBtn');

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
    wireTimeline();
    fetchCourts();
    connectWebSocket();
    setInterval(updateTimeAgos, 30000);
});

// ---------- Fetch initial courts ----------

async function fetchCourts() {
    try {
        const res = await fetch('/api/courts');
        const data = await res.json();
        data.forEach((c) => courts.set(c.court_id, c));
        renderAll();
    } catch (e) {
        console.error('Failed to fetch courts:', e);
    }
}

// ---------- WebSocket ----------

function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
        reconnectDelay = 1000;
        setConnChip('connected', 'live');
    };

    ws.onclose = () => {
        setConnChip('disconnected', 'reconnecting');
        setTimeout(connectWebSocket, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init') {
            msg.data.forEach((c) => courts.set(c.court_id, c));
            renderAll();
        } else if (msg.type === 'status_update') {
            const c = msg.data;
            courts.set(c.court_id, c);

            // Append the new reading to the cached history so the scrubber
            // can see it at the rightmost slot.
            const history = courtHistories.get(c.court_id);
            if (history && c.last_updated) {
                history.push({
                    ts: new Date(c.last_updated).getTime(),
                    status: c.status,
                });
            }

            if (isLive()) {
                // Full re-render: card, sparkline, quick stats, halo.
                renderCourt(c, /*animate*/ true);
            } else {
                // Scrubbed to history — don't disturb the pinned view, but
                // still refresh the sparkline + quick stats + time-ago.
                const card = document.getElementById(`card-${c.court_id}`);
                if (card) loadHistoryAndSparkline(c.court_id, card);
            }
            updateLastUpdated();
        }
    };
}

function setConnChip(cls, label) {
    connStatus.className = 'connection-chip ' + cls;
    connStatus.querySelector('.chip-label').textContent = label;
}

// ---------- Render all courts ----------

function renderAll() {
    row.innerHTML = '';
    courtElements.clear();

    if (courts.size === 0) {
        emptyState.textContent = 'No courts registered yet.';
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    const sorted = [...courts.values()].sort((a, b) =>
        a.court_id.localeCompare(b.court_id)
    );
    sorted.forEach((c) => renderCourt(c, false));
    updateLastUpdated();
}

function renderCourt(court, animate) {
    let card = document.getElementById(`card-${court.court_id}`);
    const isNew = !card;

    if (isNew) {
        card = document.createElement('div');
        card.id = `card-${court.court_id}`;
        card.className = 'court-card';
        card.addEventListener('click', () => openPredictions(court.court_id));
        row.appendChild(card);
        emptyState.classList.add('hidden');
    }

    const statusClass = court.status === 'occupied' ? 'occupied' :
                        court.status === 'available' ? 'available' : '';
    const statusLabel =
        court.status === 'occupied' ? 'Occupied' :
        court.status === 'available' ? 'Available' : 'Unknown';
    const timeAgo = court.last_updated ? formatTimeAgo(court.last_updated) : '—';

    card.innerHTML = `
        <div class="court-header">
            <div class="court-name" title="${escapeHtml(court.name || court.court_id)}">
                ${escapeHtml(court.name || court.court_id)}
            </div>
            <div class="court-time-ago">${timeAgo}</div>
        </div>
        <div class="court-container">
            <svg class="court-svg" viewBox="0 0 96 172" xmlns="http://www.w3.org/2000/svg">
                <rect width="96" height="172" fill="#2a5a24" rx="2"/>
                <rect x="7" y="10" width="82" height="152" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.2"/>
                <line x1="48" y1="10"  x2="48" y2="162" stroke="rgba(255,255,255,0.55)" stroke-width="0.8"/>
                <line x1="7"  y1="86"  x2="89" y2="86"  stroke="rgba(255,255,255,0.75)" stroke-width="1.2"/>
                <line x1="7"  y1="46"  x2="89" y2="46"  stroke="rgba(255,255,255,0.55)" stroke-width="0.8"/>
                <line x1="7"  y1="126" x2="89" y2="126" stroke="rgba(255,255,255,0.55)" stroke-width="0.8"/>
                <line x1="48" y1="46"  x2="48" y2="126" stroke="rgba(255,255,255,0.65)" stroke-width="0.8"/>
                <rect x="33" y="10"  width="30" height="5" fill="rgba(255,255,255,0.2)" rx="1"/>
                <rect x="33" y="157" width="30" height="5" fill="rgba(255,255,255,0.2)" rx="1"/>
            </svg>
            <canvas class="heat-canvas" width="96" height="172"></canvas>
        </div>
        <div class="court-status ${statusClass}">
            <span class="dot"></span>
            ${statusLabel}
        </div>
        <div class="court-usage" title="Real activity over the last 24 hours"></div>
        <div class="court-usage-caption">
            <span>24h ago</span>
            <span>now</span>
        </div>
        <div class="court-stats">
            <div class="stat-line">
                <span class="stat-label">Now</span>
                <span class="stat-value" data-role="now">—</span>
            </div>
            <div class="stat-line">
                <span class="stat-label">Peak</span>
                <span class="stat-value" data-role="peak">—</span>
            </div>
            <div class="stat-line">
                <span class="stat-label">Best</span>
                <span class="stat-value" data-role="best">—</span>
            </div>
            <div class="stat-line">
                <span class="stat-label">Avg Session</span>
                <span class="stat-value" data-role="session">—</span>
            </div>
            <div class="stat-line hidden">
                <span class="stat-label">Opens in</span>
                <span class="stat-value stat-opens" data-role="opens-in">—</span>
            </div>
        </div>
    `;

    // Cache the canvas for the scrubber to paint onto.
    const canvas = card.querySelector('.heat-canvas');
    canvas.classList.add('visible'); // always visible; opacity controlled by alpha

    courtElements.set(court.court_id, {
        card,
        canvas,
    });

    if (animate) {
        card.classList.remove('pulse');
        void card.offsetWidth; // force reflow
        card.classList.add('pulse');
    }

    // Fetch real history for the sparkline + scrubber cache. Predictions for stats.
    loadHistoryAndSparkline(court.court_id, card);

    if (predictionsCache.has(court.court_id)) {
        paintQuickStats(card, predictionsCache.get(court.court_id));
    } else {
        loadQuickStats(court.court_id, card);
    }
}

// ---------- 24h sparkline + history cache (from /api/courts/{id}/history) ----------

async function loadHistoryAndSparkline(courtId, card) {
    try {
        const res = await fetch(`/api/courts/${courtId}/history`);
        const history = await res.json();
        if (!history.length) {
            courtHistories.set(courtId, []);
            // Still render the scrubber view (will show available/no-data).
            renderCourtAtSlider(courtId);
            return;
        }

        // API returns DESCENDING order (most recent first). Cache ascending by ts
        // so the scrubber can do a simple linear walk.
        const sortedAsc = history
            .map((r) => ({
                ts: new Date(r.timestamp).getTime(),
                status: r.status,
            }))
            .sort((a, b) => a.ts - b.ts);
        courtHistories.set(courtId, sortedAsc);

        // ----- Sparkline: bucket into 24 hourly cells -----
        const usageEl = card.querySelector('.court-usage');
        if (usageEl) {
            const now = Date.now();
            const buckets = new Array(24).fill(null);
            // Use the descending history copy to match original "most recent wins" behavior
            history.forEach((r) => {
                const age = (now - new Date(r.timestamp).getTime()) / 3600000;
                const bucket = Math.min(23, Math.floor(age));
                if (buckets[23 - bucket] === null) {
                    buckets[23 - bucket] = r.status;
                }
            });

            let bars = '';
            buckets.forEach((s) => {
                const cls = s === 'occupied' ? 'occupied' :
                            s === 'available' ? 'available' : '';
                const h = s ? 20 : 6;
                bars += `<div class="bar ${cls}" style="height: ${h}px"></div>`;
            });
            usageEl.innerHTML = bars;
        }

        // ----- Scrubber: repaint this court based on current slider position -----
        renderCourtAtSlider(courtId);
    } catch {
        // Non-critical
    }
}

// ---------- Quick stats + daylight data ----------

const daylightCache = new Map(); // court_id -> daylight response

async function loadQuickStats(courtId, card) {
    // Fetch both endpoints in parallel.
    try {
        const [predRes, dayRes] = await Promise.all([
            fetch(`/api/courts/${courtId}/predictions?days=28`),
            fetch(`/api/courts/${courtId}/daylight?days=28&start=6&end=20`),
        ]);
        const predData = await predRes.json();
        const dayData = await dayRes.json();

        if (predData && !predData.error) {
            predictionsCache.set(courtId, predData);
        }
        if (dayData && !dayData.error) {
            daylightCache.set(courtId, dayData);
        }

        paintQuickStats(card, predData, dayData);
    } catch {
        // Non-critical
    }
}

function paintQuickStats(card, predData, dayData) {
    // "Now" prediction
    const nowEl = card.querySelector('[data-role="now"]');
    if (nowEl && predData) {
        nowEl.textContent = predData.current_prediction !== null
            ? `${predData.current_prediction}%`
            : '—';
    }

    // Peak and Best from daylight data (more useful than all-hours)
    if (dayData && !dayData.error) {
        const peakEl = card.querySelector('[data-role="peak"]');
        if (peakEl && dayData.peak_daylight_hours && dayData.peak_daylight_hours.length > 0) {
            const top = dayData.peak_daylight_hours[0];
            peakEl.textContent = `${formatHour(top.hour)} · ${top.occupancy_pct}%`;
        }

        const bestEl = card.querySelector('[data-role="best"]');
        if (bestEl && dayData.best_daylight_times && dayData.best_daylight_times.length > 0) {
            const top = dayData.best_daylight_times[0];
            bestEl.textContent = `${formatHour(top.hour)} · ${top.occupancy_pct}%`;
        }

        // Session duration stat
        const sessEl = card.querySelector('[data-role="session"]');
        if (sessEl && dayData.median_session_min !== null) {
            sessEl.textContent = `~${dayData.median_session_min} min`;
        }

        // Opening estimate for occupied courts
        const openEl = card.querySelector('[data-role="opens-in"]');
        if (openEl) {
            if (dayData.current_session && dayData.current_session.est_remaining_min > 0) {
                openEl.textContent = `~${dayData.current_session.est_remaining_min} min`;
                openEl.closest('.stat-line').classList.remove('hidden');
            } else {
                openEl.closest('.stat-line').classList.add('hidden');
            }
        }
    } else if (predData && !predData.error) {
        // Fallback to all-hours predictions if daylight call failed
        const peakEl = card.querySelector('[data-role="peak"]');
        if (peakEl && predData.peak_hours && predData.peak_hours.length > 0) {
            const top = predData.peak_hours[0];
            peakEl.textContent = `${formatHour(top.hour)} · ${top.occupancy_pct}%`;
        }
        const bestEl = card.querySelector('[data-role="best"]');
        if (bestEl && predData.best_times && predData.best_times.length > 0) {
            const top = predData.best_times[0];
            bestEl.textContent = `${formatHour(top.hour)} · ${top.occupancy_pct}%`;
        }
    }
}

// ---------- Time helpers ----------

function formatTimeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 0) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d`;
}

function updateTimeAgos() {
    courts.forEach((c) => {
        const card = document.getElementById(`card-${c.court_id}`);
        if (!card || !c.last_updated) return;
        const el = card.querySelector('.court-time-ago');
        if (el) el.textContent = formatTimeAgo(c.last_updated);
    });
}

function updateLastUpdated() {
    const times = [...courts.values()]
        .map((c) => c.last_updated)
        .filter(Boolean)
        .map((t) => new Date(t).getTime());
    if (times.length) {
        const latest = new Date(Math.max(...times));
        lastUpdatedEl.textContent = `updated ${latest.toLocaleTimeString()}`;
    }
}

// ---------- Predictions Panel (detailed view) ----------

const predPanel = document.getElementById('predictionsPanel');
const predClose = document.getElementById('predClose');

predClose.addEventListener('click', () => {
    predPanel.classList.add('hidden');
});

function openPredictions(courtId) {
    const court = courts.get(courtId);
    if (!court) return;

    document.getElementById('predCourtName').textContent =
        `${court.name || courtId} — Predicted Usage`;
    predPanel.classList.remove('hidden');

    // Loading state
    document.getElementById('predCurrent').innerHTML = '<span class="pred-loading">Analyzing...</span>';
    document.getElementById('predNextHours').innerHTML = '';
    document.getElementById('predPeak').innerHTML = '';
    document.getElementById('predBest').innerHTML = '';
    document.getElementById('predHeatmap').innerHTML = '';
    document.getElementById('predFooter').textContent = '';

    // Clear daylight + session sections
    document.getElementById('predDaylight').innerHTML = '';
    document.getElementById('predSessions').innerHTML = '';

    // Use cached data if we have it, otherwise fetch.
    if (predictionsCache.has(courtId)) {
        renderPredictions(predictionsCache.get(courtId));
    } else {
        fetchPredictions(courtId);
    }

    // Daylight data (may already be cached from the card quick-stats fetch).
    if (daylightCache.has(courtId)) {
        renderDaylightPanel(daylightCache.get(courtId));
    } else {
        fetchDaylight(courtId);
    }

    // Smooth scroll to the panel so the user sees it.
    setTimeout(() => {
        predPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
}

async function fetchPredictions(courtId) {
    try {
        const res = await fetch(`/api/courts/${courtId}/predictions?days=28`);
        const data = await res.json();
        if (data.error) {
            document.getElementById('predCurrent').innerHTML =
                '<span class="pred-no-data">Not enough data yet. Predictions improve as more readings are collected.</span>';
            return;
        }
        predictionsCache.set(courtId, data);
        renderPredictions(data);
    } catch {
        document.getElementById('predCurrent').innerHTML =
            '<span class="pred-no-data">Failed to load predictions.</span>';
    }
}

function renderPredictions(data) {
    // Current prediction
    const curEl = document.getElementById('predCurrent');
    if (data.current_prediction !== null) {
        const level = occupancyLevel(data.current_prediction);
        curEl.innerHTML = `
            <div class="pred-gauge ${level.cls}">
                <div class="pred-gauge-fill" style="width: ${data.current_prediction}%"></div>
            </div>
            <span class="pred-gauge-label">${data.current_prediction}% likely occupied — ${level.label}</span>
        `;
    } else {
        curEl.innerHTML = '<span class="pred-no-data">No data for this time slot yet.</span>';
    }

    // Next 6 hours
    const nextEl = document.getElementById('predNextHours');
    let nextHtml = '<div class="pred-hour-bars">';
    data.next_hours.forEach((h) => {
        const pct = h.occupancy_pct ?? 0;
        const hasData = h.occupancy_pct !== null;
        const level = occupancyLevel(pct);
        const label = hasData ? `${pct}%` : '?';
        const hourLabel = formatHour(h.hour);
        nextHtml += `
            <div class="pred-hour-bar">
                <div class="pred-hour-fill-wrap">
                    <div class="pred-hour-fill ${hasData ? level.cls : ''}" style="height: ${hasData ? Math.max(pct, 4) : 4}%"></div>
                </div>
                <span class="pred-hour-pct">${label}</span>
                <span class="pred-hour-label">${hourLabel}</span>
            </div>
        `;
    });
    nextHtml += '</div>';
    nextEl.innerHTML = nextHtml;

    // Peak hours
    const peakEl = document.getElementById('predPeak');
    if (data.peak_hours.length) {
        peakEl.innerHTML = data.peak_hours
            .map((h) => `<span class="pred-tag peak">${formatHour(h.hour)} <small>${h.occupancy_pct}%</small></span>`)
            .join('');
    } else {
        peakEl.innerHTML = '<span class="pred-no-data">Not enough data.</span>';
    }

    // Best times
    const bestEl = document.getElementById('predBest');
    if (data.best_times.length) {
        bestEl.innerHTML = data.best_times
            .map((h) => `<span class="pred-tag best">${formatHour(h.hour)} <small>${h.occupancy_pct}%</small></span>`)
            .join('');
    } else {
        bestEl.innerHTML = '<span class="pred-no-data">Not enough data.</span>';
    }

    // Heatmap
    const heatEl = document.getElementById('predHeatmap');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let heatHtml = '<div class="heatmap-grid">';
    // Header row: blank corner + 24 hour columns
    heatHtml += '<div class="heatmap-cell heatmap-corner"></div>';
    for (let h = 0; h < 24; h++) {
        heatHtml += `<div class="heatmap-cell heatmap-header">${h}</div>`;
    }
    // Data rows
    for (let d = 0; d < 7; d++) {
        heatHtml += `<div class="heatmap-cell heatmap-day">${days[d]}</div>`;
        for (let h = 0; h < 24; h++) {
            const val = data.heatmap[d][h];
            const bg = val !== null ? heatmapColor(val) : 'var(--border)';
            const title = val !== null ? `${days[d]} ${formatHour(h)}: ${val}% occupied` : 'No data';
            heatHtml += `<div class="heatmap-cell heatmap-val" style="background:${bg}" title="${title}"></div>`;
        }
    }
    heatHtml += '</div>';
    // Legend
    heatHtml += `
        <div class="heatmap-legend">
            <span>low</span>
            <div class="heatmap-legend-bar"></div>
            <span>high</span>
        </div>
    `;
    heatEl.innerHTML = heatHtml;

    document.getElementById('predFooter').textContent =
        `Based on ${data.total_readings.toLocaleString()} readings over the last ${data.data_days} days`;
}

// ---------- Daylight predictions panel ----------

async function fetchDaylight(courtId) {
    try {
        const res = await fetch(`/api/courts/${courtId}/daylight?days=28&start=6&end=20`);
        const data = await res.json();
        if (data && !data.error) {
            daylightCache.set(courtId, data);
            renderDaylightPanel(data);
        }
    } catch {
        document.getElementById('predDaylight').innerHTML =
            '<span class="pred-no-data">Failed to load daylight data.</span>';
    }
}

function renderDaylightPanel(data) {
    // Daylight heatmap (7 × daylight_hours.length)
    const dayEl = document.getElementById('predDaylight');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = data.daylight_hours || [];

    let html = '<div class="heatmap-grid" style="grid-template-columns: 36px repeat(' + hours.length + ', 1fr)">';
    // Header row
    html += '<div class="heatmap-cell heatmap-corner"></div>';
    for (const h of hours) {
        html += `<div class="heatmap-cell heatmap-header">${h}</div>`;
    }
    // Data rows
    for (let d = 0; d < 7; d++) {
        html += `<div class="heatmap-cell heatmap-day">${days[d]}</div>`;
        for (let c = 0; c < hours.length; c++) {
            const val = data.daylight_heatmap[d][c];
            const bg = val !== null ? heatmapColor(val) : 'var(--border)';
            const title = val !== null
                ? `${days[d]} ${formatHour(hours[c])}: ${val}% occupied`
                : 'No data';
            html += `<div class="heatmap-cell heatmap-val" style="background:${bg}" title="${title}"></div>`;
        }
    }
    html += '</div>';
    html += `<div class="heatmap-legend"><span>low</span><div class="heatmap-legend-bar"></div><span>high</span></div>`;

    // Peak + best as tags
    if (data.peak_daylight_hours && data.peak_daylight_hours.length) {
        html += '<div style="margin-top:0.6rem"><span style="font-size:10px;color:var(--text-muted)">PEAK: </span>';
        html += data.peak_daylight_hours
            .map(h => `<span class="pred-tag peak">${formatHour(h.hour)} <small>${h.occupancy_pct}%</small></span>`)
            .join('');
        html += '</div>';
    }
    if (data.best_daylight_times && data.best_daylight_times.length) {
        html += '<div style="margin-top:0.3rem"><span style="font-size:10px;color:var(--text-muted)">BEST: </span>';
        html += data.best_daylight_times
            .map(h => `<span class="pred-tag best">${formatHour(h.hour)} <small>${h.occupancy_pct}%</small></span>`)
            .join('');
        html += '</div>';
    }

    dayEl.innerHTML = html;

    // Session stats
    const sessEl = document.getElementById('predSessions');
    let sessHtml = '';
    if (data.session_count > 0) {
        sessHtml += `<div class="pred-session-stats">`;
        sessHtml += `<div class="pred-stat-row"><span>Completed sessions</span><strong>${data.session_count}</strong></div>`;
        sessHtml += `<div class="pred-stat-row"><span>Average duration</span><strong>${data.avg_session_min} min</strong></div>`;
        sessHtml += `<div class="pred-stat-row"><span>Median duration</span><strong>${data.median_session_min} min</strong></div>`;
        if (data.current_session) {
            sessHtml += `<div class="pred-stat-row highlight"><span>Currently occupied for</span><strong>${data.current_session.duration_min} min</strong></div>`;
            sessHtml += `<div class="pred-stat-row highlight"><span>Estimated opens in</span><strong>~${data.current_session.est_remaining_min} min</strong></div>`;
        }
        sessHtml += `</div>`;
    } else {
        sessHtml = '<span class="pred-no-data">Not enough session data yet.</span>';
    }
    sessEl.innerHTML = sessHtml;
}

function occupancyLevel(pct) {
    if (pct < 30) return { cls: 'low', label: 'Likely available' };
    if (pct < 60) return { cls: 'medium', label: 'Moderate demand' };
    return { cls: 'high', label: 'Usually busy' };
}

function formatHour(h) {
    if (h === 0) return '12a';
    if (h < 12) return `${h}a`;
    if (h === 12) return '12p';
    return `${h - 12}p`;
}

function heatmapColor(pct) {
    // Green (available) -> Yellow -> Red (occupied)
    if (pct <= 50) {
        const r = Math.round(34 + (pct / 50) * (234 - 34));
        const g = Math.round(163 + (pct / 50) * (179 - 163));
        const b = Math.round(74 + (pct / 50) * (8 - 74));
        return `rgb(${r},${g},${b})`;
    }
    const t = (pct - 50) / 50;
    const r = Math.round(234 + t * (220 - 234));
    const g = Math.round(179 - t * (179 - 38));
    const b = Math.round(8 + t * (38 - 8));
    return `rgb(${r},${g},${b})`;
}

// ---------- Timeline scrubber ----------

function wireTimeline() {
    if (!timelineSlider) return;

    timelineSlider.addEventListener('input', () => {
        sliderValue = parseInt(timelineSlider.value, 10);
        onSliderChanged();
    });

    if (timelineNowBtn) {
        timelineNowBtn.addEventListener('click', () => {
            // Re-anchor to the real "now" so the label is accurate when you jump
            // back from scrubbed history.
            sliderAnchorMs = Date.now();
            sliderValue = SLOTS - 1;
            timelineSlider.value = String(sliderValue);
            onSliderChanged();
        });
    }

    // Initial paint + label
    onSliderChanged();
}

function onSliderChanged() {
    updateTimelineLabel();
    renderAllCourtsAtSlider();
}

function slotToTimeMs(slot) {
    // slot 0 = 24h ago, slot (SLOTS-1) = sliderAnchorMs ("now")
    return sliderAnchorMs - ((SLOTS - 1) - slot) * SLOT_MS;
}

function isLive() {
    return sliderValue === SLOTS - 1;
}

function updateTimelineLabel() {
    const t = slotToTimeMs(sliderValue);
    const date = new Date(t);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    timelineTimeEl.textContent = `${hh}:${mm}`;

    if (isLive()) {
        timelineLiveBadge.classList.remove('hidden');
        timelineNowBtn.classList.add('hidden');
    } else {
        timelineLiveBadge.classList.add('hidden');
        timelineNowBtn.classList.remove('hidden');
    }
}

/**
 * Compute a court's state at a given time based on cached history.
 * Returns { status: 'available' | 'occupied' | 'unknown', durationMinutes: number }.
 * durationMinutes is only meaningful when status === 'occupied' — it's how long
 * the court had been continuously occupied up to timeMs.
 */
function courtStateAt(courtId, timeMs) {
    const history = courtHistories.get(courtId);
    if (!history || history.length === 0) {
        return { status: 'unknown', durationMinutes: 0 };
    }

    // Find the index of the last reading with ts <= timeMs.
    let idx = -1;
    for (let i = 0; i < history.length; i++) {
        if (history[i].ts <= timeMs) idx = i;
        else break;
    }

    if (idx === -1) {
        // All readings are after timeMs — no data at this time point.
        return { status: 'unknown', durationMinutes: 0 };
    }

    const current = history[idx];
    if (current.status !== 'occupied') {
        return { status: current.status, durationMinutes: 0 };
    }

    // Walk backwards to find the most recent 'available' reading — the start
    // of the current occupied run. If we don't find one, the run started at
    // (or before) the earliest reading we have.
    let runStart = current.ts;
    for (let i = idx - 1; i >= 0; i--) {
        if (history[i].status !== 'occupied') {
            // The occupied run began after this available reading. Use the
            // next reading's timestamp as the run start.
            runStart = history[i + 1].ts;
            break;
        }
        if (i === 0) {
            // Entire history is occupied — assume the run started at the first reading.
            runStart = history[0].ts;
        }
    }

    const durationMs = timeMs - runStart;
    return {
        status: 'occupied',
        durationMinutes: Math.max(0, durationMs / 60000),
    };
}

function renderCourtAtSlider(courtId) {
    const el = courtElements.get(courtId);
    if (!el) return;
    const state = courtStateAt(courtId, slotToTimeMs(sliderValue));
    paintCourtState(el, state);
}

function renderAllCourtsAtSlider() {
    courtElements.forEach((_, courtId) => renderCourtAtSlider(courtId));
}

function paintCourtState(el, state) {
    // Update status pill
    const pill = el.card.querySelector('.court-status');
    if (pill) {
        pill.classList.remove('available', 'occupied');
        if (state.status === 'available' || state.status === 'occupied') {
            pill.classList.add(state.status);
        }
        const label =
            state.status === 'occupied' ? 'Occupied' :
            state.status === 'available' ? 'Available' : 'Unknown';
        // Preserve the dot span, replace just the trailing text node
        pill.innerHTML = `<span class="dot"></span> ${label}`;
    }

    // Draw the halo
    drawHalo(el.canvas, state);
}

/**
 * Draw a duration-driven halo on the court.
 *
 * Intensity (0..1) grows linearly with the occupation duration (0..60 min).
 * As intensity increases, the halo simultaneously:
 *   1. Shifts color:  green → yellow → red (traffic-light gradient)
 *   2. Darkens:       baseline hue multiplied by 1.0 → 0.55 (grows dimmer)
 *   3. Solidifies:    soft glow at 0 min → near-disc at 60 min
 *   4. Intensifies:   alpha 0.4 → 0.95 (more opaque over time)
 *   5. Grows:         radius 42 → 84 px
 *
 * Result: a just-started court shows a bright, soft green glow; a long-run
 * court shows a dark, solid red disc that reads as "has been here a while".
 */
function drawHalo(canvas, state) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 96, 172);

    if (state.status !== 'occupied' || state.durationMinutes <= 0) return;

    const intensity = Math.min(1, state.durationMinutes / 60);

    // Base traffic-light hue, then darkened per intensity.
    // At max intensity the red is multiplied by 0.35 → rgb(84, 24, 24),
    // a deep brick red that reads as clearly dark against the court green.
    let [r, g, b] = interpolateTrafficLight(intensity);
    const darkness = 1.0 - intensity * 0.8;    // 1.0 → 0.20
    r = Math.round(r * darkness);
    g = Math.round(g * darkness);
    b = Math.round(b * darkness);

    // Geometry + opacity both increase with duration.
    const radius = 42 + intensity * 42;        // 42..84 px
    const alpha  = 0.4 + intensity * 0.6;      // 0.40..1.00  (fully solid at 60+ min)

    // Hard-edge position:
    //   low intensity  → 0.20  (mostly fade, soft glow)
    //   high intensity → 0.85  (mostly solid disc, thin edge fade)
    const hardEdge = 0.2 + intensity * 0.65;

    const grad = ctx.createRadialGradient(48, 86, 0, 48, 86, radius);
    grad.addColorStop(0,         `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grad.addColorStop(hardEdge,  `rgba(${r}, ${g}, ${b}, ${alpha})`);
    grad.addColorStop(1,         `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(48, 86, radius, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * Interpolate smoothly across the green → yellow → red traffic-light palette.
 * intensity 0.0 = bright green, 0.5 = yellow, 1.0 = red.
 */
function interpolateTrafficLight(intensity) {
    // Anchors
    const GREEN  = [34,  197, 94];   // rgb(34, 197, 94)   — Tailwind green-500
    const YELLOW = [234, 179, 8];    // rgb(234, 179, 8)   — Tailwind yellow-500
    const RED    = [239, 68,  68];   // rgb(239, 68, 68)   — Tailwind red-500

    if (intensity <= 0.5) {
        const t = intensity * 2;  // 0..1 across first half
        return [
            Math.round(GREEN[0]  + (YELLOW[0] - GREEN[0])  * t),
            Math.round(GREEN[1]  + (YELLOW[1] - GREEN[1])  * t),
            Math.round(GREEN[2]  + (YELLOW[2] - GREEN[2])  * t),
        ];
    } else {
        const t = (intensity - 0.5) * 2;  // 0..1 across second half
        return [
            Math.round(YELLOW[0] + (RED[0]    - YELLOW[0]) * t),
            Math.round(YELLOW[1] + (RED[1]    - YELLOW[1]) * t),
            Math.round(YELLOW[2] + (RED[2]    - YELLOW[2]) * t),
        ];
    }
}

// ---------- Util ----------

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
