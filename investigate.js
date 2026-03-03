
// 1. Let's calculate what `lastInTime` the API got to produce 22:53 (10:53 PM)
// API Left Effective = target - today
// Let's assume the API Left Effective == UI Left Effective (4h 22m = 262 mins)
// API Logoff = lastInTimeAPI + 262 mins = 22:53.
// 22:53 = 1373 minutes.
// lastInTimeAPI = 1373 - 262 = 1111 minutes = 18:31.
// Was the last punch at 18:31? 6:31 PM? That is in the FUTURE. The time is 17:27. Impossible.

// 2. What if API Left Effective != UI Left Effective?
// If lastInTime = roughly 17:26 (which is the current time? No, the last punch could be earlier).
// Wait, the UI has a "live session".
// Live Minutes = now - lastInTime.
// Worked = 3h 38m = 218m.
// Left = 4h 22m = 262m.
// Total Target = 3h 38m + 4h 22m = 8h 0h (480 mins).
// Which means catchupEffective = 0.
// This means Monday Effective was EXACTLY 8 hours. 
// So Left Effective (UI, including live) = 262 mins.
// But the API Left Effective DOES NOT INCLUDE LIVE!
// API leftEffective = todayEffTarget - todayEffective (No live).
// If "Worked" (3h 38m) in the UI INCLUDES the live session!
// Yes! "Worked" in the UI banner is `toHm(todayEffective + liveMin)`.
const todayEffective_live = 218;

// If live session started at e.g., 16:22 (65 minutes ago).
const liveMin = 65;
const todayEffective_API = todayEffective_live - liveMin; // 218 - 65 = 153 mins (2h 33m).

// Then the API calculates `leftEffective`:
const apiLeftEffective = 480 - todayEffective_API; // 480 - 153 = 327 mins.

// Then the API logs off at:
// logoff = lastInTimeAPI + apiLeftEffective.
// If lastInTimeAPI = 16:22.
// logoff = 16:22 + 327 mins = 982 + 327 = 1309 mins = 21:49.
// This matches exactly.

// Why would it calculate 22:53 instead of 21:49?
// 22:53 = 21:48 + 65 mins!
// Wait!
console.log("Difference:", 22*60+53 - (21*60+48)); // 65
