// Brainstorm MCQ parser v2 - PDF/DOCX -> questions.
// Answer = highlight (vector rect OR annotation), bold, *, ✓, "(correct)", or "Answer: B".
const JSZip=require('jszip');
const CYR={'а':'a','с':'c','е':'e','А':'A','В':'B','С':'C','Е':'E','Н':'H'};
const norm=t=>[...t].map(c=>CYR[c]||c).join('');
const LET='abcdefgh';
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const MKG=/(\*+|★|✓|✔|☑|✅|\((?:correct|ans|right)\)|\[(?:correct|ans|right)\]|\*\*)/gi;
// blank out marker symbols (same length, so indexes stay aligned) and report where they were.
// A '*' between two letters/digits (2*3, x*y) is NOT a marker.
function stars(t){
  const pos=[],len=[];let out='';
  const re=/\*+|★|✓|✔|☑|✅|\((?:correct|ans|right)\)|\[(?:correct|ans|right)\]/gi;let last=0,m;
  while((m=re.exec(t))){
    const a=m.index,b=a+m[0].length;
    if(m[0][0]==='*'&&/[\p{L}\p{N}]/u.test(t[a-1]||' ')&&/[\p{L}\p{N}]/u.test(t[b]||' ')){continue}
    out+=t.slice(last,a)+' '.repeat(m[0].length);pos.push(a);len.push(b-a);last=b;
  }
  return{mk:out+t.slice(last),pos,len};
}
const ANS=/^\s*(?:correct\s+)?(?:answer|ans)\s*[:\-.]?\s*\(?([A-Ha-h])\b/i;
const OPT=/^\s*\(?([A-Ha-h])\s?[.):]\s*(?=\S)/;

// ---------- DOCX -> lines {pg,t,f[]} ----------
async function docxLines(buf){
  const z=await JSZip.loadAsync(buf),f=z.file('word/document.xml');
  if(!f)throw new Error('Invalid .docx file');
  const xml=await f.async('string'),out=[];
  const push=cur=>{out.push({pg:1,t:cur.t,f:cur.f,auto:cur.auto,lvl:cur.lvl})};
  for(const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[]){
    const nm=p.match(/<w:numPr>[\s\S]*?<w:ilvl w:val="(\d+)"/);
    let cur={t:'',f:[],auto:/<w:numPr>/.test(p),lvl:nm?+nm[1]:0};
    for(const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g)||[]){
      const rp=(r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)||[''])[0];
      const hl=/<w:highlight w:val="(?!none)/.test(rp)||/<w:shd [^>]*w:fill="(?!auto|FFFFFF|ffffff)/.test(rp);
      const bd=/<w:b(?: w:val="(?:1|true|on)")?\s*\/>/.test(rp)||/<w:rStyle w:val="(?:Strong|Bold)[^"]*"/i.test(rp);
      const b=hl?'h':bd?'b':false;
      for(const m of r.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br[^>]*\/>|<w:tab\/>/g)){
        if(m[0].startsWith('<w:br')){push(cur);cur={t:'',f:[],auto:false,lvl:0}}
        else{const s=m[1]!==undefined?dec(m[1]):' ';for(const ch of s){cur.t+=ch;cur.f.push(b)}}
      }
    }
    push(cur);
  }
  return out;
}

// ---------- PDF -> lines; flag = covered by highlight rect (any non-white/non-black fill), annotation or bold font ----------
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];
function isHL(c){ // c = [r,g,b] 0..255. highlight colours: saturated & light (cyan, yellow, green, pink, orange...)
  const [r,g,b]=c,mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  return mx>=150&&(mx-mn)>=90;
}
async function pageRects(pg,OPS){
  const ol=await pg.getOperatorList(),rects=[];
  let ctm=[1,0,0,1,0,0],st=[],fill=[0,0,0];
  for(let i=0;i<ol.fnArray.length;i++){
    const fn=ol.fnArray[i],a=ol.argsArray[i];
    if(fn===OPS.save)st.push([ctm.slice(),fill.slice()]);
    else if(fn===OPS.restore){const s=st.pop();if(s){ctm=s[0];fill=s[1]}}
    else if(fn===OPS.transform)ctm=mul(ctm,a);
    else if(fn===OPS.setFillRGBColor)fill=[a[0],a[1],a[2]];
    else if(fn===OPS.constructPath){
      const ops=a[0],co=a[1];let ci=0;
      const isFill=true; // decided on following paint op, we simply record; painting ops follow immediately
      const local=[];
      for(const o of ops){
        if(o===OPS.rectangle){const x=co[ci],y=co[ci+1],w=co[ci+2],h=co[ci+3];ci+=4;local.push([x,y,w,h])}
        else if(o===OPS.moveTo||o===OPS.lineTo)ci+=2;
        else if(o===OPS.curveTo)ci+=6;else if(o===OPS.curveTo2||o===OPS.curveTo3)ci+=4;
      }
      // look ahead to the paint operator
      const nx=ol.fnArray[i+1];
      const paints=[OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke];
      if(paints.includes(nx)&&isHL(fill))for(const [x,y,w,h] of local){
        const p1=[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]],p2=[ctm[0]*(x+w)+ctm[2]*(y+h)+ctm[4],ctm[1]*(x+w)+ctm[3]*(y+h)+ctm[5]];
        rects.push({x0:Math.min(p1[0],p2[0]),x1:Math.max(p1[0],p2[0]),y0:Math.min(p1[1],p2[1]),y1:Math.max(p1[1],p2[1])});
      }
    }
  }
  return rects;
}

// ---------- underline / pen-mark overlay layers drawn as raster tiles (transparent PNGs) -> thin horizontal strokes ----------
async function pageUnderlines(pg,OPS){
  const ol=await pg.getOperatorList(),segs=[];
  let ctm=[1,0,0,1,0,0],st=[];
  for(let i=0;i<ol.fnArray.length;i++){
    const fn=ol.fnArray[i],a=ol.argsArray[i];
    if(fn===OPS.save)st.push(ctm.slice());
    else if(fn===OPS.restore){const s=st.pop();if(s)ctm=s}
    else if(fn===OPS.transform)ctm=mul(ctm,a);
    else if(fn===OPS.paintImageXObject||fn===OPS.paintInlineImageXObject){
      let img=null;
      try{img=fn===OPS.paintInlineImageXObject?a[0]:await new Promise(r=>{let done=false;const t=setTimeout(()=>{if(!done){done=true;r(null)}},4000);try{pg.objs.get(a[0],o=>{if(!done){done=true;clearTimeout(t);r(o)}})}catch{done=true;clearTimeout(t);r(null)}})}catch{}
      if(!img||!img.data||!img.width||!img.height)continue;
      const W=img.width,H=img.height,d=img.data,ch=img.kind===3?4:img.kind===2?3:0;
      if(!ch||d.length<W*H*ch)continue;
      const ink=new Uint8Array(W*H);let n=0;
      for(let k=0;k<W*H;k++){
        const on=ch===4?d[k*4+3]>40&&(d[k*4]+d[k*4+1]+d[k*4+2])<600:(d[k*3]+d[k*3+1]+d[k*3+2])<480;
        if(on){ink[k]=1;n++}
      }
      if(!n||n>W*H*0.2)continue; // empty, or a normal picture / scan: not a mark layer
      // connected components (4-neighbour, iterative flood fill)
      const seen=new Uint8Array(W*H),stack=[];
      for(let k=0;k<W*H;k++){
        if(!ink[k]||seen[k])continue;
        let x0=W,x1=0,y0=H,y1=0,cnt=0;stack.push(k);seen[k]=1;
        while(stack.length){
          const q=stack.pop(),x=q%W,y=(q-x)/W;cnt++;
          if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
          if(x>0&&ink[q-1]&&!seen[q-1]){seen[q-1]=1;stack.push(q-1)}
          if(x<W-1&&ink[q+1]&&!seen[q+1]){seen[q+1]=1;stack.push(q+1)}
          if(y>0&&ink[q-W]&&!seen[q-W]){seen[q-W]=1;stack.push(q-W)}
          if(y<H-1&&ink[q+W]&&!seen[q+W]){seen[q+W]=1;stack.push(q+W)}
        }
        // image space -> page space (image row 0 is the TOP of the unit square)
        const px=u=>ctm[0]*u+ctm[4],py=v=>ctm[3]*v+ctm[5];
        const X0=px(x0/W),X1=px((x1+1)/W),Ytop=py(1-y0/H),Ybot=py(1-(y1+1)/H);
        const w=Math.abs(X1-X0),h=Math.abs(Ytop-Ybot);
        if(w>=4&&h<=7&&w>=h*2.5)segs.push({x0:Math.min(X0,X1),x1:Math.max(X0,X1),y:(Ytop+Ybot)/2});
      }
    }
  }
  // join pieces that were cut by tile borders
  segs.sort((p,q)=>p.y-q.y||p.x0-q.x0);
  const out=[];
  for(const s of segs){const m=out.find(o=>Math.abs(o.y-s.y)<2.5&&s.x0<=o.x1+3&&s.x1>=o.x0-3);if(m){m.x0=Math.min(m.x0,s.x0);m.x1=Math.max(m.x1,s.x1)}else out.push({...s})}
  // an underline marks the text line sitting just above it
  return out.map(o=>({x0:o.x0-1,x1:o.x1+1,y0:o.y-2,y1:o.y+16}));
}

// OCR helper: returns synthetic text items for stems drawn as outlines on this page
async function outlineStems(pg,OPS,n,opts){
  const OC=require('./outline_ocr'),cache=opts.ocr||(opts.ocr={}),stt=opts.state||(opts.state={pending:0,ocrPages:0});
  if(!cache[n]){
    const gl=await OC.pageGlyphs(pg,OPS),bl=OC.blocks(gl);
    if(!bl.length)cache[n]=[];
    else{
      if(opts.deadline&&Date.now()>opts.deadline){stt.pending++;return[]}
      if(!opts.sch){opts.sch=await OC.makeScheduler(opts.workers||3)}
      const tx=await OC.ocrBlocks(bl,opts.sch);
      cache[n]=bl.map((b,i)=>({x:b.x0,y:b.lines[0].base,w:b.x1-b.x0,h:b.lines[0].h,t:tx[i].t,c:tx[i].c})).filter(o=>o.t);
      stt.ocrPages++;
    }
  }
  const out=[];
  for(const o of cache[n]){
    // drop OCR garbage (e.g. non-Latin headers read with the English model)
    const letters=(o.t.match(/[A-Za-z]/g)||[]).length;
    const bare=/^\s*[0-9OoIlSB]{1,4}\s*[.,)]?\s*$/.test(o.t)&&/\d/.test(o.t); // a lone question number such as "322."
    const words=(o.t.match(/[A-Za-z0-9]{4,}/g)||[]).filter(w=>/[a-z]/.test(w)),odd=words.filter(w=>/[a-z][A-Z]/.test(w)||/[A-Za-z]\d[a-z]|[a-z]\d[A-Za-z]/.test(w)).length;
    if(!bare&&(o.c<85||(words.length&&odd/words.length>=0.3)))continue; // garbage (e.g. Cyrillic read by the English model)
    if(o.c<(opts.minConf||72)||(!bare&&(letters<Math.max(1,o.t.replace(/\s/g,'').length*0.5)||(!/\d/.test(o.t)&&letters<4))))continue;
    // common OCR digit confusions at the start of a numbered stem
    let t=o.t.replace(/^([0-9OoIlSB]{2,4})\s*([.,)])/,(m,d,p)=>/\d/.test(d)?d.replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/S/g,'5').replace(/B/g,'8')+'.':m);
    out.push({s:t,x:o.x,y:o.y,w:o.w,h:o.h||9,bold:false});
  }
  return out;
}
async function pdfLines(buf,opts={}){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:new Uint8Array(buf),useSystemFonts:true,verbosity:0}).promise,out=[];
  for(let n=1;n<=doc.numPages;n++){
    const pg=await doc.getPage(n),tc=await pg.getTextContent();
    let rects=[];try{rects=await pageRects(pg,pdfjs.OPS)}catch{}
    try{rects=rects.concat(await pageUnderlines(pg,pdfjs.OPS))}catch{}
    let an=[];try{an=(await pg.getAnnotations()).filter(a=>/Highlight|Underline|Squiggly/.test(a.subtype)&&a.rect)}catch{}
    // text drawn as vector outlines has no text layer -> rasterise + OCR it (cached per page so work can resume)
    let ocrItems=[];
    try{ocrItems=await outlineStems(pg,pdfjs.OPS,n,opts)}catch(e){console.error('outline OCR failed p'+n+':',e.message)}
    const items=tc.items.filter(i=>i.str&&i.str.length).map(i=>{
      let nm='',fb=false;try{const F=pg.commonObjs.get(i.fontName);nm=(F.name||'')+' '+(F.fallbackName||'');fb=!!(F.bold||F.black)}catch{}
      try{nm+=' '+((tc.styles&&tc.styles[i.fontName]&&tc.styles[i.fontName].fontFamily)||'')}catch{}
      return{s:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.height||i.transform[3]||9),bold:fb||/bold|black|heavy|semibold|demi|[-,]bd\b|-b\b|\bBd[A-Z]?\b/i.test(nm)};
    });
    for(const o of ocrItems)items.push(o);
    // merge in reading order into rows (3pt tolerance), top to bottom
    items.sort((a,b)=>b.y-a.y||a.x-b.x);
    const rows=[];
    for(const it of items){const r=rows[rows.length-1];if(r&&Math.abs(r.y-it.y)<=3)r.items.push(it);else rows.push({y:it.y,items:[it]})}
    for(const r of rows){
      r.items.sort((a,b)=>a.x-b.x);let t='',f=[],prev=null;
      for(const it of r.items){
        if(prev&&it.x-(prev.x+prev.w)>1.2&&!/\s$/.test(prev.s)&&!/^\s/.test(it.s)){t+=' ';f.push(false)}
        const len=it.s.length,cy=it.y+it.h*0.35;
        for(let i=0;i<len;i++){
          const cx=it.x+it.w*(i+0.5)/len;
          const hl=rects.some(q=>cx>=q.x0&&cx<=q.x1&&cy>=q.y0&&cy<=q.y1)||an.some(a=>cx>=a.rect[0]&&cx<=a.rect[2]&&cy>=a.rect[1]&&cy<=a.rect[3]);
          t+=it.s[i];f.push(hl?'h':it.bold?'b':false);
        }
        prev=it;
      }
      // a row holding nothing but a number label (its words are outlines we could not read, e.g. a cover-page list) is noise
      if(t.trim()&&!/^\s*\d{1,3}\s*[.)]?\s*$/.test(t))out.push({pg:n,t,f});
    }
  }
  return out;
}

// ---------- lines -> questions ----------
const hlFrac=(t,f)=>{let n=0,h=0,b=0;for(let i=0;i<t.length;i++)if(t[i].trim()){n++;if(f[i]==='h')h++;else if(f[i]==='b')b++}return{n,h,b}};
function build(lines){
  const latin=lines.join?0:0; let lat=0,all=0;
  for(const L of lines){for(const ch of L.t){if(/[A-Za-z]/.test(ch))lat++;else if(/[А-Яа-я]/.test(ch))all++}}
  const latinDoc=lat>all*4;
  const qs=[];let cur=null,p=0;
  const fin=()=>{if(cur)qs.push(cur);cur=null};
  const addopt=(t,f,star)=>{const{n,h,b}=hlFrac(t,f);cur.o.push({t:t.trim(),h:star?1:(n?h/n:0),b:n?b/n:0,_n:n,_h:star?n:h,_b:b})};
  const dq=lines.map(L=>({pg:L.pg,t:L.t,f:L.f.slice(),auto:L.auto,lvl:L.lvl}));
  while(dq.length){
    let L=dq.shift();let{pg,t,f}=L;
    if(!t.trim())continue;
    if(cur){ // glued next-question number inside a line
      let mm=null;const re=/(?<=\S)\s+(\d{1,3})\s?[.)]\s*(?=[A-Z0-9])/g;let m;
      while((m=re.exec(t))){if(+m[1]===p+1&&m.index>2){mm=m;break}}
      if(mm){const a=mm.index,b=mm.index+mm[0].length-mm[0].trimStart().length;dq.unshift({pg,t:t.slice(b),f:f.slice(b)});dq.unshift({pg,t:t.slice(0,a),f:f.slice(0,a)});continue}
      const mt=t.match(/\S\s+(\d{1,3})\s?\.?\s*$/);
      if(mt&&+mt[1]===p+1&&cur.o.length>=2){const a=mt.index+1;dq.unshift({pg,t:'\x01'+mt[1],f:[],mark:1});dq.unshift({pg,t:t.slice(0,a),f:f.slice(0,a)});continue}
    }
    if(L.mark){fin();p=+t.slice(1);cur={n:p,q:'',qf:[],o:[],pg};continue}
    if(/^\s*\d{1,3}\s*$/.test(t)&&+t===pg)continue;                 // page number
    if(/^\s*Variants? of answers?:?\s*$/i.test(t))continue;
    if(latinDoc&&!/[A-Za-z]/.test(t)&&/[А-Яа-я]/.test(t))continue;   // foreign-language header/footer in a Latin document
    if(/ВСЕГО/.test(t))continue;
    t=t.replace(/\x00/g,'').replace(/\uf0af/g,'');
    let am;
    if(cur&&(am=t.match(ANS))){cur.ans=am[1].toUpperCase().charCodeAt(0)-65;continue}
    // star markers
    const sx=stars(t),mk=sx.mk,star=sx.pos.length>0;
    const nt=norm(mk);
    let om=cur?nt.match(OPT):null;
    if(om||(cur&&L.auto&&L.lvl>0)){
      const off=om?om[0].length:0,lab=om?om[1].toLowerCase():null,rest=nt.slice(off),body=mk.slice(off),bf=f.slice(off);
      const cuts=[];let exp=lab?LET.indexOf(lab)+1:cur.o.length+1,i=0;
      while(exp<8){const L2=LET[exp];const re=new RegExp('(?:(?<=\\s)|(?<=[A-Za-z;,]))['+L2+L2.toUpperCase()+']\\s?[.)]\\s*','g');re.lastIndex=i;const m=re.exec(rest);if(!m)break;
        if(/[A-Za-z]/.test(rest[m.index-1]||'')&&m[0].trim().slice(-1)==='.')break;
        cuts.push([m.index,m.index+m[0].length]);i=m.index+m[0].length;exp++}
      if(cuts.length){const starts=[0,...cuts.map(c=>c[1])],ends=[...cuts.map(c=>c[0]),rest.length];
        // a marker belongs to the option it sits in; one touching the next label ("*b) ...") belongs to that option
        const hit=new Set(sx.pos.map((q,si)=>{const rel=q-off,e=rel+sx.len[si];let k=0;for(let z=0;z<cuts.length;z++)if(cuts[z][0]<=rel)k=z+1;
          if(k<cuts.length&&e===cuts[k][0])k++;return k}));
        starts.forEach((s,k)=>addopt(body.slice(s,ends[k]),bf.slice(s,ends[k]),hit.has(k)))}
      else addopt(body,bf,star);
      continue;
    }
    // question start?
    const qm=t.match(/^\s*(?:Q(?:uestion)?\.?\s*)?(\d{1,3})\s*([.):\-]?)\s*(?=\S)/i);
    let isq=false,rem='',n=0;
    if(qm){
      n=+qm[1];const sep=qm[2];rem=t.slice(qm[0].length);
      const alpha=/^[A-Za-zА-Яа-я«“"(]/.test(rem)||(sep!==''&&n===p+1&&/^\d/.test(rem));
      if(alpha&&!/^(minutes?|hours?|hrs?|days?|weeks?|years?|mg|g\b|ml|mmol|%|µ|mcg|points?)/i.test(rem)){
        let ok=!cur||cur.o.length>=2;
        if(cur&&cur.o.length<2&&!/[?:]\s*$/.test(cur.q))ok=(n===p+1&&sep!=='');
        if(sep===''&&!/[A-ZА-Я]/.test(rem[0]))ok=false;
        if(sep!==''&&/[a-zа-я]/.test(rem[0])&&n<=9)ok=false;
        if(n<=5&&n!==p+1)ok=false;
        isq=ok;
      }
    }
    if(isq){fin();p=n;cur={n,q:rem.trim(),qf:f.slice(qm[0].length),o:[],pg};continue}
    const tt=t.replace(/\s+/g,' ').trim();
    if(!cur){cur={n:p+1,q:tt,qf:f.slice(),o:[],pg};continue}
    if(cur.o.length>=2&&/[?:]\s*$/.test(tt)&&!/\?$/.test(cur.o[cur.o.length-1].t)&&tt.length>25&&!OPT.test(norm(tt))){fin();p++;cur={n:p,q:tt,qf:f.slice(),o:[],pg,unnum:1};continue}
    if(cur.o.length){const o=cur.o[cur.o.length-1];o.t+=' '+tt;const{n:nn,h,b}=hlFrac(t,f);o._n+=nn;o._h+=star?nn:h;o._b+=b;o.h=o._n?o._h/o._n:0;o.b=o._n?o._b/o._n:0}
    else{cur.q+=' '+tt;cur.qf.push(false,...f)}
  }
  fin();
  return qs;
}

// ---------- STRICT line-structured parser (v3) ----------
// For documents where every question starts a line ("N. text" / "N) text") and every option starts a line
// ("1) x" / "A. x"). Options are accepted ONLY in sequence (1,2,3,... / a,b,c,...), which removes the
// ambiguity between option numbers and question numbers, keeps duplicate/skipped question numbers,
// never lets one question swallow the next, and never splits decimals such as "INR 2.5-3.5".
const LAB=/^\s*[(\[]?([1-8]|[A-Ha-h])\s?[.):\]]\s*(?=\S)/;
const labIdx=c=>/\d/.test(c)?+c:c.toLowerCase().charCodeAt(0)-96;
const HEAD=/^\s*(?:revised\b|part\s*\d|questions?\s+\d+\s*[\u2013\u2014-]\s*\d+|test\s*bank|answers?\s+key|\u0432\u0441\u0435\u0433\u043e)/i;
function buildStrict(lines){
  let lat=0,cyr=0;for(const L of lines){for(const ch of L.t){if(/[A-Za-z]/.test(ch))lat++;else if(/[\u0410-\u044f]/.test(ch))cyr++}}
  const latinDoc=lat>cyr*4;
  const qs=[];let cur=null,p=0;
  const fin=()=>{if(cur)qs.push(cur);cur=null};
  const addopt=(t,f,star)=>{const{n,h,b}=hlFrac(t,f);cur.o.push({t:t.trim(),h:star?1:(n?h/n:0),b:n?b/n:0,_n:n,_h:star?n:h,_b:b})};
  for(let li=0;li<lines.length;li++){
    const L=lines[li];
    let t=L.t.replace(/\x00/g,'').replace(/\uf0af/g,'').replace(/\u00a0/g,' ');let f=L.f.slice(0,t.length);const pg=L.pg;
    if(!t.trim())continue;
    if(/^\s*\+\s*$/.test(t))continue;                                   // reviewer's red "+" glyph on its own line
    t=t.replace(/^(\s*)\+\s+(?=\S)/,'$1');t=t.replace(/\s+\+\s*$/,'');f=f.slice(0,t.length);
    if(/^\s*\d{1,3}\s*$/.test(t)&&+t===pg)continue;                      // page number
    if(/^\s*Variants? of answers?:?\s*$/i.test(t))continue;
    if(latinDoc&&!/[A-Za-z]/.test(t)&&/[\u0410-\u044f]/.test(t))continue; // foreign-language note/header in a Latin document
    if(HEAD.test(t)&&!(cur&&cur.o.length===0&&LAB.test(norm(t))))continue;
    let am;if(cur&&(am=t.match(ANS))){cur.ans=am[1].toUpperCase().charCodeAt(0)-65;continue}
    let sx=stars(t),mk=sx.mk,nt=norm(mk);
    let lm=cur?nt.match(LAB):null;
    if(L.auto&&!/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[.):]/.test(nt)&&!lm){        // Word auto-numbering: the number is not in the text
      if(L.lvl>0&&cur){const k=cur.o.length+1,pre=String.fromCharCode(96+k)+') ';t=pre+t;f=[...pre].map(()=>false).concat(f);sx=stars(t);mk=sx.mk;nt=norm(mk);lm=nt.match(LAB)}
      else if(L.lvl===0){const pre=(p+1)+'. ';t=pre+t;f=[...pre].map(()=>false).concat(f);sx=stars(t);mk=sx.mk;nt=norm(mk)}
    }
    // ---- option line (strictly the next label in sequence)
    const asQuestion=()=>{ // line is the next-in-sequence option label AND the next question number: decide by lookahead
      if(!lm||cur.o.length<2)return false;
      const n=labIdx(lm[1]);
      if(!/\d/.test(lm[1])||n!==p+1)return false;
      for(let k=li+1;k<Math.min(lines.length,li+5);k++){ // first following label line: restarts at 1 => this was a question stem
        const nk=norm(lines[k].t),m=nk.match(LAB);
        if(!m){if(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[.):]\s*\S/i.test(nk))return false;continue}   // a question follows => this line was an option
        const j=labIdx(m[1]);if(j===1)return true;if(j===n+1)return false;break;
      }
      const rest0=nt.slice(lm[0].length),lt=rest0.replace(/[^A-Za-z]/g,'');
      const upper=lt.length>=10&&(lt.replace(/[^A-Z]/g,'').length/lt.length)>0.7;
      const dl=(lm[0].match(/[.):\]]/)||[''])[0];
      return upper||!!(cur.dl&&dl!==cur.dl);
    };
    if(lm&&labIdx(lm[1])===cur.o.length+1&&cur.o.length<8&&!asQuestion()){
      if(!cur.o.length)cur.dl=(lm[0].match(/[.):\]]/)||[''])[0];
      const off=lm[0].length,rest=nt.slice(off),body=mk.slice(off),bf=f.slice(off);
      const num=/\d/.test(lm[1]);let exp=labIdx(lm[1])+1,i=0;const cuts=[];
      while(exp<=8){
        const ch=num?String(exp):String.fromCharCode(96+exp);
        const re=new RegExp('(?<=\\s)'+(num?ch:'['+ch+ch.toUpperCase()+']')+'\\s?[.)]\\s+(?=\\S)','g');re.lastIndex=i;
        const m=re.exec(rest);if(!m)break;cuts.push([m.index,m.index+m[0].length]);i=m.index+m[0].length;exp++;
      }
      const starts=[0,...cuts.map(c=>c[1])],ends=[...cuts.map(c=>c[0]),rest.length];
      const hit=new Set(sx.pos.map((q,si)=>{const rel=q-off;let k=0;for(let z=0;z<cuts.length;z++)if(cuts[z][0]<=rel)k=z+1;return k}));
      starts.forEach((s0,k)=>addopt(body.slice(s0,ends[k]),bf.slice(s0,ends[k]),hit.has(k)));
      continue;
    }
    // ---- question start
    const qm=t.match(/^\s*(?:Q(?:uestion)?\.?\s*)?(\d{1,3})\s*([.):\-]?)\s*(?=\S)/i);
    if(qm){
      const n=+qm[1],sep=qm[2],rem=t.slice(qm[0].length);
      const looksQ=(/^[A-Za-z\u0410-\u044f\u00ab\u201c"(]/.test(rem)&&(sep!==''||/^[A-Z\u0410-\u042f]/.test(rem)))
                   &&!/^(minutes?|hours?|hrs?|days?|weeks?|years?|mg|g\b|ml|mmol|%|\u00b5|mcg|points?)/i.test(rem);
      let ok=looksQ;
      if(ok&&cur){
        if(cur.o.length<2){ok=(n===p+1||n===p||(n===1&&p>1))&&(sep!==''||n===p+1)}       // unfinished question: only a clear next number starts a new one
        else if(n<=8&&n===cur.o.length+1&&!asQuestion())ok=false;                                       // would be the next option, handled above
      }
      if(ok){fin();p=n;cur={n,q:rem.trim(),qf:f.slice(qm[0].length),o:[],pg};continue}
    }
    const tt=t.replace(/\s+/g,' ').trim();
    if(!cur)continue;                                                     // text before the first numbered question (cover page etc.)
    if(cur.o.length===0){cur.q+=' '+tt;cur.qf.push(false,...f);continue}
    // heading / stray ALL-CAPS line after the options -> not part of the last option
    if(tt.length>12&&!/[a-z]/.test(tt)&&/[A-Z]{3}/.test(tt)&&!/^[a-z(]/.test(tt))continue;
    const o=cur.o[cur.o.length-1],{n:nn,h,b}=hlFrac(t,f);o.t+=' '+tt;o._n+=nn;o._h+=h;o._b+=b;o.h=o._n?o._h/o._n:0;o.b=o._n?o._b/o._n:0;
  }
  fin();
  return qs;
}

// Answer key at the end of a document ("Answers: 1-B 2-C", "1. B", "1) b", tables flattened to "1 B"): fills questions that have no mark.
function applyKey(lines,qs){
  const key={};let hits=0;
  for(const L of lines){
    const t=norm(L.t).replace(/\s+/g,' ').trim();
    if(/^(?:answers?|key|answer key)\b/i.test(t)||/^(?:\d{1,3}\s*[-.):=\u2013]?\s*[A-Ea-e]\b[\s,;]*){3,}$/.test(t)){
      for(const m of t.matchAll(/(?<![\w])(\d{1,3})\s*[-.):=\u2013]?\s*\(?([A-Ea-e])\)?(?![\w])/g)){key[+m[1]]=m[2].toUpperCase().charCodeAt(0)-65;hits++}
    }
  }
  if(hits<3)return qs;
  for(const q of qs)if(q.answer<0&&key[q.n]!=null&&key[q.n]<q.options.length){q.answer=key[q.n];q.src='key';q.warn=''}
  return qs;
}
// quality score: reward questions with 2-6 options, punish merged (>6) or empty ones
function quality(rs){let s=0;for(const q of rs){const k=q.options.length;if(k>=2&&k<=6)s+=1;else s-=5;if(k>=2&&k<=6&&q.answer<0)s-=0.2}return s}

// options written inside the question text:  "... a) x b) y c) z"  /  "1) x 2) y"
function splitStem(q){
  const t=norm(q.q);
  const re=/(?:(?<=\s)|(?<=[A-Za-z;,.?:\/\-–—])|^)(?:([A-Ea-e])\s?[.)]|([1-8])\s?[.)])\s*(?=\S)/g;
  const ms=[];let m;while((m=re.exec(t)))ms.push(m);
  for(const fam of [1,2]){
    const sel=ms.filter(m=>m[fam]&&!(m[0].trim().slice(-1)==='.'&&m.index>0&&/[A-Za-z]/.test(t[m.index-1])));
    const k=sel.findIndex(m=>['a','1'].includes(m[fam].toLowerCase()));
    if(k>=0&&sel.length-k>=2){
      const s=sel.slice(k),segs=[];
      s.forEach((m,i)=>{const st=m.index+m[0].length,e=i+1<s.length?s[i+1].index:q.q.length;
        const txt=q.q.slice(st,e),{n,h,b}=hlFrac(txt,q.qf.slice(st,e));
        segs.push({t:txt.trim().replace(/[\s,;\/]+$/,''),h:n?h/n:0,b:n?b/n:0})});
      return{stem:q.q.slice(0,s[0].index).trim().replace(/[\s\/]+$/,''),segs};
    }
  }
  return null;
}
function pickBy(hs,bold){
  if(!hs.length||!hs.some(h=>h>0))return null;
  if(bold&&hs.length>1&&hs.every(h=>h>0))return null;          // every option bold = plain formatting, not a mark
  const cand=hs.map((h,i)=>h>=0.4?i:-1).filter(i=>i>=0);
  if(cand.length===1)return{a:cand[0],w:''};
  if(cand.length>1){const top=hs.map((h,i)=>[h,i]).sort((x,y)=>y[0]-x[0]);
    if(top[0][0]-top[1][0]>=0.3)return{a:top[0][1],w:''};
    return{a:cand[0],w:'Multiple answers marked - verify (options '+cand.map(i=>String.fromCharCode(65+i)).join(', ')+')'}}
  const best=Math.max(...hs),nz=hs.filter(h=>h>0);
  if(nz.length===1)return{a:hs.indexOf(best),w:''};                 // only one option carries any mark (even a short stroke)
  if(best>0.15)return{a:hs.indexOf(best),w:'Weak answer mark - verify'};
  return null;
}
function pick(o){
  if(!o.length)return{a:-1,w:'No options detected'};
  return (r=>r&&{...r,src:'mark'})(pickBy(o.map(x=>x.h||0),false))||(r=>r&&{...r,src:'bold'})(pickBy(o.map(x=>x.b||0),true))||{a:-1,w:'No answer detected - select the correct one'};
}
function finish(qs){
  const res=[];
  for(const q of qs){
    if(q.o.length<2){const s=splitStem(q);if(s){q.q=s.stem;q.o=s.segs}}
    else if(q.o.length<=3){const s=splitStem(q);if(s&&s.segs.length===2){q.q=s.stem;q.o=[...s.segs,...q.o]}} // a) b) inline in the stem, c) d) on the next lines
    // lone-numbered option list whose first "1." was lost:  "Thyroidectomy 2. X 3. Y 4. Z"
    if(q.o.length===1){const m=q.o[0].t.split(/\s(?=[2-8]\s?\.\s)/);if(m.length>=3){q.o=m.map(s=>({t:s.replace(/^[2-8]\s?\.\s*/,'').trim(),h:0,b:0}))}}
    if(q.o.length<2)continue;
    let a=-1,w='',src='';
    if(q.ans!=null&&q.ans>=0&&q.ans<q.o.length){a=q.ans;src='line'}else{const r=pick(q.o);a=r.a;w=r.w;src=r.src||''}
    res.push({q:q.q.replace(/\s+/g,' ').trim(),options:q.o.map(o=>o.t),answer:a,warn:w,src,n:q.n,pg:q.pg});
  }
  return res;
}
// opts (PDF only): {ocr:{page:[...]} resumable OCR cache, deadline:ms timestamp, state:{pending,ocrPages}}.
// If time runs out before every outlined page is OCR'd, opts.state.pending>0 and [] is returned: call again with the same opts.ocr.
async function parseFile(buf,ext,opts={}){
  let lines=null;
  if(ext==='.pdf'){try{lines=await pdfLines(buf,opts)}finally{if(opts.sch){try{await opts.sch.terminate()}catch{}opts.sch=null}}if(opts.state&&opts.state.pending)return[]}
  else if(ext==='.docx')lines=await docxLines(buf);
  if(!lines)throw new Error('Only .pdf and .docx files are supported');
  // run both strategies and keep the one that produces the cleaner result (more well-formed questions, fewer merged ones)
  const a=finish(buildStrict(lines)),b=finish(build(lines));
  const qs=applyKey(lines,quality(a)>quality(b)?a:b);
  if(!qs.length)throw new Error('No MCQs found. Questions should look like "1. Text" with options "A. ...", "B. ...", or "1) ...", "2) ..."');
  return qs;
}
module.exports={pdfLines,parseFile,build:(l)=>finish(build(l)),buildStrict:(l)=>finish(buildStrict(l)),quality};

// Self-check report: call after parseFile to see anything suspicious (used by selftest.js, safe to show in admin).
module.exports.report=function(qs){
  const nums=qs.map(q=>q.n).filter(Number.isFinite),max=Math.max(0,...nums),seen={},dups=[],missing=[];
  nums.forEach(n=>{seen[n]=(seen[n]||0)+1;if(seen[n]===2)dups.push(n)});
  for(let i=1;i<=max;i++)if(!seen[i])missing.push(i);
  return{total:qs.length,highestNumber:max,missingNumbers:missing,duplicateNumbers:dups,
    moreThan6Options:qs.filter(q=>q.options.length>6).map(q=>q.n),
    lessThan4Options:qs.filter(q=>q.options.length<4).map(q=>q.n+':'+q.options.length),
    noAnswer:qs.filter(q=>q.answer<0).map(q=>q.n)};
};
