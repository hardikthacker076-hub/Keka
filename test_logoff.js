// Screen 2 info
// Worked: 3h 16m
// Left: 4h 44m
// Total target today: 8 hours (480 mins)
// Logoff in UI: 21:48 (09:48 PM)

// The user wants 21:48 from the V2 API

// Currently, time is 2026-03-03T17:07:42
// Wait, the API fetch lastInTime might be the key.
// If worked = 3h 16m (196 min) and left = 4h 44m (284 min),
// And to get to 21:48 (21*60 + 48 = 1308 minutes from midnight)

const lastInTimeMs = new Date("2026-03-03T21:48:00").getTime() - (284 * 60000);
const d = new Date(lastInTimeMs);
console.log("Implied last punch in:", d.getHours() + ":" + d.getMinutes());
