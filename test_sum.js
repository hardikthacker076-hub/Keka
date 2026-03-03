const gross = [4*60, 6*60 + 5, 9*60 + 6, 9*60 + 1, 8*60 + 22];
const eff = [4*60, 6*60 + 5, 8*60 + 5, 8*60 + 11, 7*60 + 17];
console.log("Gross sum:", gross.reduce((a,b)=>a+b, 0) / 60, "hrs");
console.log("Eff sum:", eff.reduce((a,b)=>a+b, 0) / 60, "hrs");
