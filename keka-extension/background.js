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

        let targetGross = 45 * 60; // 45 hours in minutes
        let targetEffective = 40 * 60;

        let totalGross = 0;
        let todayGross = 0;
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

                // Deductions Logic identical to DOM (Leaves / Holidays)
                // dayType: 1 or 2 implies weekend/holiday
                const isOffDay = dayData.dayType === 1 || dayData.dayType === 2;

                // leaveDayStatuses array handling
                let isLeave = false;
                let mentionsHalfDay = false;
                if (dayData.leaveDayStatuses && dayData.leaveDayStatuses.length > 0) {
                    isLeave = true;
                    if (dayData.leaveDayStatuses.some(l => l.leaveDayStatus === 1)) { // 1 Usually means Half Day in Keka
                        mentionsHalfDay = true;
                    }
                }

                const workedMinutes = Math.floor((dayData.totalGrossHours || 0) * 60);
                const hasWorkedHours = workedMinutes > 0;
                const workedFullDay = workedMinutes > 300; // > 5 hours

                if (isLeave) {
                    // Only deduct if it's a full or half day leave. 
                    // Normal working days don't deduct the target, they just add to the total.
                    if (mentionsHalfDay || (hasWorkedHours && !workedFullDay)) {
                        targetGross -= 300; // Deduct 5h for half day
                    } else if (!isOffDay) {
                        targetGross -= 540; // Deduct 9h for full leave
                    }
                } else if (mentionsHalfDay && !workedFullDay) {
                    targetGross -= 300; // Deduct 5h for half day without explicit leave tag
                }

                // Sum up hours
                totalGross += workedMinutes;

                // Handle "Today" logic specifically
                if (dayDate.getTime() === todayFn.getTime()) {
                    todayGross = workedMinutes;

                    // Check if actively clocked in by looking at pairs
                    if (dayData.validInOutPairs && dayData.validInOutPairs.length > 0) {
                        const lastPair = dayData.validInOutPairs[dayData.validInOutPairs.length - 1];
                        if (lastPair.inTime && !lastPair.outTime) {
                            isClockedIn = true;
                            // Ensure Keka's inTime date format parses cleanly
                            lastInTime = new Date(lastPair.inTime);
                        }
                    }
                }
            }
        }

        if (targetGross < 0) targetGross = 0;

        // Calculate the Final Target
        // 1. Calculate how many hours we still need to hit the target.
        const weeklyRemainGross = targetGross - totalGross;

        let message = "";
        let logoffDateObj = null;

        if (weeklyRemainGross <= 0) {
            message = "GOAL MET! 🎉 (V2 API)";
        } else {
            // Target not met yet. Evaluate if actively clocking.
            if (isClockedIn && lastInTime) {
                // If clocked in, we need to work `weeklyRemainGross` MORE minutes from the moment we clocked in today.
                // Wait, no. `totalGross` ALREADY includes what Keka synced up to the point of `lastInTime`? 
                // Actually, keka's `totalGrossHours` represents the sum of ALL COMPLETED PAIRS for today, 
                // plus the duration of the current open pair IF their backend syncs it.
                // Normally Keka API is static until a punch out. 
                // Let's assume `totalGrossHours` only reflects CLOSED pairs.
                // If so: Logoff Time = Last In Time + (weeklyRemainGross minutes)

                logoffDateObj = new Date(lastInTime.getTime() + (weeklyRemainGross * 60000));

                // If the Logoff time is in the past, Keka's API just hasn't updated the closed pair yet, but goal is technically met.
                if (logoffDateObj < now) {
                    message = "GOAL MET! 🎉 (V2 API)";
                    // Though mathematically logoffDateObj is in the past.
                } else {
                    message = `Logoff at ${formatLogoffTime(logoffDateObj)} (V2 API)`;
                }
            } else {
                // Not clocked in.
                message = `You are clocked out. Need ${Math.floor(weeklyRemainGross / 60)}h ${Math.floor(weeklyRemainGross % 60)}m more. (V2 API)`;
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
