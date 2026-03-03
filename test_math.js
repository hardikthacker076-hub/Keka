
// V1 Daily Banner uses:
// 40 target
// Mon: 4h 0m
// Tue (today): 3h 16m worked so far
// Total: 7h 16m total effective 

// Weekly Remain: 40h - 7h 16m = 32h 44m (1964 mins)
// Last punch in: ? 
// If logoff = 21:48 (1308 min) and needed = 1964 min
// Last In + 1964 = 1308 ... this implies Last In was 11 hours *before* midnight, which is impossible.

// Let's rethink how V1 logic actually works...
// Wait! The user's screenshot says GROSS target is 9h, EFFECTIVE target is 8h TODAY!
// V1 calculates LOGOFF TIME *based on the Daily target of 8h*, NOT weekly target!

// Let's check V1 logic in content.js for the Daily Banner...
// The Daily banner uses: effectiveTarget = 40 (wait, or is it 8?)
