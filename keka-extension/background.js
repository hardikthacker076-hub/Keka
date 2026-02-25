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

// Variable to hold the latest known status
let latestStatus = null;
let lastUpdateTime = 0;

// Listen for the alarm to trigger
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'kekaNotifier') {
        chrome.storage.local.get(['kekaNotifyEnabled'], (data) => {
            if (data.kekaNotifyEnabled && latestStatus) {
                // Check if data is fresh. The content script sends updates every 60s.
                // If the data is older than 5 minutes, it means the Keka tab is closed.
                // We should NOT send a notification if the tab is closed, to avoid stale/yesterday's data.
                const timeSinceLastUpdate = Date.now() - lastUpdateTime;
                if (timeSinceLastUpdate > 5 * 60 * 1000) {
                    console.log("Keka Helper: Data is stale (Keka tab closed). Suppressing notification.");
                    return;
                }

                // Determine the context
                let message = "";
                if (latestStatus.isGoalMet) {
                    message = "GOAL MET! 🎉";
                } else if (latestStatus.isWeekOver) {
                    message = "Week Over! 😭 (Target Not Met)";
                } else {
                    message = `Logoff at ${latestStatus.effectiveLogoffStr}`;
                }

                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon.png', // Fallback if no specific icon exists
                    title: 'Keka Target',
                    message: message,
                    priority: 2,
                    requireInteraction: false
                });
            }
        });
    }
});

// Listen for messages from content.js with the latest calculations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'UPDATE_KEKA_STATUS') {
        latestStatus = request.data;
        lastUpdateTime = Date.now();
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
