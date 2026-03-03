let kekaAuthToken = null;

chrome.storage.local.get(['kekaAuthToken'], (result) => {
    if (result.kekaAuthToken) kekaAuthToken = result.kekaAuthToken;
});

chrome.webRequest.onSendHeaders.addListener(
    function (details) {
        for (let header of details.requestHeaders) {
            if (header.name.toLowerCase() === 'authorization') {
                if (header.value !== kekaAuthToken) {
                    kekaAuthToken = header.value;
                    chrome.storage.local.set({ kekaAuthToken: header.value });
                    console.log("Keka Helper: Intercepted new Auth Token!");
                }
                break;
            }
        }
    },
    { urls: ["https://*.keka.com/*"] },
    ["requestHeaders"]
);

chrome.runtime.onInstalled.addListener(() => {
    // Default to 30 minutes if not set
    chrome.storage.local.get(['kekaNotifyInterval', 'kekaNotifyEnabled'], (data) => {
        if (data.kekaNotifyEnabled === undefined) {
            chrome.storage.local.set({ kekaNotifyEnabled: true });
        }
        if (!data.kekaNotifyInterval) {
            chrome.storage.local.set({ kekaNotifyInterval: 30 });
            setupAlarm(30);
        } else {
            setupAlarm(data.kekaNotifyInterval);
        }
    });
});

function setupAlarm(minutes) {
    chrome.alarms.clear('kekaNotifier', () => {
        if (minutes > 0) {
            chrome.alarms.create('kekaNotifier', { periodInMinutes: parseInt(minutes) });
            console.log(`Keka Helper: Alarm set for every ${minutes} minutes.`);
        } else {
            console.log(`Keka Helper: Notifications disabled.`);
        }
    });
}

// Listen for updates from settings panel
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.kekaNotifyInterval || changes.kekaNotifyEnabled) {
            chrome.storage.local.get(['kekaNotifyInterval', 'kekaNotifyEnabled'], (data) => {
                if (data.kekaNotifyEnabled && data.kekaNotifyInterval) {
                    setupAlarm(data.kekaNotifyInterval);
                } else {
                    setupAlarm(0); // Clear alarm
                }
            });
        }
    }
});

// Helper to get Monday of the current week (matching Keka's start)
function getMonday(d) {
    d = new Date(d);
    var day = d.getDay(),
        diff = d.getDate() - day + (day == 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Format minutes to HH:MM a
function formatLogoffTime(dateObj) {
    let hours = dateObj.getHours();
    let minutes = dateObj.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return hours + ':' + minutes + ' ' + ampm;
}

// Core V2 Engine: Background API Fetching
async function fetchKekaData() {
    if (!kekaAuthToken) {
        console.warn("Keka Helper (V2): No Auth Token yet. Cannot fetch data.");
        return;
    }

    try {
        const response = await fetch("https://marutitech.keka.com/k/attendance/api/mytime/attendance/summary", {
            headers: {
                "Authorization": kekaAuthToken,
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            console.error("Keka Helper (V2): API return error:", response.status);
            return;
        }

        const json = await response.json();

        // --- DEBUG API DUMP ---
        chrome.storage.local.set({ kekaDebugApiDump: json });
        console.log("Keka Helper (V2): Dumped raw API payload to storage.");
        // ----------------------

        let targetEffective = 40 * 60;

        let totalEffective = 0;
        let todayEffective = 0;
        let isClockedIn = false;
        let lastInTime = null;

        const now = new Date();
        const monday = getMonday(now);
        const todayFn = new Date();
        todayFn.setHours(0, 0, 0, 0);

        // Parse API Response Array
        if (json && json.data && Array.isArray(json.data)) {
            for (let dayData of json.data) {
                const dayDate = new Date(dayData.attendanceDate);
                // Ensure the date is strictly midnight for comparison
                dayDate.setHours(0, 0, 0, 0);

                if (dayDate < monday) continue; // Only process this week

                // Deductions Logic
                const isOffDay = dayData.dayType === 1 || dayData.dayType === 2;

                let isLeave = false;
                let mentionsHalfDay = false;

                // 1. Check leaveDayStatuses
                if (dayData.leaveDayStatuses && dayData.leaveDayStatuses.length > 0) {
                    if (dayData.leaveDayStatuses.every(status => status === 1)) {
                        isLeave = true; // 1 represents a full day leave approval
                    } else {
                        // If it's something else, it might be a half day, we'll check duration
                        isLeave = true;
                    }
                }

                // 2. Fallback check for leaveDetails array (Comp Offs / Casual Leaves)
                if (dayData.leaveDetails && dayData.leaveDetails.length > 0) {
                    isLeave = true;
                }

                const effectiveMinutes = Math.floor((dayData.totalEffectiveHours || 0) * 60);
                const hasWorkedHours = effectiveMinutes > 0;
                // Keka uses 4 hours (240 mins) half day rule for effective
                const workedFullDay = effectiveMinutes > 240;

                // We only deduct the target on leaves, not plain off days which are naturally 0h
                if (isLeave) {
                    if (mentionsHalfDay || (hasWorkedHours && !workedFullDay)) {
                        targetEffective -= 240; // Deduct 4h for half day
                    } else if (!isOffDay) {
                        targetEffective -= 480; // Deduct 8h for full leave
                    }
                } else if (mentionsHalfDay && !workedFullDay) {
                    targetEffective -= 240;
                }

                // Sum up hours
                totalEffective += effectiveMinutes;

                // Handle "Today" logic specifically
                if (dayDate.getTime() === todayFn.getTime()) {
                    todayEffective = effectiveMinutes;

                    // Check if actively clocked in by looking at pairs
                    if (dayData.validInOutPairs && dayData.validInOutPairs.length > 0) {
                        const lastPair = dayData.validInOutPairs[dayData.validInOutPairs.length - 1];

                        // Keka API might return null OR a dummy .NET Date "0001-01-01T00:00:00" for an active session
                        const isMissingOut = !lastPair.outTime || lastPair.outTime.includes('0001');

                        if (lastPair.inTime && isMissingOut) {
                            isClockedIn = true;
                            // Ensure Keka's inTime date format parses cleanly
                            lastInTime = new Date(lastPair.inTime);
                        }
                    }
                }
            }
        }

        if (targetEffective < 0) targetEffective = 0;

        // Calculate the Final Target using exact V1 UI Parity Math
        let todayIndex = now.getDay();
        let daysPassed = 0;
        if (todayIndex >= 1 && todayIndex <= 5) {
            daysPassed = todayIndex - 1; // Mon=0, Tue=1, etc.
        } else if (todayIndex === 6) {
            daysPassed = 5;
        }

        const prevDaysEffective = totalEffective - todayEffective;
        const expectedEffPrev = daysPassed * 480; // 8h per previous day
        const catchupEffective = expectedEffPrev - prevDaysEffective;

        // Today's personal target
        const todayEffTarget = Math.max(0, 480 + catchupEffective);

        // Left for today (excluding live session, since Keka's UI left includes live session but the API payload only has closed pairs)
        // Actually, if we use lastInTime, the API gives us `todayEffective` WITHOUT the current open pair.
        // So they need to work `todayEffTarget - todayEffective` minutes *from the start of the last punch in*.
        const leftEffective = Math.max(0, todayEffTarget - todayEffective);
        let logoffDateObj = null;

        if (totalEffective >= targetEffective || leftEffective <= 0) {
            message = "GOAL MET! 🎉";
        } else {
            // If actively clocked in, project from the start of the current live session
            // If clocked out, simply project the remaining minutes from exactly right now 
            // (this perfectly mirrors the V1 Range Calculator's logic for the 21:48 target)
            const anchorTime = (isClockedIn && lastInTime) ? lastInTime.getTime() : now.getTime();
            logoffDateObj = new Date(anchorTime + (leftEffective * 60000));

            if (logoffDateObj < now && isClockedIn) {
                message = "GOAL MET! 🎉";
            } else {
                message = `Logoff at ${formatLogoffTime(logoffDateObj)}`;
            }
        }

        // --- Execute Notification ---
        const notifId = 'keka-notify-v2-' + Date.now();
        chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Keka Target (Background API)',
            message: message
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                const errStr = JSON.stringify(chrome.runtime.lastError, null, 2) || chrome.runtime.lastError.message;
                console.error("Keka Helper (V2): Failed to create notification:", errStr);
            } else {
                console.log("Keka Helper (V2): Notification shown successfully! ID:", notificationId);
            }
        });

    } catch (e) {
        console.error("Keka Helper (V2): API Fetch Failed:", e);
    }
}


// Listen for the Alarm ticking
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'kekaNotifier') {
        console.log("Keka Helper: Alarm triggered! Fetching fresh data from API...");
        // Execute the native background fetch instead of relying on stale DOM data
        fetchKekaData();
    }
});

// Listen for messages from content.js with the latest calculations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TEST_API_FETCH') {
        console.log("Keka Helper (V2): Manually triggered API Fetch!");
        fetchKekaData();
    } else if (request.action === 'UPDATE_KEKA_STATUS') {
        chrome.storage.local.set({
            kekaLatestStatus: request.data,
            kekaLastUpdateTime: Date.now()
        });
    } else if (request.action === 'GET_ALARM_TIME') {
        chrome.alarms.get('kekaNotifier', (alarm) => {
            if (alarm) {
                sendResponse({ time: alarm.scheduledTime });
            } else {
                sendResponse({ time: null });
            }
        });
        return true; // Keep the message channel open for the async response
    }
});
