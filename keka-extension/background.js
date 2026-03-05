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
        // Per-row tracking of EXPECTED effective hours from past days.
        // Holidays and off days contribute 0; normal working days contribute 480.
        let expectedEffPrev = 0;

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

                // Track expected hours for PAST days (not today)
                if (dayDate.getTime() !== todayFn.getTime()) {
                    if (isOffDay) {
                        // holiday / weekly off → 0 expected
                    } else if (isLeave) {
                        if (mentionsHalfDay || (hasWorkedHours && !workedFullDay)) {
                            expectedEffPrev += 240; // half day leave
                        }
                        // full day leave → 0 expected
                    } else if (mentionsHalfDay && !workedFullDay) {
                        expectedEffPrev += 240;
                    } else {
                        expectedEffPrev += 480; // normal working day
                    }
                }

                // Handle "Today" logic specifically
                if (dayDate.getTime() === todayFn.getTime()) {
                    todayEffective = effectiveMinutes;

                    // Look at Keka's explicit punch metrics rather than validInOutPairs 
                    // (since the array only contains completely closed pairs)
                    if (dayData.lastLogOfTheDay) {
                        const lastLog = new Date(dayData.lastLogOfTheDay);
                        const lastOut = dayData.lastOutOfTheDay ? new Date(dayData.lastOutOfTheDay) : null;

                        // If there is no out punch, or the last out punch is older than the last log, we are clocked IN
                        const isMissingOutFallback = !lastOut || isNaN(lastOut.getTime()) || (lastLog.getTime() > lastOut.getTime()) || dayData.lastOutOfTheDay.includes("0001");

                        if (isMissingOutFallback) {
                            isClockedIn = true;
                            lastInTime = lastLog;
                        }
                    }
                }
            }
        }

        if (targetEffective < 0) targetEffective = 0;

        // Calculate the Final Target using strict Daily Math (no cross-day deficit roll-over, matching typical Keka UI)
        let isTodayLeaveOrOff = false;

        if (json && json.data && Array.isArray(json.data)) {
            for (let dayData of json.data) {
                const dayDate = new Date(dayData.attendanceDate);
                dayDate.setHours(0, 0, 0, 0);
                if (dayDate.getTime() === todayFn.getTime()) {
                    // Check if it's off or leave
                    let isLve = false;
                    if (dayData.leaveDayStatuses && dayData.leaveDayStatuses.length > 0) isLve = true;
                    if (dayData.leaveDetails && dayData.leaveDetails.length > 0) isLve = true;

                    const dayTypeDesc = (dayData.dayType === 0) ? true : false; // 0 usually means weekend/weekly off

                    if (isLve || dayTypeDesc) {
                        isTodayLeaveOrOff = true;
                    }
                }
            }
        }

        let message = "";

        if (isTodayLeaveOrOff && todayEffective === 0 && !isClockedIn) {
            message = "On Leave / Day Off! 🎉";
            chrome.notifications.create('keka-notify-v2-' + Date.now(), {
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Keka Target (Background API)',
                message: message
            });
            return;
        }

        if (todayEffective === 0 && !isClockedIn) {
            message = "Yet to Start ⏳";
            chrome.notifications.create('keka-notify-v2-' + Date.now(), {
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Keka Target (Background API)',
                message: message
            });
            return;
        }

        // HOLIDAY-AWARE WEEKLY CATCHUP TARGET
        // expectedEffPrev is 0 for holidays, 480 for working days, 240 for half-day leaves.
        const prevDaysEffective = totalEffective - todayEffective;
        const catchupEffective = expectedEffPrev - prevDaysEffective; // positive = behind, negative = ahead
        const todayEffTarget = Math.max(0, 480 + catchupEffective);
        const leftEffective = Math.max(0, todayEffTarget - todayEffective);

        console.log(`Keka BG Catchup: expectedEffPrev=${expectedEffPrev}m prevWorked=${prevDaysEffective}m catchup=${catchupEffective}m todayTarget=${todayEffTarget}m`);

        let logoffDateObj = null;

        if (totalEffective >= targetEffective || leftEffective <= 0) {
            message = "GOAL MET! 🎉";
        } else {
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
