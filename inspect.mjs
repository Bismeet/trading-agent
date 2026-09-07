import fs from "node:fs";
const t = fs.readFileSync("t.txt", "utf8");
const g = (k) => { const m = t.match(new RegExp(k + " (\\d+)")); return m ? m[1] : "?"; };
console.log(`pass:${g("pass")} fail:${g("fail")}`);
const i = t.indexOf("failing tests");
if (i >= 0) console.log(t.slice(i, i + 800).replace(/\r/g, ""));