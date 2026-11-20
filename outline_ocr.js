// Text that a PDF draws as vector OUTLINES (no text layer) is invisible to getTextContent().
// We collect glyph-sized filled paths, rasterise each text block ourselves (no native canvas needed) and OCR it.
const zlib=require('zlib'),path=require('path');
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];

// glyph-like filled paths on one page -> [{x0,x1,y0,y1,polys:[[x,y,...]],eo}]
async function pageGlyphs(pg,OPS){
  const ol=await pg.getOperatorList(),out=[];
  let ctm=[1,0,0,1,0,0],st=[];
  const paints={[OPS.fill]:0,[OPS.eoFill]:1,[OPS.fillStroke]:0,[OPS.eoFillStroke]:1,[OPS.closeFillStroke]:0,[OPS.closeEOFillStroke]:1};
  for(let i=0;i<ol.fnArray.length;i++){
    const fn=ol.fnArray[i],a=ol.argsArray[i];
    if(fn===OPS.save)st.push(ctm.slice());
    else if(fn===OPS.restore){const s=st.pop();if(s)ctm=s}
    else if(fn===OPS.transform)ctm=mul(ctm,a);
    else if(fn===OPS.constructPath){
      const nx=ol.fnArray[i+1];if(!(nx in paints))continue;
      const ops=a[0],co=a[1],P=(x,y)=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]];
      const polys=[];let cur=null,ci=0,cx=0,cy=0;
      const push=(x,y)=>{if(!cur){cur=[];polys.push(cur)}const p=P(x,y);cur.push(p[0],p[1])};
      for(const o of ops){
        if(o===OPS.moveTo){cur=[];polys.push(cur);cx=co[ci];cy=co[ci+1];ci+=2;push(cx,cy)}
        else if(o===OPS.lineTo){if(!cur){cur=[];polys.push(cur)}cx=co[ci];cy=co[ci+1];ci+=2;push(cx,cy)}
        else if(o===OPS.curveTo||o===OPS.curveTo2||o===OPS.curveTo3){
          let x1,y1,x2,y2,x3,y3;
          if(o===OPS.curveTo){x1=co[ci];y1=co[ci+1];x2=co[ci+2];y2=co[ci+3];x3=co[ci+4];y3=co[ci+5];ci+=6}
          else if(o===OPS.curveTo2){x1=cx;y1=cy;x2=co[ci];y2=co[ci+1];x3=co[ci+2];y3=co[ci+3];ci+=4}
          else{x1=co[ci];y1=co[ci+1];x3=co[ci+2];y3=co[ci+3];x2=x3;y2=y3;ci+=4}
          for(let t=1;t<=6;t++){const u=t/6,v=1-u;push(v*v*v*cx+3*v*v*u*x1+3*v*u*u*x2+u*u*u*x3,v*v*v*cy+3*v*v*u*y1+3*v*u*u*y2+u*u*u*y3)}
          cx=x3;cy=y3;
        }
        else if(o===OPS.rectangle){const x=co[ci],y=co[ci+1],w=co[ci+2],h=co[ci+3];ci+=4;cur=[];polys.push(cur);push(x,y);push(x+w,y);push(x+w,y+h);push(x,y+h)}
        // closePath: polygons are filled as closed anyway
      }
      let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
      for(const p of polys)for(let k=0;k<p.length;k+=2){x0=Math.min(x0,p[k]);x1=Math.max(x1,p[k]);y0=Math.min(y0,p[k+1]);y1=Math.max(y1,p[k+1])}
      const w=x1-x0,h=y1-y0;
      if(!(w>=0.3&&h>=0.3&&w<=45&&h<=28))continue; // glyph sized only (drops page backgrounds, boxes, rules)
      out.push({x0,x1,y0,y1,polys,eo:paints[nx]});
    }
  }
  return out;
}

// group glyphs into LINE FRAGMENTS (one text run each). A run is split at big gaps so outlined words that sit
// on the same line as real text (e.g. "318." ... normal text ... "WHICH ...?") become separate pieces with their own x.
function blocks(gl){
  if(gl.length<2)return[];
  gl=gl.slice().sort((a,b)=>b.y1-a.y1);
  const lines=[];
  for(const g of gl){
    const cyg=(g.y0+g.y1)/2,gh=g.y1-g.y0;
    const L=lines.find(l=>cyg<=l.y1+1&&cyg>=l.y0-1&&gh<l.h*2.2+3);
    if(L){L.g.push(g);L.y0=Math.min(L.y0,g.y0);L.y1=Math.max(L.y1,g.y1);L.h=Math.max(L.h,gh)}
    else lines.push({g:[g],y0:g.y0,y1:g.y1,h:gh});
  }
  const out=[];
  for(const l of lines){
    l.g.sort((a,b)=>a.x0-b.x0);
    const bs=l.g.map(g=>Math.round(g.y0*2)/2),cnt={};bs.forEach(b=>cnt[b]=(cnt[b]||0)+1);
    const base=+Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0];
    const gap=Math.max(14,Math.min(l.h,14)*1.6);
    let run=[l.g[0]];
    const flush=()=>{if(run.length>=2||(run.length===1&&run[0].x1-run[0].x0>3)){
      const x0=run[0].x0,x1=Math.max(...run.map(g=>g.x1));
      out.push({x0,x1,y0:l.y0,y1:l.y1,lines:[{g:run,base,h:l.h}]})}run=[]};
    for(let k=1;k<l.g.length;k++){const prev=run[run.length-1];if(l.g[k].x0-Math.max(...run.map(g=>g.x1))>gap){flush();run=[l.g[k]]}else run.push(l.g[k])}
    flush();
  }
  return out;
}

// nonzero / even-odd scanline fill -> 8-bit gray bitmap (black ink on white)
function raster(b,S){
  const pad=3,X0=b.x0-pad,Y1=b.y1+pad,W=Math.ceil((b.x1-b.x0+2*pad)*S),H=Math.ceil((b.y1-b.y0+2*pad)*S);
  const img=Buffer.alloc(W*H,255);
  const glyphs=[];for(const l of b.lines)for(const g of l.g)glyphs.push(g);
  for(const g of glyphs){
    const edges=[];
    for(const p of g.polys)for(let k=0;k<p.length;k+=2){
      const j=(k+2)%p.length;let ax=(p[k]-X0)*S,ay=(Y1-p[k+1])*S,bx=(p[j]-X0)*S,by=(Y1-p[j+1])*S;
      if(ay===by)continue;let dir=1;if(ay>by){[ax,bx]=[bx,ax];[ay,by]=[by,ay];dir=-1}
      edges.push([ax,ay,bx,by,dir]);
    }
    const ya=Math.max(0,Math.floor((Y1-g.y1)*S)-1),yb=Math.min(H-1,Math.ceil((Y1-g.y0)*S)+1);
    for(let y=ya;y<=yb;y++){
      const sy=y+0.5,xs=[];
      for(const e of edges)if(sy>=e[1]&&sy<e[3])xs.push([e[0]+(sy-e[1])*(e[2]-e[0])/(e[3]-e[1]),e[4]]);
      xs.sort((p,q)=>p[0]-q[0]);let wnd=0;
      for(let k=0;k<xs.length-1;k++){
        wnd=g.eo?(wnd?0:1):wnd+xs[k][1];
        if(wnd!==0){const xa=Math.max(0,Math.round(xs[k][0])),xb=Math.min(W,Math.round(xs[k+1][0]));for(let x=xa;x<xb;x++)img[y*W+x]=0}
      }
    }
  }
  return{W,H,img};
}
function png(W,H,gray){
  const raw=Buffer.alloc((W+1)*H);for(let y=0;y<H;y++){raw[y*(W+1)]=0;gray.copy(raw,y*(W+1)+1,y*W,y*W+W)}
  const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c});
  const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(c^-1)>>>0};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]),c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

let workerP=null;
async function makeScheduler(n){
  const {createWorker,createScheduler}=require('tesseract.js');
  const langPath=path.dirname(require.resolve('@tesseract.js-data/eng/package.json'))+'/4.0.0_best_int';
  const sch=createScheduler();
  await Promise.all(Array.from({length:n},async()=>{
    const w=await createWorker('eng',1,{langPath,cachePath:require('os').tmpdir(),gzip:true,logger:()=>{},errorHandler:()=>{}});
    await w.setParameters({tessedit_pageseg_mode:'7'});
    sch.addWorker(w);
  }));
  return sch;
}
// ocr a list of blocks -> texts (same order); never throws (returns '' for failed blocks)
async function ocrBlocks(bl,sch){
  return Promise.all(bl.map(async b=>{
    try{const{W,H,img}=raster(b,3);const r=await sch.addJob('recognize',png(W,H,img));return{t:(r.data.text||'').replace(/\s*\n\s*/g,' ').trim(),c:r.data.confidence||0}}catch{return{t:'',c:0}}
  }));
}
module.exports={pageGlyphs,blocks,raster,png,ocrBlocks,makeScheduler};
