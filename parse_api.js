const fs = require('fs');
const json = JSON.parse(fs.readFileSync('response.json', 'utf8'));

let totalEffective = 0;
let todayEffective = 0;

const now = new Date("2026-03-03T00:00:00");
const monday = new Date("2026-03-02T00:00:00"); 

json.data.forEach(day => {
    const d = new Date(day.attendanceDate);
    d.setHours(0,0,0,0);
    if(d >= monday) {
        const eff = Math.floor((day.totalEffectiveHours || 0) * 60);
        console.log(`Date: ${day.attendanceDate}, Effective: ${eff}m (${Math.floor(eff/60)}h ${eff%60}m)`);
        totalEffective += eff;
        if(d.getTime() === now.getTime()) {
            todayEffective = eff;
        }
    }
});
console.log(`Total: ${totalEffective}m, Today: ${todayEffective}m`);

const daysPassed = 1; // Mon
const prevDaysEffective = totalEffective - todayEffective;
const expectedEffPrev = daysPassed * 480;
const catchupEffective = expectedEffPrev - prevDaysEffective;

const todayEffTarget = Math.max(0, 480 + catchupEffective);
const leftEffective = Math.max(0, todayEffTarget - todayEffective);

console.log("Left Effective:", leftEffective, "mins");
