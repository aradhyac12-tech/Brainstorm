// usage: node selftest.js file.pdf|file.docx   -> prints a parse report so extraction problems are visible immediately
const fs=require('fs'),path=require('path'),P=require('./parser');
(async()=>{const f=process.argv[2];if(!f){console.log('usage: node selftest.js <file>');process.exit(1)}
const C=process.env.OCR_CACHE,t0=Date.now(),opts={ocr:C&&fs.existsSync(C)?JSON.parse(fs.readFileSync(C)):{},state:{pending:0,ocrPages:0},workers:+process.env.OCR_WORKERS||3};
const qs=await P.parseFile(fs.readFileSync(f),path.extname(f).toLowerCase(),opts);
if(C)fs.writeFileSync(C,JSON.stringify(opts.ocr));
console.log(JSON.stringify(P.report(qs)));console.log('seconds',((Date.now()-t0)/1000).toFixed(1),'ocrPages',opts.state.ocrPages);
if(process.env.DUMP)fs.writeFileSync(process.env.DUMP,JSON.stringify(qs,null,1));})();
