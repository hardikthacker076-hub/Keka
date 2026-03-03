
const now = new Date("2026-03-03T17:21:00");
// They worked 3h 33m out of 8h (meaning 4h 27m left to work)
const leftMinutes = (4 * 60) + 27;

const outDateObj = new Date(now.getTime() + (leftMinutes * 60000));
console.log("Expected Logoff if calculated right now:", outDateObj.getHours() + ":" + outDateObj.getMinutes());

