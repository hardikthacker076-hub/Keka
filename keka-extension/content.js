/* Keka Calculator (Daily Average Explicit v13) */

(function () {
    'use strict';
    console.log("Keka Helper: Script started (v101) - Document ready state: " + document.readyState);

    const CONFIG = {
        grossTarget: 45,
        effectiveTarget: 40,
        deductionHoliday: 9,
        deductionHalfDay: 5
    };

    let hasCalculated = false;
    let observer = null;

    function parseDuration(text) {
        if (!text) return 0;
        const match = text.match(/(\d+)h\s+(\d+)m/);
        if (match) {
            return (parseInt(match[1], 10) * 60) + parseInt(match[2], 10);
        }
        return 0;
    }

    function parseTime(timeStr) {
        if (!timeStr) return null;
        const now = new Date();
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let cleanTime = timeStr.trim().split(' ')[0];
        let parts = cleanTime.split(':');

        if (parts.length >= 2) {
            const h = parseInt(parts[0]);
            date.setHours(h, parseInt(parts[1]), parseInt(parts[2] || 0));
            return date;
        }
        return null;
    }

    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function getMonday(d) {
        d = new Date(d);
        var day = d.getDay(),
            diff = d.getDate() - day + (day == 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Web Audio API Helpers — lazy AudioContext (avoids autoplay policy error)
    let _audioCtx = null;
    function getAudioCtx() {
        if (!_audioCtx) {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
            _audioCtx.resume().catch(() => { });
        }
        return _audioCtx;
    }

    function playSuccessSound() {
        const audioCtx = getAudioCtx();

        const now = audioCtx.currentTime;

        // 1. Fanfare (Trumpet-like waves)
        const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C Major
        frequencies.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.type = 'sawtooth'; // Brighter sound
            osc.frequency.setValueAtTime(freq, now);

            // Staggered start
            const start = now + (i * 0.05);

            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.15, start + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 1.5);

            osc.start(start);
            osc.stop(start + 1.5);
        });

        // 2. Applause / Cheering (Filtered White Noise)
        const bufferSize = audioCtx.sampleRate * 2.5; // 2.5 seconds
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.5; // White noise
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const noiseGain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        filter.type = 'lowpass';
        filter.frequency.value = 1000; // Muffle it a bit to sound like a crowd

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);

        // Envelope for applause (burst then fade)
        noiseGain.gain.setValueAtTime(0, now);
        noiseGain.gain.linearRampToValueAtTime(0.25, now + 0.1);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        noise.start(now);
        noise.stop(now + 2.5);
    }

    function playFailureSound() {
        const audioCtx = getAudioCtx();

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // Sad trombone effect (descending slide)
        const now = audioCtx.currentTime;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(196.00, now); // G3
        oscillator.frequency.linearRampToValueAtTime(130.81, now + 1.5); // Slide down to C3

        // Volume 0.3
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 1.5);

        oscillator.start(now);
        oscillator.stop(now + 1.5);
    }

    const toHm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

    function createBanner(grossLogoff, effectiveLogoff, grossLeft, effectiveLeft, grossWorked, effectiveWorked, avgNote) {
        // Try multiple selectors to find the container
        let actionsSection = null;

        // Method 1: Find by "24 hour format" label
        const label = Array.from(document.querySelectorAll('label')).find(el => el.textContent.includes('24 hour format'));
        if (label) {
            actionsSection = label.parentElement;
            console.log("Keka Helper: Found actions section via '24 hour format' label");
        }

        // Method 2: Fallback - find any label with a toggle switch
        if (!actionsSection) {
            const toggleLabel = Array.from(document.querySelectorAll('label')).find(el => {
                const toggle = el.querySelector('input[type="checkbox"]');
                return toggle !== null;
            });
            if (toggleLabel) {
                actionsSection = toggleLabel.parentElement;
                console.log("Keka Helper: Found actions section via toggle switch fallback");
            }
        }

        // Method 3: Fallback - find the header area directly
        if (!actionsSection) {
            const header = document.querySelector('employee-attendance-list-view');
            if (header) {
                actionsSection = header.querySelector('div[class*="flex"], div[class*="header"]');
                console.log("Keka Helper: Found actions section via header fallback");
            }
        }

        // Method 4: Last resort - create fixed position container
        if (!actionsSection) {
            console.log("Keka Helper: All selector methods failed. Using fixed-position fallback...");

            // Create a fixed container in the top-right corner
            let fixedContainer = document.getElementById('keka-fixed-container');
            if (!fixedContainer) {
                fixedContainer = document.createElement('div');
                fixedContainer.id = 'keka-fixed-container';
                fixedContainer.style.cssText = 'position: fixed; top: 70px; right: 20px; z-index: 9999;';
                document.body.appendChild(fixedContainer);
                console.log("Keka Helper: Created fixed-position container");
            }
            actionsSection = fixedContainer;
        }



        // Remove existing elements if present
        const existingIcon = document.getElementById('keka-helper-icon');
        const existingPanel = document.getElementById('keka-helper-panel');
        if (existingIcon) existingIcon.remove();
        if (existingPanel) existingPanel.remove();

        // Create icon button
        const iconButton = document.createElement('div');
        iconButton.id = 'keka-helper-icon';
        iconButton.title = 'Keka Helper';
        iconButton.style.cssText = [
            'position: relative',
            'display: inline-flex',
            'align-items: center',
            'gap: 5px',
            'padding: 3px 10px 3px 7px',
            'margin-left: 10px',
            'cursor: pointer',
            'border-radius: 20px',
            'background: linear-gradient(135deg, rgba(243,156,18,0.15), rgba(241,196,15,0.08))',
            'border: 1px solid rgba(243,156,18,0.4)',
            'transition: all 0.2s',
            'user-select: none'
        ].join(';');

        iconButton.innerHTML = `<span style="font-size:17px; line-height:1; display:flex; align-items:center;">⏱</span>`;

        iconButton.style.cssText = [
            'position: relative',
            'display: inline-flex',
            'align-items: center',
            'justify-content: center',
            'width: 28px',
            'height: 28px',
            'margin-left: 10px',
            'cursor: pointer',
            'border-radius: 50%',
            'background: linear-gradient(135deg, rgba(243,156,18,0.15), rgba(241,196,15,0.08))',
            'border: 1px solid rgba(243,156,18,0.4)',
            'transition: all 0.2s',
            'user-select: none'
        ].join(';');

        iconButton.onmouseover = () => {
            iconButton.style.background = 'linear-gradient(135deg, rgba(243,156,18,0.25), rgba(241,196,15,0.15))';
            iconButton.style.borderColor = 'rgba(243,156,18,0.7)';
        };
        iconButton.onmouseout = () => {
            iconButton.style.background = 'linear-gradient(135deg, rgba(243,156,18,0.15), rgba(241,196,15,0.08))';
            iconButton.style.borderColor = 'rgba(243,156,18,0.4)';
        };

        // Inject Styles for Modern UI
        if (!document.getElementById('keka-helper-styles')) {
            const style = document.createElement('style');
            style.id = 'keka-helper-styles';
            style.textContent = `
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

                .keka-helper-panel {
                    position: absolute; top: calc(100% + 10px); right: 0;
                    width: 420px;
                    background: #0f1923;
                    border-radius: 16px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06);
                    z-index: 9999; color: #e8ecef;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    overflow: hidden;
                    animation: keka-slide-in 0.18s ease;
                }
                @keyframes keka-slide-in {
                    from { opacity: 0; transform: translateY(-6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .keka-panel-header {
                    padding: 14px 18px 12px;
                    background: linear-gradient(135deg, #1a2332 0%, #151f2a 100%);
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                    display: flex; align-items: center; justify-content: space-between;
                }
                .keka-panel-title {
                    font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
                    text-transform: uppercase; color: rgba(255,255,255,0.4);
                }
                .keka-panel-body {
                    padding: 16px 18px;
                }
                .keka-cards-row {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;
                }
                .keka-card {
                    border-radius: 12px; padding: 14px 16px;
                    position: relative; overflow: hidden;
                }
                .keka-card-gross {
                    background: linear-gradient(135deg, rgba(255,219,77,0.08) 0%, rgba(255,190,10,0.04) 100%);
                    border: 1px solid rgba(255,219,77,0.18);
                }
                .keka-card-effective {
                    background: linear-gradient(135deg, rgba(85,239,196,0.08) 0%, rgba(0,184,148,0.04) 100%);
                    border: 1px solid rgba(85,239,196,0.18);
                }
                .keka-card-type {
                    font-size: 9px; font-weight: 700; letter-spacing: 1px;
                    text-transform: uppercase; margin-bottom: 10px;
                    opacity: 0.5;
                }
                .keka-card-outtime {
                    font-size: 30px; font-weight: 800; letter-spacing: -1.5px;
                    line-height: 1; margin-bottom: 10px;
                }
                .keka-card-gross .keka-card-outtime { color: #ffd94d; }
                .keka-card-effective .keka-card-outtime { color: #55efc4; }
                .keka-card-meta {
                    display: flex; flex-direction: column; gap: 3px;
                }
                .keka-card-meta-row {
                    display: flex; justify-content: space-between; align-items: center;
                }
                .keka-card-meta-label {
                    font-size: 10px; opacity: 0.45; font-weight: 500;
                }
                .keka-card-meta-val {
                    font-size: 11px; font-weight: 600;
                }
                .keka-card-gross .keka-card-meta-val { color: #ffd94d; }
                .keka-card-effective .keka-card-meta-val { color: #55efc4; }
                .keka-avg-note {
                    text-align: center; font-size: 11px; color: rgba(255,255,255,0.35);
                    margin-bottom: 14px; font-style: italic;
                }
                .keka-divider {
                    height: 1px; background: rgba(255,255,255,0.06); margin: 0 0 14px;
                }
                .keka-label {
                    font-size: 10px; opacity: 0.4; text-transform: uppercase;
                    letter-spacing: 1px; margin-bottom: 8px; font-weight: 700;
                }
                .keka-shortcuts-row {
                    display: flex; gap: 6px; margin-bottom: 10px; overflow-x: auto; padding-bottom: 2px;
                    flex-wrap: wrap;
                }
                .keka-shortcuts-row::-webkit-scrollbar { height: 0px; }
                .keka-shortcut-btn {
                    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
                    color: rgba(255,255,255,0.6); padding: 5px 12px; border-radius: 20px;
                    font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s;
                    white-space: nowrap; font-family: inherit;
                }
                .keka-shortcut-btn:hover {
                    background: rgba(255,255,255,0.12); color: #fff; border-color: rgba(255,255,255,0.25);
                }
                .keka-input-group { display: flex; gap: 8px; margin-bottom: 10px; }
                .keka-input {
                    width: 100%; background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.1);
                    color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 12px;
                    outline: none; transition: all 0.2s; color-scheme: dark; font-family: inherit;
                }
                .keka-input:focus { border-color: rgba(52,152,219,0.7); background: rgba(52,152,219,0.08); }
                .keka-input::-webkit-calendar-picker-indicator { filter: invert(1); opacity: 0.5; cursor: pointer; }
                .keka-btn {
                    width: 100%; padding: 10px; border: none; border-radius: 8px;
                    color: #fff; cursor: pointer; font-size: 11px; font-weight: 600;
                    transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.6px;
                    font-family: inherit;
                }
                .keka-btn-primary {
                    background: linear-gradient(135deg, #3498db, #2471a3);
                    box-shadow: 0 4px 14px rgba(52,152,219,0.35);
                }
                .keka-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(52,152,219,0.45); }
                .keka-btn-secondary {
                    background: rgba(255,255,255,0.05); margin-top: 10px;
                    color: rgba(255,255,255,0.5); border: 1px solid rgba(255,255,255,0.08);
                }
                .keka-btn-secondary:hover { background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.8); }
                .keka-result-card {
                    background: rgba(255,255,255,0.04); padding: 12px 14px;
                    border-radius: 10px; margin-top: 10px;
                    border: 1px solid rgba(255,255,255,0.07);
                }
            `;
            document.head.appendChild(style);
        }

        // Create dropdown panel (hidden by default)
        const panel = document.createElement('div');
        panel.id = 'keka-helper-panel';
        panel.className = 'keka-helper-panel';
        panel.style.display = 'none'; // Keep initial state hidden

        const today = new Date().toISOString().split('T')[0];

        panel.innerHTML = `
            <div class="keka-panel-header">
                <span class="keka-panel-title">⏱ Today's Target</span>
                ${avgNote ? `<span style="font-size:11px; color:rgba(255,200,80,0.75); font-weight:500;">${avgNote}</span>` : ''}
            </div>
            <div class="keka-panel-body">
                <!-- OUT TIME CARDS -->
                <div class="keka-cards-row">
                    <!-- Gross Card -->
                    <div class="keka-card keka-card-gross">
                        <div class="keka-card-type">Gross · 9h</div>
                        <div class="keka-card-outtime">${grossLogoff}</div>
                        <div class="keka-card-meta">
                            <div class="keka-card-meta-row">
                                <span class="keka-card-meta-label">Worked</span>
                                <span class="keka-card-meta-val">${grossWorked}</span>
                            </div>
                            <div class="keka-card-meta-row">
                                <span class="keka-card-meta-label">Left</span>
                                <span class="keka-card-meta-val">${grossLeft}</span>
                            </div>
                        </div>
                    </div>
                    <!-- Effective Card -->
                    <div class="keka-card keka-card-effective">
                        <div class="keka-card-type">Effective · 8h</div>
                        <div class="keka-card-outtime">${effectiveLogoff}</div>
                        <div class="keka-card-meta">
                            <div class="keka-card-meta-row">
                                <span class="keka-card-meta-label">Worked</span>
                                <span class="keka-card-meta-val">${effectiveWorked}</span>
                            </div>
                            <div class="keka-card-meta-row">
                                <span class="keka-card-meta-label">Left</span>
                                <span class="keka-card-meta-val">${effectiveLeft}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="keka-divider"></div>

            <!-- Range Calculator -->
            <div class="keka-label">Range Calculator</div>
            
            <!-- Shortcuts (Always Visible) -->
            <div class="keka-shortcuts-row">
                <button id="keka-sc-this-week" class="keka-shortcut-btn">This Week</button>
                <button id="keka-sc-last-week" class="keka-shortcut-btn">Last Week</button>
                <button id="keka-sc-this-month" class="keka-shortcut-btn">This Month</button>
                <button id="keka-toggle-custom" class="keka-shortcut-btn">Custom</button>
            </div>

            <!-- Custom Date Inputs (Hidden by default) -->
            <div id="keka-custom-container" style="display: none;">
                <div class="keka-input-group">
                    <input type="date" id="keka-start-date" max="${today}" class="keka-input">
                    <input type="date" id="keka-end-date" max="${today}" class="keka-input">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="keka-calc-range" class="keka-btn keka-btn-primary" style="flex: 1;">
                        Calculate Range
                    </button>
                    <button id="keka-clear-range" class="keka-btn" style="width: auto !important; background: rgba(231, 76, 60, 0.2); border-color: rgba(231, 76, 60, 0.4); color: rgba(231, 76, 60, 0.9); padding: 0 12px; font-size: 14px; min-width: 40px;" title="Clear Dates">✕</button>
                </div>
            </div> <!-- End of Custom Container -->

            <!-- Range Results (Always visible when populated) -->
            <div id="keka-range-result" class="keka-result-card" style="display: none;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 12px; opacity: 0.7;">Total Gross</span>
                    <span id="range-gross-total" style="font-size: 12px; font-weight: 700; color: #ffeaa7;">0h 0m</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="font-size: 12px; opacity: 0.7;">Total Effective</span>
                    <span id="range-effective-total" style="font-size: 12px; font-weight: 700; color: #55efc4;">0h 0m</span>
                </div>
            </div>


            <button id="keka-refresh-panel" class="keka-btn keka-btn-secondary">
                ↻ Refresh Today's Data
            </button>
            </div><!-- end keka-panel-body -->
        `;

        // Append icon to actions section
        actionsSection.appendChild(iconButton);
        iconButton.appendChild(panel);

        // Toggle panel on click
        iconButton.onclick = (e) => {
            e.stopPropagation();
            const isVisible = panel.style.display === 'block';
            panel.style.display = isVisible ? 'none' : 'block';
        };

        // Prevent panel close when interacting with panel contents (like date pickers)
        panel.onclick = (e) => {
            e.stopPropagation();
        };

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!iconButton.contains(e.target)) {
                panel.style.display = 'none';
            }
        });

        // Range Calculation Logic
        const calcRangeBtn = document.getElementById('keka-calc-range');

        // Helper to set dates and click calculate
        const setRangeAndCalc = (start, end) => {
            // Use local YYYY-MM-DD to avoid UTC offset issues
            const toLocalISO = (d) => {
                const offset = d.getTimezoneOffset() * 60000;
                return new Date(d.getTime() - offset).toISOString().split('T')[0];
            };

            document.getElementById('keka-start-date').value = toLocalISO(start);
            document.getElementById('keka-end-date').value = toLocalISO(end);
            if (calcRangeBtn) calcRangeBtn.click();
        };

        // Shortcuts Logic
        const scThisWeek = document.getElementById('keka-sc-this-week');
        const scLastWeek = document.getElementById('keka-sc-last-week');
        const scThisMonth = document.getElementById('keka-sc-this-month');

        if (scThisWeek) {
            scThisWeek.onclick = (e) => {
                e.stopPropagation();
                const now = new Date();
                const start = getMonday(now);
                setRangeAndCalc(start, now);
                // Auto-close custom date section
                const customContainer = document.getElementById('keka-custom-container');
                if (customContainer) customContainer.style.display = 'none';
            };
        }

        if (scLastWeek) {
            scLastWeek.onclick = (e) => {
                e.stopPropagation();
                const now = new Date();
                const start = getMonday(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                setRangeAndCalc(start, end);
                // Auto-close custom date section
                const customContainer = document.getElementById('keka-custom-container');
                if (customContainer) customContainer.style.display = 'none';
            };
        }

        if (scThisMonth) {
            scThisMonth.onclick = (e) => {
                e.stopPropagation();
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                setRangeAndCalc(start, now);
                // Auto-close custom date section
                const customContainer = document.getElementById('keka-custom-container');
                if (customContainer) customContainer.style.display = 'none';
            };
        }

        const scClear = document.getElementById('keka-clear-range');
        if (scClear) {
            scClear.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('keka-start-date').value = '';
                document.getElementById('keka-end-date').value = '';
                document.getElementById('keka-range-result').style.display = 'none';
            };
        }

        // Toggle Logic for Custom Date
        const toggleCustomBtn = document.getElementById('keka-toggle-custom');
        const customContainer = document.getElementById('keka-custom-container');

        if (toggleCustomBtn && customContainer) {
            toggleCustomBtn.onclick = (e) => {
                e.stopPropagation();
                const isHidden = customContainer.style.display === 'none';
                customContainer.style.display = isHidden ? 'block' : 'none';
            };
        }

        if (calcRangeBtn) {
            calcRangeBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent panel close
                const startVal = document.getElementById('keka-start-date').value;
                const endVal = document.getElementById('keka-end-date').value;
                const resultDiv = document.getElementById('keka-range-result');

                if (!startVal || !endVal) {
                    alert("Please select both start and end dates.");
                    return;
                }

                const startDate = new Date(startVal);
                const endDate = new Date(endVal);
                startDate.setHours(0, 0, 0, 0);
                endDate.setHours(23, 59, 59, 999);

                if (startDate > endDate) {
                    alert("Start date cannot be after end date.");
                    return;
                }

                try {
                    // Strategy 1: The standard rows we used before
                    let potentialRows = Array.from(document.querySelectorAll('employee-attendance-list-view .border-bottom'));

                    // Strategy 2: If none found, try a broader search for any list row
                    if (potentialRows.length === 0) {
                        potentialRows = Array.from(document.querySelectorAll('.list-view .list-row, .card-body .d-flex'));
                    }

                    if (potentialRows.length === 0) {
                        console.warn("Keka Helper: No rows found with standard selectors.");
                        alert("Could not find attendance rows in the current view. Please ensure the table is visible.");
                        return;
                    }

                    let rangeGross = 0;
                    let rangeEffective = 0;
                    let foundAny = false;
                    let foundDates = 0;
                    let targetGrossInRange = 0;
                    let targetEffectiveInRange = 0;

                    let currentYear = new Date().getFullYear();
                    // Try to scrape year from the page header (e.g. "January, 2026")
                    const pageText = document.body.innerText;
                    const yearMatch = pageText.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b/);
                    if (yearMatch) {
                        currentYear = parseInt(yearMatch[1], 10);
                        console.log("Keka Helper: Detected year from page:", currentYear);
                    }

                    potentialRows.forEach(row => {
                        const params = row.innerText;
                        if (!params) return;

                        // Flexible Regex: Matches "Thu, 01 Jan" or "Thu 01 Jan"
                        const dateMatch = params.match(/([A-Za-z]{3},?\s*\d{1,2}\s+[A-Za-z]{3})/);

                        if (dateMatch) {
                            foundDates++;
                            const dateStr = dateMatch[0]; // e.g. "Thu, 01 Jan"

                            // Parse Date
                            const cleanDateStr = dateStr.replace(/,/g, '').replace(/\s+/g, ' '); // "Thu 01 Jan"
                            const rowDate = new Date(`${cleanDateStr} ${currentYear}`);
                            rowDate.setHours(12, 0, 0, 0);

                            if (rowDate >= startDate && rowDate <= endDate) {
                                foundAny = true;

                                // Robust logic for Target Calculation (Sync with Daily Banner Logic)
                                const txtUpper = params.toUpperCase();

                                // 1. Check for Weekend
                                const day = rowDate.getDay();
                                const isWeekend = (day === 0 || day === 6);

                                // 2. Check for Off Days (Holiday, Weekly Off) - Zero Target
                                const offKeywords = ["HOLIDAY", "HLDY", "WEEKLY OFF", "WO", "FLOATING"];
                                const isOffDay = offKeywords.some(kw => txtUpper.includes(kw));

                                // 3. Check for Leaves (Casual, Sick, etc.) - Potential Half Day Target
                                const leaveKeywords = [
                                    "LEAVE", "LWP", "UA", "AB", "CASUAL", "SICK",
                                    "PRIVILEGE", "EARNED", "COMP OFF", "COMP-OFF",
                                    "MATERNITY", "PATERNITY", "BEREAVEMENT", "MARRIAGE", "UNPAID"
                                ];
                                const isLeave = leaveKeywords.some(kw => txtUpper.includes(kw));
                                const mentionsHalfDay = txtUpper.includes("HALF DAY");

                                // Extract hours
                                const timeMatches = params.match(/(\d+)h\s+(\d+)m/g);
                                let workedMinutes = 0;
                                if (timeMatches && timeMatches.length > 0) {
                                    const grossMatch = timeMatches.length >= 1 ? timeMatches[timeMatches.length - 1] : "0h 0m";
                                    const parts = grossMatch.match(/(\d+)h\s+(\d+)m/);
                                    if (parts) workedMinutes = (parseInt(parts[1]) * 60) + parseInt(parts[2]);
                                }
                                const hasHours = workedMinutes > 0;
                                const workedFullDay = workedMinutes > 300; // > 5 hours

                                // Calculate Target for this day
                                let dayGrossTarget = 0;
                                let dayEffectiveTarget = 0;

                                if (isWeekend || isOffDay) {
                                    // Weekend, Holiday, or Weekly Off -> Always 0 Target (Work is bonus)
                                    dayGrossTarget = 0;
                                    dayEffectiveTarget = 0;
                                } else if (isLeave) {
                                    // It is a specific Leave
                                    if (mentionsHalfDay || (hasHours && !workedFullDay)) {
                                        // Half Day Leave -> Target 4h (240m)
                                        dayGrossTarget = 240;
                                        dayEffectiveTarget = 240;
                                    } else {
                                        // Full Day Leave -> Target 0
                                        dayGrossTarget = 0;
                                        dayEffectiveTarget = 0;
                                    }
                                } else if (mentionsHalfDay) {
                                    // Ambiguous Half Day (e.g. WFH - Half Day)
                                    if (!workedFullDay) {
                                        // Worked < 6h -> Assume Half Day Leave -> Target 4h
                                        dayGrossTarget = 240;
                                        dayEffectiveTarget = 240;
                                    } else {
                                        // Worked > 6h -> Full Working Day -> Target 9h / 8h
                                        dayGrossTarget = 540;
                                        dayEffectiveTarget = 480;
                                    }
                                } else {
                                    // Regular Day
                                    if (hasHours) {
                                        dayGrossTarget = 540;
                                        dayEffectiveTarget = 480;
                                    } else {
                                        // Absent/LWP (No hours, no text) -> Safe to assume Target 0
                                        dayGrossTarget = 0;
                                        dayEffectiveTarget = 0;
                                    }
                                }

                                targetGrossInRange += dayGrossTarget;
                                targetEffectiveInRange += dayEffectiveTarget;

                                let gM = 0;
                                let eM = 0;

                                if (timeMatches && timeMatches.length > 0) {
                                    const grossStr = timeMatches[timeMatches.length - 1];
                                    gM = parseDuration(grossStr);

                                    if (timeMatches.length >= 2) {
                                        eM = parseDuration(timeMatches[0]);
                                    } else {
                                        eM = gM;
                                    }

                                    rangeGross += gM;
                                    rangeEffective += eM;
                                } else {
                                    // Holiday or absent - no hours to add
                                }
                            }
                        }
                    });

                    if (!foundAny) {
                        alert(`No matching dates found for range ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}.\n\nPlease ensure you are viewing the correct month/year in the Attendance Log.`);
                        resultDiv.style.display = 'none';
                    } else {
                        document.getElementById('range-gross-total').innerText = toHm(rangeGross);
                        document.getElementById('range-effective-total').innerText = toHm(rangeEffective);

                        // Gamification for Range - based on Effective Hours
                        const targetEffectiveRange = targetEffectiveInRange;

                        const isRangeAhead = (rangeEffective >= targetEffectiveRange);
                        const isRangeBehind = (rangeEffective < targetEffectiveRange);

                        if (isRangeAhead) {
                            console.log("Keka Helper: Range Target Met (Effective)! Confetti time.");
                            triggerConfetti();
                            playSuccessSound(); // Play cheer
                        } else if (isRangeBehind) {
                            console.log("Keka Helper: Range Target Missed (Effective). Sad Emoji time.");
                            triggerSadEmoji();
                            playFailureSound(); // Play sad sound
                        }

                        // Debug log removed to reduce popup height
                        resultDiv.style.display = 'block';
                    }
                } catch (err) {
                    alert("Error in calculation: " + err.message);
                    console.error(err);
                }
            };
        }

        // Attach refresh listener
        const refreshBtn = document.getElementById('keka-refresh-panel');
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                hasCalculated = false;
                calculate(true);
            };
        }
    }

    function getCacheKey() {
        const now = new Date();
        return `keka_stats_${now.getFullYear()}_${now.getMonth()}_${now.getDate()}`;
    }

    async function calculate(force = false) {
        if (hasCalculated && !force) return;

        // Only run on attendance log page
        if (!location.href.includes('/me/attendance/logs')) {
            console.log("Keka Helper: Not on attendance page, skipping.");
            return;
        }

        console.log("Keka Helper: Calculating... Force=" + force);

        // No caching - always calculate fresh from DOM for real-time accuracy

        const rows = document.querySelectorAll('employee-attendance-list-view .border-bottom.on-hover');
        if (rows.length === 0) {
            console.log("Keka Helper: No attendance rows found. Page may still be loading...");
            // Retry up to 3 times with increasing delays
            if (!calculate.retryCount) calculate.retryCount = 0;
            if (calculate.retryCount < 3) {
                calculate.retryCount++;
                const delay = calculate.retryCount * 1000; // 1s, 2s, 3s
                console.log(`Keka Helper: Retry ${calculate.retryCount}/3 in ${delay}ms...`);
                setTimeout(() => calculate(force), delay);
            } else {
                console.log("Keka Helper: Gave up finding attendance rows after 3 retries.");
                calculate.retryCount = 0;
            }
            return;
        }

        // Reset retry count on success
        calculate.retryCount = 0;

        // Variable declarations
        let totalGross = 0;      // Weekly accumulator (for catchup note)
        let totalEffective = 0;
        let todayGross = 0;      // Today only (for OUT time, Worked, Left)
        let todayEffective = 0;
        let todayRow = null;

        let targetGross = CONFIG.grossTarget * 60;
        let targetEffective = CONFIG.effectiveTarget * 60;

        const now = new Date();
        const monday = getMonday(now);
        const todayFn = new Date();
        todayFn.setHours(0, 0, 0, 0);

        // Smart Weekly Cache:
        // Previous days (Mon → yesterday) are finalized — cache them per week.
        // Today's row is always read fresh from the DOM.
        const mondayKey = `keka_week_${monday.getFullYear()}_${monday.getMonth()}_${monday.getDate()}`;
        let prevCache = null;
        if (!force) {
            try {
                const raw = localStorage.getItem(mondayKey);
                if (raw) prevCache = JSON.parse(raw);
            } catch (e) { prevCache = null; }
        } else {
            // Force refresh → clear weekly cache and reset animation flags
            localStorage.removeItem(mondayKey);
            window.kekaEmojiShown = false;
            window.kekaCheerPlayed = false;
            window.kekaSadPlayed = false;
        }

        if (prevCache) {
            // Restore previous day totals from cache
            totalGross = prevCache.totalGross;
            totalEffective = prevCache.totalEffective;
            targetGross -= prevCache.deductedGross;
            targetEffective -= prevCache.deductedEffective;
            console.log("Keka Helper: Using weekly cache for previous days.");

            // Find today's row directly from DOM (todayRow is null since we skipped the full loop)
            for (let row of rows) {
                const spans = Array.from(row.querySelectorAll('span'));
                const dateSpan = spans.find(s => /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2}$/.test(s.innerText.trim()));
                if (!dateSpan) continue;

                const rowDate = new Date(`${dateSpan.innerText.trim()} ${now.getFullYear()}`);
                rowDate.setHours(0, 0, 0, 0);

                if (rowDate.getTime() === todayFn.getTime()) {
                    todayRow = row;

                    // Also apply today's deductions to target
                    const txt = row.innerText.toUpperCase();
                    const offKeywords = ["HOLIDAY", "HLDY", "WEEKLY OFF", "WO", "FLOATING"];
                    const leaveKeywords = ["LEAVE", "LWP", "UA", "AB", "CASUAL", "SICK",
                        "PRIVILEGE", "EARNED", "COMP OFF", "COMP-OFF",
                        "MATERNITY", "PATERNITY", "BEREAVEMENT", "MARRIAGE", "UNPAID"];
                    const isOffDay = offKeywords.some(kw => txt.includes(kw));
                    const isLeave = leaveKeywords.some(kw => txt.includes(kw));
                    const mentionsHalfDay = txt.includes("HALF DAY");
                    const hoursMatch = txt.match(/(\d+)h\s+(\d+)m/);
                    let todayWorkedMin = 0;
                    if (hoursMatch) todayWorkedMin = (parseInt(hoursMatch[1]) * 60) + parseInt(hoursMatch[2]);
                    const hasWorkedHours = todayWorkedMin > 0;
                    const workedFullDay = todayWorkedMin > 300;

                    if (isOffDay) {
                        targetGross -= 540; targetEffective -= 480;
                    } else if (isLeave) {
                        if (mentionsHalfDay || (hasWorkedHours && !workedFullDay)) {
                            targetGross -= 300; targetEffective -= 240;
                        } else {
                            targetGross -= 540; targetEffective -= 480;
                        }
                    } else if (mentionsHalfDay && !workedFullDay) {
                        targetGross -= 300; targetEffective -= 240;
                    }

                    // Parse today's hours into today-only vars
                    const hourSpans = spans.filter(s => /(\d+)h\s+(\d+)m/.test(s.innerText));
                    if (hourSpans.length > 0) {
                        const grossSpan = hourSpans[hourSpans.length - 1];
                        todayGross = parseDuration(grossSpan.innerText);
                        if (hourSpans.length >= 2) {
                            todayEffective = parseDuration(hourSpans[0].innerText);
                        } else {
                            todayEffective = parseDuration(grossSpan.innerText);
                        }
                    }
                    totalGross += todayGross;
                    totalEffective += todayEffective;
                    break;
                }
            }
        } else {
            // Full loop — calculate all rows and cache previous days at end
            let deductedGross = 0;
            let deductedEffective = 0;

            for (let row of rows) {
                const spans = Array.from(row.querySelectorAll('span'));
                // Date Filter
                const dateSpan = spans.find(s => /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2}$/.test(s.innerText.trim()));
                if (!dateSpan) continue;

                const dateStr = dateSpan.innerText.trim();
                const rowDate = new Date(`${dateStr} ${now.getFullYear()}`);
                rowDate.setHours(0, 0, 0, 0);

                if (rowDate < monday) continue;

                // Deductions
                // ---------------------------------------------------------
                // ROBUST DEDUCTION LOGIC v2
                // ---------------------------------------------------------
                const txt = row.innerText.toUpperCase();
                console.log("Keka Helper Process Row:", { date: dateStr, text: txt });

                // 1. Check for Off Days (Holiday, Weekly Off) - Zero Target
                const offKeywords = ["HOLIDAY", "HLDY", "WEEKLY OFF", "WO", "FLOATING"];
                const isOffDay = offKeywords.some(kw => txt.includes(kw));

                // 2. Check for Leaves
                const leaveKeywords = [
                    "LEAVE", "LWP", "UA", "AB", "CASUAL", "SICK",
                    "PRIVILEGE", "EARNED", "COMP OFF", "COMP-OFF",
                    "MATERNITY", "PATERNITY", "BEREAVEMENT", "MARRIAGE", "UNPAID"
                ];
                const isLeave = leaveKeywords.some(kw => txt.includes(kw));

                // Check for explicit "Half Day" mention
                const mentionsHalfDay = txt.includes("HALF DAY");

                // Allow regex to find hours even if text is messy
                const hoursMatch = txt.match(/(\d+)h\s+(\d+)m/);
                let workedMinutes = 0;
                if (hoursMatch) {
                    workedMinutes = (parseInt(hoursMatch[1]) * 60) + parseInt(hoursMatch[2]);
                }
                const hasWorkedHours = workedMinutes > 0;
                const workedFullDay = workedMinutes > 300; // > 5 hours implies working day

                let deductGross = 0;
                let deductEffective = 0;

                if (isOffDay) {
                    // WO/Holiday -> Always 9h deduction (Target becomes 0)
                    console.log(`Keka Helper: Detected Off Day (WO/Holiday) for ${dateStr}`);
                    deductGross = 540; // 9h
                    deductEffective = 480; // 8h
                } else if (isLeave) {
                    // It IS a leave day. Now determine if Half or Full.
                    if (mentionsHalfDay || (hasWorkedHours && !workedFullDay)) {
                        // Half Day Leave -> Deduct 5h
                        console.log(`Keka Helper: Detected Half Day Leave for ${dateStr}`);
                        deductGross = 300; // 5h
                        deductEffective = 240; // 4h
                    } else {
                        // Full Day Leave -> Deduct 9h
                        console.log(`Keka Helper: Detected Full Day Leave for ${dateStr}`);
                        deductGross = 540; // 9h
                        deductEffective = 480; // 8h
                    }
                } else if (mentionsHalfDay) {
                    // "HALF DAY" mentioned but NO "LEAVE" word (e.g. "WFH - Half Day")
                    if (!workedFullDay) {
                        console.log(`Keka Helper: Ambiguous Half Day (low hours) -> Deducting for ${dateStr}`);
                        deductGross = 300; // 5h
                        deductEffective = 240; // 4h
                    } else {
                        console.log(`Keka Helper: Ambiguous Half Day (high hours) -> Treated as Full Work Day for ${dateStr}`);
                    }
                }

                targetGross -= deductGross;
                targetEffective -= deductEffective;
                deductedGross += deductGross;
                deductedEffective += deductEffective;

                if (rowDate.getTime() === todayFn.getTime()) {
                    todayRow = row;
                    continue;
                }

                // GET HOURS (previous days only)
                const hourSpans = spans.filter(s => /(\d+)h\s+(\d+)m/.test(s.innerText));
                if (hourSpans.length > 0) {
                    const grossSpan = hourSpans[hourSpans.length - 1];
                    totalGross += parseDuration(grossSpan.innerText);

                    if (hourSpans.length >= 2) {
                        const effSpan = hourSpans[0];
                        totalEffective += parseDuration(effSpan.innerText);
                    } else {
                        totalEffective += parseDuration(grossSpan.innerText);
                    }
                }
            }

            // Cache previous days' totals for future page loads
            try {
                localStorage.setItem(mondayKey, JSON.stringify({
                    totalGross,
                    totalEffective,
                    deductedGross,
                    deductedEffective
                }));
                console.log("Keka Helper: Weekly cache saved.");
            } catch (e) { console.warn("Keka Helper: Could not save weekly cache", e); }

            // Now parse today's row — stored separately for OUT time calculation
            if (todayRow) {
                const spans = Array.from(todayRow.querySelectorAll('span'));
                const hourSpans = spans.filter(s => /(\d+)h\s+(\d+)m/.test(s.innerText));
                if (hourSpans.length > 0) {
                    const grossSpan = hourSpans[hourSpans.length - 1];
                    todayGross = parseDuration(grossSpan.innerText);
                    if (hourSpans.length >= 2) {
                        todayEffective = parseDuration(hourSpans[0].innerText);
                    } else {
                        todayEffective = parseDuration(grossSpan.innerText);
                    }
                }
            }
            totalGross += todayGross;
            totalEffective += todayEffective;
        } // end else (full loop)

        if (targetGross < 0) targetGross = 0;
        if (targetEffective < 0) targetEffective = 0;

        // Today's remaining (for OUT time and Left display)
        const todayGrossTarget = targetGross - (totalGross - todayGross); // what today needs to contribute
        const remainGross = Math.max(0, 540 - todayGross);    // simple: 9h - today's gross
        const remainEffective = Math.max(0, 480 - todayEffective); // 8h - today's effective

        // Weekly remaining (for catching up note)
        const weeklyRemainGross = targetGross - totalGross;
        const weeklyRemainEffective = targetEffective - totalEffective;

        let loginTime = null;

        if (todayRow) {
            // Inject hidden style so the punch dropdown doesn't flash visually
            const hideDropStyle = document.createElement('style');
            hideDropStyle.textContent = '.dropdown-menu-logs { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }';
            document.head.appendChild(hideDropStyle);

            todayRow.click();

            for (let i = 0; i < 14; i++) {
                await new Promise(r => setTimeout(r, 250));
                const dropdown = document.querySelector('.dropdown-menu-logs');
                if (dropdown) {
                    const matches = dropdown.innerText.match(/(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)/g);
                    if (matches && matches.length > 0) {
                        const firstTime = matches[0];
                        if (!firstTime.startsWith("0:00") && !firstTime.startsWith("00:00")) {
                            loginTime = parseTime(firstTime);
                            if (loginTime) break;
                        }
                    }
                }
            }

            // Close dropdown and remove the hidden style
            todayRow.click();
            await new Promise(r => setTimeout(r, 150));
            hideDropStyle.remove();
        }

        if (loginTime) {
            const todayIndex = now.getDay();
            let daysPassed = 0;

            if (todayIndex >= 1 && todayIndex <= 5) {
                daysPassed = todayIndex - 1; // Mon=0, Tue=1, ...
            } else if (todayIndex === 6) {
                daysPassed = 5;
            }

            // CATCHUP: based on previous days ONLY (not today)
            const prevDaysGross = totalGross - todayGross;
            const prevDaysEffective = totalEffective - todayEffective;
            const expectedGrossPrev = daysPassed * 540;  // 9h per previous day
            const expectedEffPrev = daysPassed * 480;  // 8h per previous day

            // Positive = behind (need to catch up), Negative = ahead (can leave early)
            const catchupGross = expectedGrossPrev - prevDaysGross;
            const catchupEffective = expectedEffPrev - prevDaysEffective;

            // Today's FIXED personal target (set at login, doesn't change as you work)
            const todayGrossTarget = Math.max(0, 540 + catchupGross);
            const todayEffTarget = Math.max(0, 480 + catchupEffective);

            // OUT TIME: fixed once at login
            const outTimeGross = new Date(loginTime.getTime() + todayGrossTarget * 60000);
            const outTimeEffective = new Date(loginTime.getTime() + todayEffTarget * 60000);

            // LEFT: live (today's worked vs today's personal target)
            const leftGross = Math.max(0, todayGrossTarget - todayGross);
            const leftEffective = Math.max(0, todayEffTarget - todayEffective);

            let logoffGrossStr = "Wait...";
            if (todayGrossTarget === 0 || todayGross >= todayGrossTarget) {
                logoffGrossStr = "GOAL MET! 🎉";
            } else {
                logoffGrossStr = formatTime(outTimeGross);
            }

            let logoffEffectiveStr = "Wait...";
            if (todayEffTarget === 0 || todayEffective >= todayEffTarget) {
                logoffEffectiveStr = "GOAL MET! 🎉";
                if (!window.kekaCheerPlayed) {
                    playSuccessSound();
                    window.kekaCheerPlayed = true;
                }
            } else if (todayIndex === 0 || todayIndex === 6) {
                logoffEffectiveStr = "Week Over 😭";
                if (!window.kekaSadPlayed) {
                    playFailureSound();
                    window.kekaSadPlayed = true;
                }
            } else {
                logoffEffectiveStr = formatTime(outTimeEffective);
            }

            // Note: show if catching up or ahead vs weekly target
            let avgNote = "";
            if (catchupGross > 0 || catchupEffective > 0) {
                avgNote = `<span style="font-size:10px; opacity:0.7; font-weight:400; margin-left:4px;">(Catching up)</span>`;
            } else if (catchupGross < -60 || catchupEffective < -60) {
                avgNote = `<span style="font-size:10px; opacity:0.7; font-weight:400; margin-left:4px;">(Ahead 🎯)</span>`;
            }

            const dataToCache = {
                grossLogoff: logoffGrossStr,
                effectiveLogoff: logoffEffectiveStr,
                grossLeft: toHm(leftGross),
                effectiveLeft: toHm(leftEffective),
                grossWorked: toHm(todayGross),
                effectiveWorked: toHm(todayEffective),
                avgNote: avgNote
            };



            // Visual Feedback / Gamification - based on weekly Effective Hours
            const isAhead = weeklyRemainEffective <= 0;
            const isBehind = weeklyRemainEffective > 0;

            if (!window.kekaEmojiShown) {
                window.kekaEmojiShown = true;
                if (isAhead) {
                    console.log("Keka Helper: Ahead on Effective! Confetti.");
                    triggerConfetti();
                } else if (isBehind) {
                    console.log("Keka Helper: Behind on Effective. Sad Emoji.");
                    triggerSadEmoji();
                }
            }

            createBanner(
                dataToCache.grossLogoff,
                dataToCache.effectiveLogoff,
                dataToCache.grossLeft,
                dataToCache.effectiveLeft,
                dataToCache.grossWorked,
                dataToCache.effectiveWorked,
                dataToCache.avgNote
            );

        } else {
            console.log("Keka Helper: Could not find login time, will retry if DOM updates...");
        }
    }

    // --- VISUAL EFFECTS ---

    function triggerSadEmoji() {
        const existing = document.getElementById('keka-sad-overlay');
        if (existing) return;

        const overlay = document.createElement('div');
        overlay.id = 'keka-sad-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 10000; display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.5s;';
        overlay.innerHTML = `<div style="font-size: 150px; filter: drop-shadow(0 0 20px rgba(0,0,0,0.5));">😢</div>`;

        document.body.appendChild(overlay);

        // Fade in
        requestAnimationFrame(() => overlay.style.opacity = '1');

        // Fade out after 2.5s
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 500);
        }, 2000);
    }

    function triggerConfetti() {
        // Simple Canvas Confetti implementation
        const canvasId = 'keka-confetti-canvas';
        if (document.getElementById(canvasId)) return;

        const canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 10000;';
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const particleCount = 150;
        const gravity = 0.5;
        const colors = ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                vx: Math.random() * 6 - 3,
                vy: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 8 + 4,
                rotation: Math.random() * 360,
                rotationSpeed: Math.random() * 10 - 5
            });
        }

        let animationFrame;

        function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let activeParticles = 0;

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.1; // gravity
                p.rotation += p.rotationSpeed;

                if (p.y < canvas.height) {
                    activeParticles++;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rotation * Math.PI) / 180);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                    ctx.restore();
                }
            });

            if (activeParticles > 0) {
                animationFrame = requestAnimationFrame(render);
            } else {
                canvas.remove();
            }
        }

        render();

        // Cleanup after 4s just in case
        setTimeout(() => {
            if (document.getElementById(canvasId)) {
                cancelAnimationFrame(animationFrame);
                document.getElementById(canvasId).remove();
            }
        }, 5000);
    }

    console.log("Keka Helper: Script loaded. Waiting for DOM...");

    function startObserver() {
        if (!document.body) {
            setTimeout(startObserver, 500);
            return;
        }

        console.log("Keka Helper: Body ready. Starting observer...");

        let currentUrl = location.href;

        if (observer) observer.disconnect();

        observer = new MutationObserver((mutations) => {
            if (location.href !== currentUrl) {
                console.log("Keka Helper: URL Changed to " + location.href);
                currentUrl = location.href;
                hasCalculated = false;
                setTimeout(calculate, 1500);
            }

            if (location.href.includes('/me/attendance/logs')) {
                const icon = document.getElementById('keka-helper-icon');
                if (!icon) {
                    console.log("Keka Helper: Icon missing, reinjecting...");
                    hasCalculated = false;
                    calculate();
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        calculate();
    }

    try {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", startObserver);
        } else {
            startObserver();
        }
    } catch (e) {
        console.error("Keka Helper: Critical Error during initialization:", e);
    }

})();
