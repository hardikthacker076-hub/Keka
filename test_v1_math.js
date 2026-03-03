// V1 Logic Replication Test:
const totalEffective = 7 * 60 + 16; // 7h 16m
const todayEffective = 3 * 60 + 16; // 3h 16m
// Assume Tuesday (daysPassed = 1)
const daysPassed = 1;
const expectedEffPrev = daysPassed * 480; // 8h = 480

const prevDaysEffective = totalEffective - todayEffective; // 4h 0m (240 mins)
const catchupEffective = expectedEffPrev - prevDaysEffective; // 480 - 240 = 240 mins (4 hours to catch up)

// Today's personal target
const todayEffTarget = Math.max(0, 480 + catchupEffective); // 480 + 240 = 720 mins (12 hours needed today!)

// Left for today
const leftEffective = Math.max(0, todayEffTarget - todayEffective); // 720 - 196 = 524 mins

console.log("Left Effective:", Math.floor(leftEffective / 60), "h", leftEffective % 60, "m");

// Let's project 524 mins from the LAST ACTIVE PUNCH IN
// Based on our previous derivation, last punch in was around 13:04? 
// 13:04 + 524 mins (8 hours 44 mins) = 21:48! 

// YES! That's exactly it!
