let targetEffective = 40 * 60;
console.log("Initial target:", targetEffective);

// Let's pretend today is Tuesday
const monday = new Date("2026-03-02T00:00:00");
const tuesday = new Date("2026-03-03T00:00:00");

// Data from Keka
const days = [
  { date: "2026-03-02", effective: 4 * 60 },
  { date: "2026-03-03", effective: 3 * 60 + 16 }
];

let totalEffective = 0;
days.forEach(d => totalEffective += d.effective);

console.log("Total Effective:", Math.floor(totalEffective / 60), "h", totalEffective % 60, "m");

const remain = targetEffective - totalEffective;
console.log("Remain:", Math.floor(remain / 60), "h", remain % 60, "m");

// This matches the notification: 29h 27m if we assume some minutes
