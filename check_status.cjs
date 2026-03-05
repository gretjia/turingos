const fs = require('fs');

const logFile = '/home/zephryj/projects/turingos/benchmarks/audits/baseline/daemon_run.log';
if (!fs.existsSync(logFile)) {
  console.log("No daemon log found.");
  process.exit(0);
}

const content = fs.readFileSync(logFile, 'utf8');
const lines = content.split('\n');

const cases = [];
for (const line of lines) {
  if (line.includes('[million-baseline] case=')) {
     const match = line.match(/case=(\d+).*attempted=(\d+).*passed=(\d+)/);
     if (match) {
        cases.push({
          caseIndex: parseInt(match[1], 10),
          attempted: parseInt(match[2], 10),
          passed: parseInt(match[3], 10),
          status: line.includes('got=null') ? 'FAILED' : 'PASSED'
        });
     }
  }
}

if (cases.length > 0) {
  console.log("History of executed cases:");
  console.table(cases);
  
  // Calculate max consecutive passes
  let currentConsecutive = 0;
  let maxConsecutive = 0;
  for (const c of cases) {
    if (c.status === 'PASSED') {
       currentConsecutive++;
       if (currentConsecutive > maxConsecutive) maxConsecutive = currentConsecutive;
    } else {
       currentConsecutive = 0;
    }
  }
  
  const currentStreak = cases.reverse().findIndex(c => c.status === 'FAILED');
  console.log(`Max consecutive streak: ${maxConsecutive}`);
  console.log(`Current active streak: ${currentStreak === -1 ? cases.length : currentStreak}`);
} else {
  console.log("No completed cases found in the log yet.");
}
