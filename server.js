const express=require('express'),multer=require('multer'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {parseFile}=require('./parser');
// env values pasted into dashboards often carry stray spaces/newlines/quotes - normalise them
const cleanPw=v=>String(v==null?'':v).trim().replace(/^(["'])([\s\S]*)\1$/,'$2').trim();
const PW=cleanPw(process.env.ADMIN_PASSWORD)||'ac1205',VERCEL=!!process.env.VERCEL;
const KEY=(process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_KEY||'').trim(),SBURL=(process.env.SUPABASE_URL||'').trim(),SB=SBURL&&KEY;
const MAXMB=VERCEL?4:25;
const safe=id=>String(id).replace(/[^a-z0-9]/gi,'');

// ---------- storage: Supabase if configured, otherwise local files ----------
let store;
if(SB){
  const U=SBURL.replace(/\/rest\/v1\/?$/,'').replace(/\/+$/,'')+'/rest/v1/';
  const call=async(p,o={})=>{
    const r=await fetch(U+p,{...o,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...(o.headers||{})}});
    const t=await r.text();if(!r.ok)throw new Error('Database error: '+t.slice(0,200));return t?JSON.parse(t):null;
  };
  const up=(t,row)=>call(t,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([row])});
  store={mode:'supabase',
    getQuiz:async id=>((await call('brainstorm_quizzes?id=eq.'+safe(id)+'&select=data'))[0]||{}).data||null,
    putQuiz:q=>up('brainstorm_quizzes',{id:q.id,data:q,created:q.created}),
    delQuiz:async id=>{await call('brainstorm_attempts?quiz_id=eq.'+safe(id),{method:'DELETE'});await call('brainstorm_quizzes?id=eq.'+safe(id),{method:'DELETE'})},
    listQuizzes:async()=>(await call('brainstorm_quizzes?select=data&order=created.desc')).map(x=>x.data).filter(x=>x&&x.questions),
    // temporary blobs (upload chunks, OCR progress) live in the same table under ids starting "zz" - never listed as quizzes
    putBlob:(k,o)=>up('brainstorm_quizzes',{id:'zz'+safe(k),data:o,created:Date.now()}),
    getBlob:async k=>((await call('brainstorm_quizzes?id=eq.zz'+safe(k)+'&select=data'))[0]||{}).data||null,
    delBlobs:async pre=>{await call('brainstorm_quizzes?id=like.zz'+safe(pre)+'*',{method:'DELETE'})},
    sweepBlobs:async()=>{await call('brainstorm_quizzes?id=like.zz*&created=lt.'+(Date.now()-864e5),{method:'DELETE'})},
    getAttempts:async id=>(await call('brainstorm_attempts?quiz_id=eq.'+safe(id)+'&select=data&order=start.asc')).map(x=>x.data),
    getAttempt:async(id,aid)=>((await call('brainstorm_attempts?id=eq.'+safe(aid)+'&quiz_id=eq.'+safe(id)+'&select=data'))[0]||{}).data||null,
    putAttempt:(id,a)=>up('brainstorm_attempts',{id:a.id,quiz_id:safe(id),data:a,start:a.start}),
    delAttempt:(id,aid)=>call('brainstorm_attempts?id=eq.'+safe(aid)+'&quiz_id=eq.'+safe(id),{method:'DELETE'})};
}else{
  const DIR=VERCEL?path.join(os.tmpdir(),'brainstorm'):path.join(__dirname,'data');
  try{fs.mkdirSync(path.join(DIR,'results'),{recursive:true})}catch(e){console.error('Storage dir error',e.message)}
  const rj=(f,d)=>{try{return JSON.parse(fs.readFileSync(f))}catch{return d}};
  const qf=id=>path.join(DIR,safe(id)+'.json'),af=id=>path.join(DIR,'results',safe(id)+'.json');
  store={mode:'file',
    getQuiz:async id=>rj(qf(id),null),
    putQuiz:async q=>fs.writeFileSync(qf(q.id),JSON.stringify(q)),
    delQuiz:async id=>{for(const f of[qf(id),af(id)])try{fs.unlinkSync(f)}catch{}},
    listQuizzes:async()=>fs.readdirSync(DIR).filter(f=>f.endsWith('.json')).map(f=>rj(path.join(DIR,f),null)).filter(x=>x&&x.questions).sort((a,b)=>b.created-a.created),
    putBlob:async(k,o)=>{fs.mkdirSync(path.join(DIR,'blobs'),{recursive:true});fs.writeFileSync(path.join(DIR,'blobs',safe(k)+'.json'),JSON.stringify(o))},
    getBlob:async k=>rj(path.join(DIR,'blobs',safe(k)+'.json'),null),
    delBlobs:async pre=>{try{for(const f of fs.readdirSync(path.join(DIR,'blobs')))if(f.startsWith(safe(pre)))fs.unlinkSync(path.join(DIR,'blobs',f))}catch{}},
    sweepBlobs:async()=>{try{const d=path.join(DIR,'blobs');for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(Date.now()-fs.statSync(p).mtimeMs>864e5)fs.unlinkSync(p)}}catch{}},
    getAttempts:async id=>rj(af(id),[]),
    getAttempt:async(id,aid)=>rj(af(id),[]).find(x=>x.id===aid)||null,
    putAttempt:async(id,a)=>{const r=rj(af(id),[]),i=r.findIndex(x=>x.id===a.id);i<0?r.push(a):r[i]=a;fs.writeFileSync(af(id),JSON.stringify(r))},
    delAttempt:async(id,aid)=>fs.writeFileSync(af(id),JSON.stringify(rj(af(id),[]).filter(x=>x.id!==aid)))};
}

// ---------- app ----------
const app=express(),up=multer({storage:multer.memoryStorage(),limits:{fileSize:MAXMB*1e6}});
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((q,s,n)=>{s.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'});n()});
app.use(express.json({limit:'4mb'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:'5m',setHeaders:(r,f)=>{if(f.endsWith('.html'))r.setHeader('Cache-Control','no-cache')}}));
app.use('/api',(q,s,n)=>{s.set('Cache-Control','no-store');n()});

// small in-memory rate limiter (per instance; good enough to blunt brute force and spam)
const hits=new Map();
const limit=(key,max,ms)=>{const now=Date.now(),h=(hits.get(key)||[]).filter(t=>now-t<ms);h.push(now);hits.set(key,h);if(hits.size>5000)for(const[k,v]of hits)if(!v.length||now-v[v.length-1]>ms)hits.delete(k);return h.length>max};
const same=(a,b)=>{const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
const w=f=>(q,s)=>f(q,s).catch(e=>s.status(500).json({error:e.message}));
// the page sends the password URL-encoded (header values must be latin-1); accept raw or encoded
const isAdmin=q=>{const raw=String(q.get('x-admin')||'').trim();let dec=raw;try{dec=decodeURIComponent(raw)}catch{}return same(cleanPw(dec),PW)||same(cleanPw(raw),PW)};
const auth=(q,s,n)=>{
  if(isAdmin(q))return n();
  if(limit('auth:'+q.ip,20,10*60e3))return s.status(429).json({error:'Too many attempts - wait a few minutes'});
  s.status(401).json({error:'Wrong admin password'});
};
const expired=x=>x.expires&&x.expires<Date.now();
const clip=(v,n)=>String(v||'').trim().slice(0,n);

app.get('/api/health',(q,s)=>s.json({storage:store.mode,temporary:store.mode==='file'&&VERCEL,maxMB:MAXMB,defaultPassword:!process.env.ADMIN_PASSWORD}));

// password check only - never touches storage, so login works even if the database is misconfigured
app.get('/api/auth',auth,(q,s)=>s.json({ok:1}));

app.post('/api/upload',auth,up.single('file'),w(async(q,s)=>{
  if(VERCEL&&store.mode!=='supabase')return s.status(500).json({error:'Database not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars and redeploy. Without it quiz links break ("Quiz not found").'});
  if(!q.file)return s.status(400).json({error:'No file'});
  const name=q.file.originalname;let questions;
  try{questions=await parseFile(q.file.buffer,path.extname(name).toLowerCase())}catch(e){return s.status(400).json({error:e.message})}
  const quiz={id:crypto.randomBytes(5).toString('hex'),title:name.replace(/\.\w+$/,''),shuffle:false,expires:null,questions,created:Date.now()};
  await store.putQuiz(quiz);s.json({...quiz,report:require('./parser').report(questions)});
}));

// ---------- chunked upload (a PDF over ~4 MB cannot be sent in one request on Vercel) + resumable OCR ----------
const CHUNK_MAX=3.2e6,uid=v=>/^[a-f0-9]{8,32}$/.test(String(v||''))?String(v):null;
app.post('/api/upload/chunk',auth,express.raw({type:()=>true,limit:'3.5mb'}),w(async(q,s)=>{
  const id=uid(q.query.id),i=parseInt(q.query.i,10),n=parseInt(q.query.n,10);
  if(!id||!(i>=0)||!(n>=1)||n>40||i>=n)return s.status(400).json({error:'Bad upload request'});
  if(!Buffer.isBuffer(q.body)||!q.body.length)return s.status(400).json({error:'Empty chunk'});
  if(q.body.length>CHUNK_MAX)return s.status(413).json({error:'Chunk too large'});
  if(i===0)store.sweepBlobs().catch(()=>{});
  await store.putBlob(id+'c'+i,{b:q.body.toString('base64')});s.json({ok:1});
}));
app.post('/api/upload/finish',auth,w(async(q,s)=>{
  const t0=Date.now(),id=uid(q.body&&q.body.id),n=parseInt(q.body&&q.body.n,10),name=clip(q.body&&q.body.name,200)||'quiz.pdf';
  if(!id||!(n>=1)||n>40)return s.status(400).json({error:'Bad upload request'});
  if(VERCEL&&store.mode!=='supabase')return s.status(500).json({error:'Database not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars and redeploy.'});
  const parts=[];
  for(let i=0;i<n;i++){const c=await store.getBlob(id+'c'+i);if(!c||!c.b)return s.status(400).json({error:'Upload incomplete (part '+(i+1)+' of '+n+' is missing) - please upload again'});parts.push(Buffer.from(c.b,'base64'))}
  const buf=Buffer.concat(parts),ext=path.extname(name).toLowerCase();
  const prog=await store.getBlob(id+'ocr');
  // text drawn as outlines needs OCR; do it in time-boxed passes and let the page call us again until it is finished
  const opts={ocr:(prog&&prog.ocr)||{},state:{pending:0,ocrPages:0},workers:+process.env.OCR_WORKERS||(VERCEL?2:1),deadline:t0+(+process.env.OCR_DEADLINE_MS||(VERCEL?38e3:6e5))};
  let questions;
  try{questions=await parseFile(buf,ext,opts)}catch(e){await store.delBlobs(id).catch(()=>{});return s.status(400).json({error:e.message})}
  if(opts.state.pending>0){
    await store.putBlob(id+'ocr',{ocr:opts.ocr});
    return s.json({pending:true,done:Object.keys(opts.ocr).length,remaining:opts.state.pending});
  }
  const quiz={id:crypto.randomBytes(5).toString('hex'),title:name.replace(/\.\w+$/,''),shuffle:false,expires:null,questions,created:Date.now()};
  await store.putQuiz(quiz);store.delBlobs(id).catch(()=>{});
  s.json({...quiz,report:require('./parser').report(questions)});
}));
app.get('/api/quizzes',auth,w(async(q,s)=>s.json((await store.listQuizzes()).map(x=>({id:x.id,title:x.title,count:x.questions.length,created:x.created,expires:x.expires||null})))));
app.get('/api/quiz/:id',w(async(q,s)=>{
  if(VERCEL&&store.mode!=='supabase')return s.status(500).json({error:'Server storage is not configured (Supabase env vars missing)'});
  const x=await store.getQuiz(q.params.id);if(!x)return s.status(404).json({error:'Not found'});
  if(expired(x)&&!isAdmin(q))return s.status(410).json({error:'expired',title:x.title,expires:x.expires});
  s.json(x);
}));
app.put('/api/quiz/:id',auth,w(async(q,s)=>{
  const o=await store.getQuiz(q.params.id);if(!o)return s.status(404).end();const b=q.body;
  o.title=String(b.title||o.title);o.shuffle=!!b.shuffle;o.expires=b.expires&&+b.expires?+b.expires:null;
  if(!Array.isArray(b.questions)||!b.questions.length)return s.status(400).json({error:'A quiz needs at least one question'});
  o.title=clip(o.title,120)||'Untitled quiz';
  o.questions=b.questions.map(x=>{
    const options=Array.isArray(x&&x.options)?x.options.map(v=>String(v)):[],answer=Number.isInteger(+x.answer)?+x.answer:-1;
    return{q:String(x.q||'').trim(),options,answer:answer>=0&&answer<options.length?answer:-1,warn:''}});
  if(o.questions.some(x=>!x.q||x.options.length<2))return s.status(400).json({error:'Every question needs text and at least 2 options'});
  await store.putQuiz(o);s.json(o);
}));
app.delete('/api/quiz/:id',auth,w(async(q,s)=>{await store.delQuiz(q.params.id);s.json({ok:1})}));

app.post('/api/quiz/:id/attempt',w(async(q,s)=>{
  const z=await store.getQuiz(q.params.id);if(!z)return s.status(404).end();
  if(expired(z))return s.status(410).json({error:'This quiz link has expired'});
  if(limit('att:'+q.ip,60,10*60e3))return s.status(429).json({error:'Too many attempts - try again shortly'});
  const name=clip(q.body.name,60),group=clip(q.body.group,60);
  if(!name||!group)return s.status(400).json({error:'Name and group required'});
  const a={id:crypto.randomBytes(6).toString('hex'),name,group,start:Date.now(),rounds:[],done:false};
  await store.putAttempt(z.id,a);s.json({id:a.id});
}));
app.post('/api/quiz/:id/attempt/:aid',w(async(q,s)=>{
  const z=await store.getQuiz(q.params.id),a=z&&await store.getAttempt(q.params.id,q.params.aid);
  if(!z||!a)return s.status(404).end();const b=q.body;
  if(Array.isArray(b.fix)){a.fixed=[...new Set([...(a.fixed||[]),...b.fix.map(Number).filter(i=>z.questions[i])])];await store.putAttempt(z.id,a);return s.json({ok:1})}
  if(a.rounds.length>=50)return s.status(400).json({error:'Too many rounds'});
  a.rounds.push({ok:+b.ok||0,total:+b.total||0,t:Date.now(),mode:clip(b.mode,6),secs:+b.secs||0,
    wrong:(b.wrong||[]).map(Number).filter(i=>z.questions[i]).map(i=>({i,q:z.questions[i].q.slice(0,160)}))});
  if(b.done){a.done=true;a.end=Date.now()}
  await store.putAttempt(z.id,a);s.json({ok:1});
}));
// student dashboard (public): all students' progress per quiz - name, group and counts only
app.get('/api/students/quizzes',w(async(q,s)=>s.json((await store.listQuizzes()).map(x=>({id:x.id,title:x.title,count:x.questions.length})))));
app.get('/api/students/:id',w(async(q,s)=>{
  if(limit('stu:'+q.ip,120,10*60e3))return s.status(429).json({error:'Too many requests - try again shortly'});
  const z=await store.getQuiz(q.params.id);if(!z)return s.status(404).json({error:'Not found'});
  const M=new Map();
  (await store.getAttempts(z.id)).forEach(a=>{const k=(a.name+'|'+a.group).toLowerCase(),o=M.get(k)||{name:a.name,group:a.group,att:0,ok:0,cover:0,done:false,last:0};
    (a.rounds||[]).forEach(r=>{o.att+=r.total||0;o.ok+=r.ok||0;o.cover=Math.max(o.cover,r.total||0)});
    o.done=o.done||!!a.done;o.last=Math.max(o.last,a.end||a.start||0);M.set(k,o)});
  s.json({id:z.id,title:z.title,total:z.questions.length,students:[...M.values()].sort((a,b)=>b.last-a.last)});
}));
app.get('/api/quiz/:id/results',auth,w(async(q,s)=>s.json(await store.getAttempts(q.params.id))));
app.delete('/api/quiz/:id/results/:aid',auth,w(async(q,s)=>{await store.delAttempt(q.params.id,q.params.aid);s.json({ok:1})}));
app.get(['/students','/students/'],(q,s)=>s.sendFile(path.join(__dirname,'public','students.html')));
app.get('/',(q,s)=>s.sendFile(path.join(__dirname,'public','index.html')));
app.get(['/q/:id','/q/:id/'],(q,s)=>s.sendFile(path.join(__dirname,'public','quiz.html')));
app.use('/api',(q,s)=>s.status(404).json({error:'Not found'}));
app.use((e,q,s,n)=>s.status(400).json({error:e.code==='LIMIT_FILE_SIZE'?'File too large (max '+MAXMB+' MB)':e.message}));

module.exports=app;
if(require.main===module){const P=process.env.PORT||3000;app.listen(P,()=>console.log('Brainstorm v2 running on http://localhost:'+P+'  (admin: /admin.html, storage: '+store.mode+')'))}
