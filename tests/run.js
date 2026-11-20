const fs=require('fs'),path=require('path'),P=require('../parser.js');
const Q=require('./exp.json');
(async()=>{for(const f of fs.readdirSync('.').filter(f=>/\.(pdf|docx)$/.test(f)).sort()){
 try{const qs=await P.parseFile(fs.readFileSync(f),path.extname(f));
  let bad=[];qs.forEach((q,i)=>{const e=Q[i];if(!e||q.options.length!==e[1]||(f!=='p5.pdf'&&q.answer!==e[2]))bad.push(i+1+':'+q.options.length+'/'+q.answer)});
  console.log(f.padEnd(14),'n='+qs.length,bad.length?'BAD '+bad.slice(0,8).join(' '):'OK')}catch(e){console.log(f,'ERR',e.message)}}})();
