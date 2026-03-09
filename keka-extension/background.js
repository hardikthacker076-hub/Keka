let kekaAuthToken = null;
const attendanceCache = new Map();

// Initialize token from storage
chrome.storage.local.get(['kekaAuthToken'], (result) => {
    if (result.kekaAuthToken) kekaAuthToken = result.kekaAuthToken;
});

// Intercept Auth Token
chrome.webRequest.onSendHeaders.addListener(
    function (details) {
        for (let header of details.requestHeaders) {
            if (header.name.toLowerCase() === 'authorization') {
                if (header.value !== kekaAuthToken) {
                    kekaAuthToken = header.value;
                    chrome.storage.local.set({ kekaAuthToken: header.value });
                    console.log("Keka Helper (V3): Intercepted new Auth Token!");
                    // Clear cache on token change just in case
                    attendanceCache.clear();
                }
                break;
            }
        }
    },
    { urls: ["https://*.keka.com/*"] },
    ["requestHeaders"]
);

// --- ALARM LOGIC ---
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['kekaNotifyInterval', 'kekaNotifyEnabled'], (data) => {
        if (data.kekaNotifyEnabled === undefined) chrome.storage.local.set({ kekaNotifyEnabled: true });
        const interval = data.kekaNotifyInterval || 30;
        setupAlarm(data.kekaNotifyEnabled !== false ? interval : 0);
    });
});

function setupAlarm(minutes) {
    chrome.alarms.clear('kekaNotifier', () => {
        if (minutes > 0) {
            chrome.alarms.create('kekaNotifier', { periodInMinutes: parseInt(minutes) });
            console.log(`Keka Helper: Alarm set for every ${minutes} minutes.`);
        }
    });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.kekaNotifyInterval || changes.kekaNotifyEnabled)) {
        chrome.storage.local.get(['kekaNotifyInterval', 'kekaNotifyEnabled'], (data) => {
            setupAlarm(data.kekaNotifyEnabled && data.kekaNotifyInterval ? data.kekaNotifyInterval : 0);
        });
    }
});

// Keka API returns ALL attendance data regardless of month/year params.
// So we just fetch once and cache the entire dataset.
let allAttendanceCache = null;
let allAttendanceCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllAttendance(forceRefresh = false) {
    if (!kekaAuthToken) throw new Error('No Auth Token — visit Keka to capture it');

    const now = Date.now();
    if (!forceRefresh && allAttendanceCache && (now - allAttendanceCacheTime) < CACHE_TTL_MS) {
        return allAttendanceCache;
    }

    // Month/year params are ignored by Keka; we just need a valid request
    const d = new Date();
    const url = `https://marutitech.keka.com/k/attendance/api/mytime/attendance/summary?month=${d.getMonth() + 1}&year=${d.getFullYear()}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': kekaAuthToken, 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const json = await response.json();
        allAttendanceCache = json;
        allAttendanceCacheTime = now;
        console.log(`Keka Helper: Fetched ${json.data?.length || 0} attendance records`);
        return json;
    } catch (e) {
        console.log('Keka Helper: Fetch suppressed (likely network or auth issue):', e.message);
        return { success: false, error: e.message };
    }
}

// Helper: returns "YYYY-MM-DD" in LOCAL timezone (avoids UTC shift for IST users)
function toLocalDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper to get Monday of the current week
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getLiveStatus(day) {
    const now = new Date();
    let isClockedIn = false;
    let lastInTime = null;
    if (day.lastLogOfTheDay) {
        const lastLog = new Date(day.lastLogOfTheDay);
        const lastOutRaw = day.lastOutOfTheDay;
        const lastOut = lastOutRaw ? new Date(lastOutRaw) : null;
        const isMissing = !lastOut || isNaN(lastOut.getTime())
            || lastOut.getFullYear() < 2000
            || lastLog.getTime() > lastOut.getTime();
        if (isMissing) {
            isClockedIn = true;
            lastInTime = lastLog;
        }
    }
    const liveMinutes = isClockedIn ? Math.max(0, Math.floor((now - lastInTime) / 60000)) : 0;
    return { isClockedIn, liveMinutes };
}

function calculateTodayStats(allData, graceEnabled = false) {
    const now = new Date();
    const todayStr = toLocalDateStr(now);
    const mondayStr = toLocalDateStr(getMonday(now));

    let weeklyEffective = 0;
    let todayEffective = 0;
    let todayGross = 0;
    let expectedEffPrev = 0;  // expected effective for past days
    let expectedGrossPrev = 0; // expected gross for past days (9h per working day)
    let prevGrossWorked = 0;  // actual gross worked on past days
    let isOffDayToday = false;
    let isClockedIn = false;
    let liveMinutes = 0;

    if (!allData || !allData.data) return null;

    for (const day of allData.data) {
        const dStr = (day.attendanceDate || '').slice(0, 10);
        if (dStr < mondayStr) continue;

        const isOffDay = day.dayType === 1 || day.dayType === 2;
        const isLeave = (day.leaveDetails && day.leaveDetails.length > 0)
            || (day.leaveDayStatuses && day.leaveDayStatuses.length > 0);
        const effMins = Math.round((day.totalEffectiveHours || 0) * 60);
        const grossMins = Math.round((day.totalGrossHours || 0) * 60);

        if (dStr === todayStr) {
            todayGross = grossMins;
            isOffDayToday = isOffDay || isLeave;

            const liveStatus = getLiveStatus(day);
            isClockedIn = liveStatus.isClockedIn;
            liveMinutes = liveStatus.liveMinutes;

            todayEffective = effMins > 0 ? effMins : (isClockedIn ? grossMins : 0);
            weeklyEffective += todayEffective;
            console.log(`Keka Today: ${dStr} gross=${grossMins}m eff=${effMins}m clockedIn=${isClockedIn}`);

        } else if (dStr < todayStr) {
            // Past days this week
            const pastEff = effMins > 0 ? effMins : grossMins;
            weeklyEffective += pastEff;

            if (!isOffDay && !isLeave) {
                expectedEffPrev += 480;           // 8h effective expected
                expectedGrossPrev += 540;           // 9h gross expected
                prevGrossWorked += grossMins;     // actual gross worked
            } else if (isLeave && day.attendanceDayStatus === 2) {
                expectedEffPrev += 240;           // half-day leave
                expectedGrossPrev += 270;           // half-day gross expected
                prevGrossWorked += grossMins;
            }
        }
    }

    // Effective catchup
    const prevEffWorked = weeklyEffective - todayEffective;
    let effCatchup = expectedEffPrev - prevEffWorked;   // negative = ahead

    // Apply 14 min grace if enabled (weekly)
    if (graceEnabled) {
        effCatchup -= 14;
    }

    const todayTarget = Math.max(0, 480 + effCatchup);

    // Gross catchup (independent from effective)
    const grossCatchup = expectedGrossPrev - prevGrossWorked; // negative = ahead on gross
    const grossTarget = Math.max(0, 540 + grossCatchup);    // today's gross target (can be 0 if very far ahead)

    const todayWorked = todayEffective + liveMinutes;
    const needed = Math.max(0, todayTarget - todayWorked);
    const grossNeeded = Math.max(0, grossTarget - todayGross - liveMinutes);

    console.log(`Keka: effCatchup=${effCatchup}m grossCatchup=${grossCatchup}m | eff target=${todayTarget}m needed=${needed}m | gross target=${grossTarget}m needed=${grossNeeded}m`);

    // Effective status message
    if (isOffDayToday && todayWorked === 0 && !isClockedIn) {
        statusMessage = 'On Leave / Day Off! 🎉';
    } else if (todayWorked === 0 && !isClockedIn) {
        statusMessage = 'Yet to Start ⏳';
    } else if (needed <= 0) {
        statusMessage = 'GOAL MET! 🎉';
    } else {
        const logoff = new Date(now.getTime() + needed * 60000);
        statusMessage = `Logoff at ${logoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Gross status message (separate, catchup-adjusted)
    let grossStatusMessage;
    if (isOffDayToday && todayGross === 0 && !isClockedIn) {
        grossStatusMessage = 'On Leave / Day Off! 🎉';
    } else if (todayGross === 0 && liveMinutes === 0 && !isClockedIn) {
        grossStatusMessage = 'Yet to Start ⏳';
    } else if (grossNeeded <= 0) {
        grossStatusMessage = 'GOAL MET! 🎉';
    } else {
        const gLogoff = new Date(now.getTime() + grossNeeded * 60000);
        grossStatusMessage = `Logoff at ${gLogoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    const catchupNote = effCatchup > 60 ? 'Catching up' : effCatchup < -60 ? 'Ahead 🎯' : isClockedIn ? 'Live ⏱' : '';

    // Final overrides for "Left" time when strictly off
    const finalEffectiveLeft = (isOffDayToday && todayWorked === 0 && !isClockedIn) ? 0 : (needed / 60);
    const finalGrossLeft = (isOffDayToday && todayGross === 0 && !isClockedIn) ? 0 : (grossNeeded / 60);

    // Calculate Break Time (Gross - Effective)
    const breakMins = Math.max(0, (todayGross + liveMinutes) - todayWorked);

    return {
        grossWorked: (todayGross + liveMinutes) / 60,
        effectiveWorked: todayWorked / 60,
        breakMins: breakMins / 60,
        grossLeft: finalGrossLeft,
        effectiveLeft: finalEffectiveLeft,
        statusMessage: statusMessage,        // effective logoff
        grossStatusMessage: grossStatusMessage,   // gross logoff (catchup-adjusted)
        neededMins: finalEffectiveLeft * 60,
        isClockedIn,
        catchupNote: catchupNote
    };
}

async function calculateRangeStats(startStr, endStr) {
    const todayStr = toLocalDateStr(new Date());
    // Single fetch — Keka returns ALL data regardless of month param
    const allData = await fetchAllAttendance();
    if (allData.success === false) return { totalGross: 0, totalEffective: 0, error: allData.error };

    let totalGross = 0;
    let totalEffective = 0;

    for (const day of (allData.data || [])) {
        const dStr = (day.attendanceDate || '').slice(0, 10);
        if (dStr >= startStr && dStr <= endStr) {
            let gross = (day.totalGrossHours || 0) * 60;
            let effective = (day.totalEffectiveHours || 0) * 60;

            // If this is today, add live minutes
            if (dStr === todayStr) {
                const liveStatus = getLiveStatus(day);
                if (liveStatus.isClockedIn) {
                    gross += liveStatus.liveMinutes;
                    // If effective is already tracking (greater than zero), add live minutes to it too
                    if (effective > 0) {
                        effective += liveStatus.liveMinutes;
                    }
                }
            }

            totalGross += (gross / 60);
            totalEffective += (effective / 60);
        }
    }

    console.log(`Keka Range [${startStr}→${endStr}]: gross=${totalGross.toFixed(2)}h eff=${totalEffective.toFixed(2)}h`);
    return { totalGross, totalEffective };
}

// --- MESSAGE HANDLERS ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handleRequest = async () => {
        try {
            if (request.action === 'GET_TODAY_STATS' || request.action === 'REFRESH_DATA') {
                const force = request.action === 'REFRESH_DATA';
                const [data, settings] = await Promise.all([
                    fetchAllAttendance(force),
                    new Promise(resolve => chrome.storage.local.get(['kekaGraceEnabled'], resolve))
                ]);
                if (data.success === false) {
                    sendResponse({ success: false, error: data.error });
                    return;
                }
                const stats = calculateTodayStats(data, settings.kekaGraceEnabled === true);
                sendResponse({ success: true, stats });
            }
            else if (request.action === 'GET_RANGE_STATS') {
                const stats = await calculateRangeStats(request.startDate, request.endDate);
                sendResponse({ success: true, stats });
            }
            else if (request.action === 'GET_ALARM_TIME') {
                chrome.alarms.get('kekaNotifier', (alarm) => {
                    sendResponse({ time: alarm ? alarm.scheduledTime : null });
                });
            }
            else if (request.action === 'TEST_NOTIFICATION') {
                const [data, settings] = await Promise.all([
                    fetchAllAttendance(false),
                    new Promise(resolve => chrome.storage.local.get(['kekaGraceEnabled'], resolve))
                ]);
                if (data.success === false) {
                    sendResponse({ success: false, error: data.error });
                    return;
                }
                const stats = calculateTodayStats(data, settings.kekaGraceEnabled === true);
                if (stats) {
                    const rawEodTime = stats.statusMessage.replace('Logoff at ', '');
                    const eodTime = rawEodTime.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
                    chrome.notifications.create('keka-test-' + Date.now(), {
                        type: 'basic',
                        iconUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', // 1x1 Transparent Pixel
                        title: 'K-Clock',
                        message: `EOD: ${eodTime}`
                    });
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'No stats' });
                }
            }
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
    };

    handleRequest();
    return true; // Keep channel open
});

// Periodic Notification Trigger
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'kekaNotifier' && kekaAuthToken) {
        const [data, settings] = await Promise.all([
            fetchAllAttendance(),
            new Promise(resolve => chrome.storage.local.get(['kekaGraceEnabled'], resolve))
        ]);
        if (stats) {
            // Strip emojis from the status message
            const rawEodTime = stats.statusMessage.replace('Logoff at ', '');
            const eodTime = rawEodTime.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').trim();
            chrome.notifications.create('keka-' + Date.now(), {
                type: 'basic',
                iconUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', // 1x1 Transparent Pixel
                title: 'K-Clock',
                message: `EOD: ${eodTime}`
            });
        }
    }
});
