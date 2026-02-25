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

// Listen for the alarm to trigger
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'kekaNotifier') {
        chrome.storage.local.get(['kekaNotifyEnabled', 'kekaLatestStatus', 'kekaLastUpdateTime'], (data) => {
            if (data.kekaNotifyEnabled && data.kekaLatestStatus) {
                // Check if data is fresh. The content script sends updates every 60s.
                // If the data is older than 5 minutes, it means the Keka tab is closed.
                const timeSinceLastUpdate = Date.now() - (data.kekaLastUpdateTime || 0);
                if (timeSinceLastUpdate > 5 * 60 * 1000) {
                    console.log("Keka Helper: Data is stale (Keka tab closed). Suppressing notification.");
                    return; // Suppress notification
                }

                // Determine the context
                let message = "";
                if (data.kekaLatestStatus.isGoalMet) {
                    message = "GOAL MET! 🎉";
                } else if (data.kekaLatestStatus.isWeekOver) {
                    message = "Week Over! 😭 (Target Not Met)";
                } else {
                    message = `Logoff at ${data.kekaLatestStatus.effectiveLogoffStr}`;
                }

                chrome.notifications.create({
                    type: 'basic',
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
