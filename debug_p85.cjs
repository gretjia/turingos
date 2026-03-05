const fs = require('fs');
const file = '/home/zephryj/projects/turingos/benchmarks/tmp/baseline_dualbrain/case_001162/.journal.log';
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8').trim().split('\n');
  const workerIds = [...new Set(content.map(l => {
    const match = l.match(/child=(worker_[a-f0-9]+)/);
    return match ? match[1] : null;
  }).filter(Boolean))];
  console.log("Total dropped workers:", workerIds.length);
  
  const mapStr = content.find(l => l.includes('HYPERCORE_MAP'));
  if (mapStr) {
     const children = mapStr.match(/children=([^ ]+)/)[1].split(',');
     console.log("Total spawned workers:", children.length);
     const remaining = children.filter(c => !workerIds.includes(c));
     console.log("Remaining worker(s) that didn't drop or return:", remaining);
  }
}
