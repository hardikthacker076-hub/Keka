/* Keka Calculator (API v3) */

(function () {
    'use strict';
    console.log("Keka Helper (V3): Starting content script...");

    const CONFIG = {
        version: "2.24"
    };

    let hasCalculated = false;
    let observer = null;

    function getMonday(d) {
        d = new Date(d);
        var day = d.getDay(),
            diff = d.getDate() - day + (day == 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Web Audio API Helpers — only create AudioContext after user gesture (autoplay policy)
    let _audioCtx = null;
    let _audioUnlocked = false;

    // Unlock AudioContext on first user click anywhere on the page
    document.addEventListener('click', function unlockAudio() {
        if (_audioUnlocked) return;
        _audioUnlocked = true;
        if (_audioCtx && _audioCtx.state === 'suspended') {
            _audioCtx.resume().catch(() => { });
        }
        document.removeEventListener('click', unlockAudio);
    }, true);

    function getAudioCtx() {
        if (!_audioUnlocked) return null;  // not yet unlocked by user gesture
        if (!_audioCtx) {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return _audioCtx;
    }

    function playSuccessSound() {
        const audioCtx = getAudioCtx();
        if (!audioCtx) return;  // silently skip if not unlocked

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


    function createBanner(grossLogoff, effectiveLogoff, grossLeft, effectiveLeft, grossWorked, effectiveWorked, avgNote, breakMins) {
        ensureIconInDom(grossLogoff, effectiveLogoff, grossLeft, effectiveLeft, grossWorked, effectiveWorked, avgNote, breakMins);
    }

    // Polls for the "24 hour format" label and places the icon next to it.
    // Falls back to fixed position ONLY after 10 seconds of waiting.
    let _iconPlacementTimer = null;
    let _iconPlacementAttempts = 0;
    let _pendingBannerArgs = null;

    function ensureIconInDom(...args) {
        _pendingBannerArgs = args;
        if (!document.getElementById('keka-helper-icon')) {
            _iconPlacementAttempts = 0;
            _tryPlaceIcon();
        } else {
            // Icon already exists — rebuild in place (preserves the current container)
            const existing = document.getElementById('keka-helper-icon');
            const container = existing ? existing.parentElement : document.body;
            _buildIconAndPanel(container, ...args);
        }
    }

    function _tryPlaceIcon() {
        _iconPlacementAttempts++;

        // Search for the 24-hour format label
        let actionsSection = null;
        const label = Array.from(document.querySelectorAll('label')).find(el => el.textContent.includes('24 hour format'));
        if (label) {
            actionsSection = label.closest('div[class]') || label.parentElement;
        }

        // Fallback: any toggle label
        if (!actionsSection) {
            const tog = Array.from(document.querySelectorAll('label')).find(el => el.querySelector('input[type="checkbox"]'));
            if (tog) actionsSection = tog.closest('div[class]') || tog.parentElement;
        }

        if (actionsSection) {
            // Found — build the icon in place
            _buildIconAndPanel(actionsSection, ...(_pendingBannerArgs || []));
            return;
        }

        // Not found yet — retry up to 10 s (every 200 ms)
        if (_iconPlacementAttempts < 50) {
            _iconPlacementTimer = setTimeout(_tryPlaceIcon, 200);
        } else {
            // Final fallback: fixed position
            let fixedContainer = document.getElementById('keka-fixed-container');
            if (!fixedContainer) {
                fixedContainer = document.createElement('div');
                fixedContainer.id = 'keka-fixed-container';
                fixedContainer.style.cssText = 'position:fixed;top:70px;right:20px;z-index:9999;display:flex;align-items:center;';
                document.body.appendChild(fixedContainer);
            }
            _buildIconAndPanel(fixedContainer, ...(_pendingBannerArgs || []));
        }
    }

    function _buildIconAndPanel(actionsSection, grossLogoff, effectiveLogoff, grossLeft, effectiveLeft, grossWorked, effectiveWorked, avgNote, breakMins) {
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

        // Always remove and re-inject styles so extension updates apply immediately
        const oldStyle = document.getElementById('keka-helper-styles');
        if (oldStyle) oldStyle.remove();
        if (true) {
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
                .keka-input::-webkit-calendar-picker-indicator {
                    filter: invert(1) brightness(2);
                    opacity: 1;
                    cursor: pointer;
                    padding: 2px;
                    transform: scale(1.1);
                }
                .keka-input::-webkit-calendar-picker-indicator:hover {
                    filter: invert(1) brightness(3);
                    transform: scale(1.3);
                }
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

                <!-- Break Time Display -->
                <div style="text-align: center; margin-top: 10px; margin-bottom: 12px;">
                    <span style="font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Break Taken: </span>
                    <span id="keka-break-val" style="font-size: 12px; color: #ffeaa7; font-weight: 700;">${breakMins || '--:--'}</span>
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

                <!-- Footer Settings Area -->
                <div style="margin-top: 15px;">
                    <button id="keka-refresh-panel" class="keka-btn keka-btn-secondary" style="margin-bottom: 12px;">
                        ↻ Refresh Today's Data
                    </button>
                    
                    <div style="font-size: 11px; color: rgba(255,255,255,0.4); text-align: center;">
                        <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px;">
                            <span style="font-weight: 500; color: rgba(255,255,255,0.7);">Desktop Notifications</span>
                            <div style="flex-grow: 1; margin: 0 8px; text-align: left;">
                                <span id="keka-notify-timer" style="font-size: 10px; color: #f1c40f; display: block; height: 12px; font-variant-numeric: tabular-nums;">--:--</span>
                            </div>
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <button id="keka-test-notify" class="keka-btn" style="width: auto !important; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 2px 6px; font-size: 10px; text-transform: none; letter-spacing: 0; margin: 0;">Test</button>
                                <select id="keka-notify-select" style="background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 5px; font-size: 11px; cursor: pointer; outline: none;">
                                    <option value="0" style="background: #1e2532;">Off</option>
                                    <option value="30" style="background: #1e2532;">Every 30m</option>
                                    <option value="60" style="background: #1e2532;">Every 60m</option>
                                    <option value="120" style="background: #1e2532;">Every 2h</option>
                                    <option value="240" style="background: #1e2532;">Every 4h</option>
                                </select>
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px;">
                            <span style="font-weight: 500; color: rgba(255,255,255,0.7);">Grace Period (14 min)</span>
                            <input type="checkbox" id="keka-grace-checkbox" style="cursor: pointer; width: 16px; height: 16px; appearance: auto !important; opacity: 1 !important; display: inline-block !important; position: static !important; margin: 0 !important; visibility: visible !important;">
                        </div>
                        v${CONFIG.version} | API Mode
                    </div>
                </div>
            </div><!-- end keka-panel-body -->
        `;

        // Append icon to actions section
        actionsSection.appendChild(iconButton);
        iconButton.appendChild(panel);

        // --- NEW: Notification & Grace Settings Logic ---
        const notifySelect = document.getElementById('keka-notify-select');
        const graceCheckbox = document.getElementById('keka-grace-checkbox');
        const timerSpan = document.getElementById('keka-notify-timer');
        let timerInterval = null;

        const updateTimerDisplay = () => {
            try {
                if (!chrome.runtime || !chrome.runtime.id) {
                    if (timerInterval) clearInterval(timerInterval);
                    timerSpan.innerText = "";
                    return;
                }
                chrome.runtime.sendMessage({ action: 'GET_ALARM_TIME' }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.time) {
                        timerSpan.innerText = "";
                    } else {
                        const msLeft = response.time - Date.now();
                        if (msLeft > 0) {
                            const mins = Math.floor(msLeft / 60000);
                            const secs = Math.floor((msLeft % 60000) / 1000);
                            timerSpan.innerText = `Next in: ${mins}m ${secs.toString().padStart(2, '0')}s`;
                        } else {
                            timerSpan.innerText = "Syncing...";
                        }
                    }
                });
            } catch (e) {
                if (timerInterval) clearInterval(timerInterval);
                timerSpan.innerText = "";
                console.log("Keka Helper: Extension context invalidated. Polling stopped.");
            }
        };

        // Initialize Settings (Notification & Grace)
        try {
            chrome.storage.local.get(['kekaNotifyInterval', 'kekaNotifyEnabled', 'kekaGraceEnabled'], (data) => {
                if (chrome.runtime.lastError) return;

                // Load Notification
                if (notifySelect) {
                    if (data.kekaNotifyEnabled === false || data.kekaNotifyInterval === 0) {
                        notifySelect.value = "0";
                    } else {
                        notifySelect.value = data.kekaNotifyInterval === 60 ? "60" : "30";
                        updateTimerDisplay();
                        timerInterval = setInterval(updateTimerDisplay, 1000);
                    }
                }

                // Load Grace
                if (graceCheckbox) {
                    graceCheckbox.checked = data.kekaGraceEnabled === true;
                }
            });
        } catch (e) {
            console.log("Keka Helper: Context invalidated during storage read.");
        }

        // Notification change
        if (notifySelect) {
            notifySelect.addEventListener('change', (e) => {
                const val = parseInt(e.target.value);
                if (timerInterval) clearInterval(timerInterval);
                if (val === 0) {
                    chrome.storage.local.set({ kekaNotifyEnabled: false, kekaNotifyInterval: 0 });
                    timerSpan.innerText = "";
                } else {
                    chrome.storage.local.set({ kekaNotifyEnabled: true, kekaNotifyInterval: val });
                    timerSpan.innerText = "Syncing...";
                    setTimeout(() => {
                        updateTimerDisplay();
                        timerInterval = setInterval(updateTimerDisplay, 1000);
                    }, 500);
                }
            });
        }

        // Test Notification Button
        const testNotifyBtn = document.getElementById('keka-test-notify');
        if (testNotifyBtn) {
            testNotifyBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Visual feedback
                const origText = testNotifyBtn.innerText;
                testNotifyBtn.innerText = 'Sent!';
                testNotifyBtn.style.opacity = '0.7';

                chrome.runtime.sendMessage({ action: 'TEST_NOTIFICATION' }, (res) => {
                    setTimeout(() => {
                        testNotifyBtn.innerText = origText;
                        testNotifyBtn.style.opacity = '1';
                    }, 1500);
                });
            });
        }

        // Grace Period change
        if (graceCheckbox) {
            graceCheckbox.addEventListener('click', (e) => {
                // Prevent the click from bubbling up and closing the panel
                e.stopPropagation();
            });
            graceCheckbox.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                chrome.storage.local.set({ kekaGraceEnabled: enabled }, () => {
                    // Trigger immediate refresh of today's data without closing panel
                    chrome.runtime.sendMessage({ action: 'REFRESH_DATA' }, (response) => {
                        if (response && response.success && response.stats) {
                            _updatePanelData(response.stats);
                        }
                    });
                });
            });
        }

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

        // Outside-click handler: remove old one, add fresh one WITH target check
        if (window._kekaOutsideClickHandler) {
            document.removeEventListener('click', window._kekaOutsideClickHandler);
        }
        window._kekaOutsideClickHandler = (e) => {
            const p = document.getElementById('keka-helper-panel');
            const btn = document.getElementById('keka-helper-icon');
            if (!p || p.style.display !== 'block') return;
            // Don't close if click was on the icon (let onclick toggle it) or inside the panel
            if (btn && btn.contains(e.target)) return;
            if (p && p.contains(e.target)) return;
            // Don't close if a date picker inside the panel is actively focused
            // (native date picker UI fires document clicks that don't have panel targets)
            const active = document.activeElement;
            if (active && active.type === 'date' && p.contains(active)) return;
            p.style.display = 'none';
        };
        document.addEventListener('click', window._kekaOutsideClickHandler);

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
                e.stopPropagation();
                handleRangeCalc();
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

    function toHm(m) {
        if (typeof m === 'string') return m;
        const mins = Math.round(m * 60);
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }

    function _updatePanelData(s) {
        const extractTime = (msg) => msg.includes('Logoff') ? msg.replace('Logoff at ', '') : msg;
        const grossLogoff = extractTime(s.grossStatusMessage || s.statusMessage);
        const effectiveLogoff = extractTime(s.statusMessage);
        const avgNote = s.catchupNote || (s.isClockedIn ? 'Live ⏱' : '');

        const panel = document.getElementById('keka-helper-panel');
        if (!panel) return; // Panel not built yet

        // Update the cards directly
        const grossGroup = panel.querySelector('.keka-card-gross');
        if (grossGroup) {
            grossGroup.querySelector('.keka-card-outtime').textContent = grossLogoff;
            const vals = grossGroup.querySelectorAll('.keka-card-meta-val');
            if (vals.length >= 2) {
                vals[0].textContent = toHm(s.grossWorked);
                vals[1].textContent = toHm(s.grossLeft);
            }
        }

        const effGroup = panel.querySelector('.keka-card-effective');
        if (effGroup) {
            effGroup.querySelector('.keka-card-outtime').textContent = effectiveLogoff;
            const vals = effGroup.querySelectorAll('.keka-card-meta-val');
            if (vals.length >= 2) {
                vals[0].textContent = toHm(s.effectiveWorked);
                vals[1].textContent = toHm(s.effectiveLeft);
            }
        }

        // Update break time
        const breakVal = panel.querySelector('#keka-break-val');
        if (breakVal && s.breakMins !== undefined) {
            breakVal.textContent = toHm(s.breakMins);
        }

        // Update avg note if present in header
        const headerNote = panel.querySelector('.keka-panel-header span:nth-child(2)');
        if (headerNote) {
            headerNote.textContent = avgNote;
        } else if (avgNote) {
            const header = panel.querySelector('.keka-panel-header');
            if (header) {
                const span = document.createElement('span');
                span.style.cssText = "font-size:11px; color:rgba(255,200,80,0.75); font-weight:500;";
                span.textContent = avgNote;
                header.appendChild(span);
            }
        }
    }

    async function calculate(force = false) {
        if (hasCalculated && !force) return;
        if (!location.href.includes('/me/attendance/logs')) return;

        console.log('Keka Helper (V3): Starting calculation...');

        // Guard against extension context invalidation
        try {
            if (!chrome.runtime || !chrome.runtime.id) {
                console.warn('Keka Helper: Extension context invalidated. Requires page reload.');
                return;
            }
        } catch (e) {
            console.warn('Keka Helper: Extension context invalidated. Requires page reload.', e);
            return;
        }

        // If panel doesn't exist at all yet, build it once
        const iconExists = !!document.getElementById('keka-helper-icon');
        if (!iconExists) {
            createBanner('--:--', '--:--', '--:--', '--:--', '--:--', '--:--', 'Loading...', '--:--');
        }

        const action = force ? 'REFRESH_DATA' : 'GET_TODAY_STATS';

        try {
            chrome.runtime.sendMessage({ action }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    const errStr = (chrome.runtime.lastError?.message || response?.error || 'Unknown Error').toString();
                    console.log('Keka Helper: Update skipped (handled):', errStr);

                    const isAuthError = errStr.includes('401');
                    const isFetchError = errStr.includes('Failed to fetch');

                    let displayErr = 'API Error';
                    let detailErr = 'Check console';

                    if (isAuthError) {
                        displayErr = 'Login Expired';
                        detailErr = 'Please refresh this page';
                    } else if (isFetchError) {
                        displayErr = 'Network Error';
                        detailErr = 'Check connection';
                    }

                    if (!iconExists) {
                        createBanner(displayErr, displayErr, '--:--', '--:--', '--:--', '--:--', detailErr, '--:--');
                    } else {
                        _updatePanelData({
                            grossStatusMessage: displayErr,
                            statusMessage: displayErr,
                            grossLeft: '--:--',
                            effectiveLeft: '--:--',
                            grossWorked: '--:--',
                            effectiveWorked: '--:--',
                            catchupNote: detailErr,
                            breakMins: '--:--'
                        });
                    }
                    return;
                }

                const s = response.stats;

                if (!iconExists) {
                    // First build
                    const extractTime = (msg) => msg.includes('Logoff') ? msg.replace('Logoff at ', '') : msg;
                    createBanner(
                        extractTime(s.grossStatusMessage || s.statusMessage),
                        extractTime(s.statusMessage),
                        toHm(s.grossLeft),
                        toHm(s.effectiveLeft),
                        toHm(s.grossWorked),
                        toHm(s.effectiveWorked),
                        s.catchupNote || (s.isClockedIn ? 'Live ⏱' : ''),
                        toHm(s.breakMins)
                    );
                } else {
                    // In-place update
                    _updatePanelData(s);
                }

                if (s.statusMessage.includes('GOAL MET')) {
                    if (!window.kekaCheerPlayed) {
                        playSuccessSound();
                        triggerConfetti();
                        window.kekaCheerPlayed = true;
                    }
                } else {
                    window.kekaCheerPlayed = false;
                }

                if (s.catchupNote && s.catchupNote.includes('😟')) {
                    if (!window.kekaSadPlayed) {
                        playFailureSound();
                        triggerSadEmoji();
                        window.kekaSadPlayed = true;
                    }
                } else {
                    window.kekaSadPlayed = false;
                }

                hasCalculated = true;
            });
        } catch (e) {
            console.warn('Keka Helper: Extension context invalidated during fetch.', e);
        }
    }

    // Simplified Range Calculation Handler for the UI
    function handleRangeCalc() {
        const start = document.getElementById('keka-start-date').value;
        const end = document.getElementById('keka-end-date').value;
        const resultDiv = document.getElementById('keka-range-result');

        if (!start || !end) return alert('Select dates');

        resultDiv.style.display = 'block';
        const grossEl = document.getElementById('range-gross-total');
        const effEl = document.getElementById('range-effective-total');
        grossEl.innerText = 'Calculating...';
        effEl.innerText = 'Calculating...';

        // Guard: bail early if extension context is gone
        try { if (!chrome.runtime || !chrome.runtime.id) throw new Error(); } catch (e) {
            grossEl.innerText = 'Reload page'; effEl.innerText = 'Reload page'; return;
        }

        // Timeout so it never stays stuck forever
        const timeout = setTimeout(() => {
            if (grossEl.innerText === 'Calculating...') {
                grossEl.innerText = 'Timed out — reload page';
                effEl.innerText = 'Timed out — reload page';
            }
        }, 30000);

        try {
            chrome.runtime.sendMessage({ action: 'GET_RANGE_STATS', startDate: start, endDate: end }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    console.log('Keka Range result (handled):', chrome.runtime.lastError.message);
                    grossEl.innerText = 'Error — reload page';
                    effEl.innerText = 'Error — reload page';
                    return;
                }
                if (response && response.success) {
                    grossEl.innerText = toHm(response.stats.totalGross);
                    effEl.innerText = toHm(response.stats.totalEffective);
                    if (response.stats.totalEffective > 0) {
                        // Confirmation only, celebration removed to avoid confusion
                    }
                } else {
                    const err = response?.error || 'Unknown error';
                    grossEl.innerText = `Error: ${err}`;
                    effEl.innerText = `Error: ${err}`;
                    console.log('Keka Range failed:', err);
                }
            });
        } catch (e) {
            clearTimeout(timeout);
            grossEl.innerText = 'Reload extension';
            effEl.innerText = 'Reload extension';
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

        // Auto-refresh every 60 seconds to keep live "Left" and "OUT" times accurate
        const refreshInterval = setInterval(() => {
            if (location.href.includes('/me/attendance/logs')) {
                try {
                    if (!chrome.runtime || !chrome.runtime.id) {
                        clearInterval(refreshInterval);
                        return;
                    }
                    console.log("Keka Helper: Auto-refreshing calculation...");
                    calculate(true);
                } catch (e) {
                    clearInterval(refreshInterval);
                }
            }
        }, 60000);
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
