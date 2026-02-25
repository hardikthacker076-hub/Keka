// Data from screenshots
const prevDaysGross = (10*60 + 1) + (9*60 + 36); // Mon + Tue = 1177 min
const targetPrevDays = 2 * 9 * 60; // 2 days * 9h = 1080 min

// Catchup based on previous days
const catchupGross = targetPrevDays - prevDaysGross; // 1080 - 1177 = -97 min (Ahead by 97m)

// Today's target
const todayGrossTarget = Math.max(0, 9*60 + catchupGross); // 540 - 97 = 443 min (7h 23m)

// Today's actual worked (from panel)
const todayGrossLive = 5*60 + 53; // 353 min

// Left
const leftGross = Math.max(0, todayGrossTarget - todayGrossLive); // 443 - 353 = 90 min (1h 30m)

console.log("Expected Left Gross (min):", leftGross); // Matches screen! 1h 30m

// Now, what time was it when the leftGross was 90 min, and outTimeGross was 16:53 (16 * 60 + 53 = 1013 min)?
const logoffMinutes = 16 * 60 + 53; // 1013
const nowMinutes = logoffMinutes - leftGross; // 1013 - 90 = 923 min
const nowHour = Math.floor(nowMinutes / 60);
const nowMin = nowMinutes % 60;

console.log(`Inferred 'now': ${nowHour}:${nowMin}`); // 15:23

// Next question: The user says "Sometimes it does show incorrect gross and effective logout time".
// If "now" was 15:23, then 15:23 + 1h 30m = 16:53. The math *is* correct for that specific moment!
// BUT where does the bug come from? Is it that "now" isn't updating?
// Or is it because Keka logs show `lastActivePunchIn` as `13:01:05` (from third screenshot),
// and "now" is used to add the live minutes vs `lastActivePunchIn`.
