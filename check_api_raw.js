const data = require('./response.json');
const t = data.data.find(d => {
    return new Date(d.attendanceDate).toISOString().startsWith('2026-03-03');
});
console.log("3 Mar Data:");
console.log("lastLogOfDay:", t.lastLogOfTheDay);
console.log("totalEffectiveHours:", t.totalEffectiveHours);
console.log("validInOutPairs:");
console.dir(t.validInOutPairs);
