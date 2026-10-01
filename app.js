/* =========================================================
   エスパーティア  —  親のティア表を読み当てるパーティゲーム
   ========================================================= */
const APP_NAME = 'エスパーティア';
const VER = 'v1';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const TIERS = [
  {l:'S', c:'#ff7b7b'},
  {l:'A', c:'#ffbe7b'},
  {l:'B', c:'#ffe97b'},
  {l:'C', c:'#b4f07b'},
  {l:'D', c:'#7bd3ff'},
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const LS_ME   = 'et_me_v1';
const LS_HIST = 'et_hist_v1';
const LS_LOCAL= 'et_local_v1';
const LS_ROOM = 'et_room_v1';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsq = s => esc(String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
const uid = () => Math.random().toString(36).slice(2,10);
const now = () => Date.now();
const clone = o => JSON.parse(JSON.stringify(o));
const randCode = () => Array.from({length:4},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join('');

let ME = null;          // {id, name}
let HIST = {};          // 入力済みの大お題・項目（再利用用）
let UI = {screen:'home', expand:null, draft:null};

function lsGet(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }

function toast(msg){
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 1900);
}

function pushHistTopic(t){
  HIST.topics = (HIST.topics||[]).filter(x=>x!==t);
  HIST.topics.unshift(t);
  HIST.topics = HIST.topics.slice(0,20);
  lsSet(LS_HIST, HIST);
}
function pushHistItems(topic, items){
  HIST.items = HIST.items || {};
  const a = HIST.items[topic] || [];
  items.forEach(x=>{ if(!a.includes(x)) a.unshift(x); });
  HIST.items[topic] = a.slice(0,80);
  lsSet(LS_HIST, HIST);
}

/* ---------- 共通ビュー部品 ---------- */
function tierDefs(cfg){ return TIERS.slice(0, (cfg && cfg.tierCount) || 5); }

function hdr(txt, right){
  return `<div class="hdr"><div class="t">${txt}</div><div class="spacer"></div>${right||''}</div>`;
}

/* assign = {item:tierIdx}  highlight = {item:'o'|'t'|'x'} */
function tierTable(items, assign, cfg, highlight, mini){
  const defs = tierDefs(cfg);
  let h = `<div class="tiertable${mini?' mini':''}">`;
  defs.forEach((t,ti)=>{
    const inTier = items.filter(it => assign && assign[it]===ti);
    h += `<div class="tierrow"><div class="tierlabel" style="background:${t.c}">${t.l}</div><div class="tiercells">`;
    h += inTier.map(it=>{
      const k = highlight && highlight[it];
      const cls = k ? ' ' + ({o:'hl', t:'nr', x:'bd'}[k]||'') : '';
      const mark = k==='o' ? ' ◎' : (k==='t' ? ' △' : (k==='x' ? ' ✕' : ''));
      return `<span class="chip${cls}">${esc(it)}${mark}</span>`;
    }).join('') || '<span class="chip dim">—</span>';
    h += `</div></div>`;
  });
  return h + '</div>';
}

/* 項目ごとのティア選択 UI */
function assignRows(items, assign, cfg, actSet){
  const defs = tierDefs(cfg);
  return `<div class="assign">${items.map((it,i)=>{
    const cur = assign[it];
    return `<div class="arow">
      <div class="nm"><span>${esc(it)}</span></div>
      <div class="seg">${defs.map((t,ti)=>`<button onclick="${actSet}(${i},${ti})" style="${cur===ti?`background:${t.c};color:#1a1a1a`:''}">${t.l}</button>`).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

/* ---------- 採点 ---------- */
/* ◎同じティア +3 / △1つ隣 +1 / ✕それ以上 0、全部ピタリで完全一致ボーナス */
const PERFECT_BONUS = 5;
function scoreOf(items, ptier, guess){
  let pts = 0; const marks = []; let allHit = items.length > 0;
  items.forEach(it=>{
    const g = guess && guess.assign ? guess.assign[it] : undefined;
    if(g === undefined){ marks.push({it, k:'x', p:0, blank:true}); allHit = false; return; }
    const diff = Math.abs(ptier[it] - g);
    const p = diff===0 ? 3 : (diff===1 ? 1 : 0);
    if(diff !== 0) allHit = false;
    pts += p;
    marks.push({it, k: diff===0?'o':(diff===1?'t':'x'), p});
  });
  if(allHit) pts += PERFECT_BONUS;
  return {pts, marks, perfect: allHit};
}
function maxScore(cfg, itemCount){ return itemCount*3 + PERFECT_BONUS; }

/* ---------- render ---------- */
let _lastSig = '';
function render(force){
  const el = $('app');
  /* 入力中のフォーカスとカーソル位置を保つ */
  const act = document.activeElement;
  const keep = (act && act.tagName==='INPUT') ? {id:act.id, s:act.selectionStart, e:act.selectionEnd} : null;

  el.innerHTML = currentHTML();

  if(keep && keep.id){
    const n = $(keep.id);
    if(n){ n.focus(); try{ n.setSelectionRange(keep.s, keep.e); }catch(e){} }
  }
  if(UI.focus){ const n = $(UI.focus); if(n){ n.focus(); } UI.focus = null; }
}
function maybeRender(sig){
  if(sig !== undefined){
    if(sig === _lastSig) return;
    _lastSig = sig;
  }
  render();
}

/* =========================================================
   通信層（MQTT over WebSocket / 公開ブローカー）
   ========================================================= */
const NET = {
  client:null, code:null, role:null, onMsg:null,
  status:'idle',          // idle | connecting | online | offline
  bIdx:0, tries:0, dead:false, _t:null,

  topic(sub){ return `espertier/${VER}/${this.code}/${sub}`; },

  start(code, role, onMsg){
    this.stop();
    this.code = code; this.role = role; this.onMsg = onMsg;
    this.bIdx = 0; this.tries = 0; this.dead = false;
    this._open();
  },

  _open(){
    if(this.dead) return;
    this.status = 'connecting'; paintNet();
    const url = BROKERS[this.bIdx];
    let c;
    try{
      c = mqtt.connect(url, {
        clientId: 'et_' + ME.id + '_' + Math.random().toString(16).slice(2,8),
        keepalive: 30, reconnectPeriod: 0, connectTimeout: 8000, clean: true
      });
    }catch(e){ return this._retry(); }
    this.client = c;

    c.on('connect', ()=>{
      if(this.dead){ try{c.end(true)}catch(e){}; return; }
      this.tries = 0;
      const sub = this.role==='host' ? 'c' : 's';
      c.subscribe(this.topic(sub), {qos:0}, (err)=>{
        if(err){ return this._retry(); }
        this.status = 'online'; paintNet();
        onNetUp();
      });
    });
    c.on('message', (tp, payload)=>{
      let o; try{ o = JSON.parse(new TextDecoder().decode(payload)); }catch(e){ return; }
      if(this.onMsg) this.onMsg(o);
    });
    c.on('error', ()=>{ this._retry(); });
    c.on('close', ()=>{ if(this.status!=='idle') this._retry(); });
  },

  _retry(){
    if(this.dead) return;
    try{ this.client && this.client.end(true); }catch(e){}
    this.client = null;
    this.status = 'offline'; paintNet();
    this.tries++;
    /* 同じブローカーを3回試してから次へ（一時的な失敗で部屋が割れないように） */
    if(this.tries % 3 === 0) this.bIdx = (this.bIdx + 1) % BROKERS.length;
    clearTimeout(this._t);
    this._t = setTimeout(()=>this._open(), Math.min(1200 + this.tries*400, 5000));
  },

  pub(sub, obj, retain){
    if(!this.client || this.status!=='online') return false;
    try{
      this.client.publish(this.topic(sub), JSON.stringify(obj), {qos:0, retain:!!retain});
      return true;
    }catch(e){ return false; }
  },

  stop(){
    this.dead = true;
    clearTimeout(this._t);
    try{ this.client && this.client.end(true); }catch(e){}
    this.client = null; this.status = 'idle'; paintNet();
  }
};

/* 画面が消えると（特にホストは）進行が止まるのでスリープを抑止する */
let _wake = null;
function keepAwake(on){
  try{
    if(on){
      if(_wake || !navigator.wakeLock) return;
      navigator.wakeLock.request('screen').then(w=>{
        _wake = w;
        w.addEventListener('release', ()=>{ _wake = null; });
      }).catch(()=>{});
    } else if(_wake){
      const w = _wake; _wake = null;
      try{ w.release(); }catch(e){}
    }
  }catch(e){}
}
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible' && ROOM && ROOM.role) keepAwake(true);
  });
}

function paintNet(){
  const el = $('net'); if(!el) return;
  const hide = (NET.status==='online' || NET.status==='idle');
  el.className = hide ? 'net ok' : 'net';
  el.textContent = hide ? '' : (NET.status==='connecting' ? '接続中…' : '切断されました。再接続しています…');
  if(document.body) document.body.classList.toggle('netbar', !hide);
}
function onNetUp(){
  if(ROOM.role==='host') HOST.broadcast(true);
  else ROOM.sayHi();
}

/* =========================================================
   部屋（クライアント側の共通処理）
   ========================================================= */
const ROOM = {
  role:null, code:null, g:null, draft:null,
  hiTimer:null, gTimer:null, joinedAt:0, lastStateAt:0,

  open(role, code){
    this.role = role; this.code = code; this.g = null; this.draft = null;
    this.joinedAt = now(); this.lastStateAt = now();
    lsSet(LS_ROOM, {code, at: now()});
    if(role==='host') HOST.init(code);
    keepAwake(true);
    NET.start(code, role, (m)=> role==='host' ? HOST.onClientMsg(m) : ROOM.onState(m));
    clearInterval(this.hiTimer);
    this.hiTimer = setInterval(()=>{ this.sayHi(); this.checkHost(); }, 4000);
    UI.screen = 'room'; UI.menu = false;
    render();
  },

  leave(){
    keepAwake(false);
    clearInterval(this.hiTimer); clearTimeout(this.gTimer);
    if(this.role==='host') HOST.stop();
    sendToHost({t:'bye', id:ME.id});
    NET.stop();
    this.role = null; this.code = null; this.g = null; this.draft = null;
    UI.screen = 'home'; UI.menu = false; render();
  },

  /* ホストの配信が途絶えたら、残っている人の中から次のホストを決める */
  checkHost(){
    if(this.role !== 'guest' || !this.g || NET.status !== 'online') return;
    const cands = (this.g.players||[]).filter(p=>p.on && p.id !== this.g.hostId).map(p=>p.id).sort();
    const rank = cands.indexOf(ME.id);
    if(rank < 0) return;                       /* 自分が候補でなければ何もしない */
    if(now() - this.lastStateAt > 11000 + rank*4000) this.promote();
  },

  promote(){
    const snap = this.g;
    if(!snap) return;
    clearInterval(this.hiTimer);
    NET.stop();
    this.role = 'host';
    HOST.adopt(this.code, snap);
    NET.start(this.code, 'host', (m)=>HOST.onClientMsg(m));
    this.hiTimer = setInterval(()=>{ this.sayHi(); this.checkHost(); }, 4000);
    toast('ホストが抜けたので、あなたが進行役になりました');
    render();
  },

  sayHi(){ sendToHost({t:'hi', id:ME.id, name:ME.name}); },

  onState(m){
    if(!m || m.t!=='S' || !m.g) return;
    const prev = this.g;
    this.g = m.g;
    this.lastStateAt = now();
    /* 自分が入力中の画面なら、同じフェーズのうちは描き直さない */
    const mine = isMyInputPhase(m.g);
    if(prev && prev.phase===m.g.phase && mine) return;
    if(prev && prev.phase!==m.g.phase) this.draft = null;
    maybeRender(roomSig(m.g));
    patchTimer(m.g);
  },

  /* 現在表示に使う状態（ホストは自分の権威状態をサニタイズして見る） */
  view(){ return this.role==='host' ? (HOST.g ? sanitizeG(HOST.g) : null) : this.g; }
};

function sendToHost(m){
  if(ROOM.role==='host'){ HOST.onClientMsg(m); return true; }
  return NET.pub('c', m);
}

function isMyInputPhase(g){
  if(!g) return false;
  const p = parentOf(g);
  if(['ptopic','pitems'].includes(g.phase) && p && p.id===ME.id) return true;
  return false;
}
function roomSig(g){
  if(!g) return 'none';
  const subs = (g.cur && g.cur.submitted) ? g.cur.submitted.slice().sort().join(',') : '';
  const on = g.phase==='lobby' ? g.players.map(p=>p.id+(p.on?1:0)).join(',') : g.players.length;
  return [g.phase, g.round, g.parentIdx, subs, on, g.topic, g.totalRounds,
          g.players.map(p=>p.name+p.total).join('.'), JSON.stringify(g.cfg),
          g.cur?(g.cur.items||[]).join('|'):'' , g.cur?g.cur.topic:''].join('#');
}
function parentOf(g){ return g && g.players ? g.players[g.parentIdx % g.players.length] : null; }

/* 1秒ごとの再描画はカクつくので、タイマーのDOMだけ直接書き換える */
function patchTimer(g){
  if(!g || !g.cfg || !g.cfg.timer || !document.querySelector) return;
  const num = document.querySelector('.tnum b');
  const bar = document.querySelector('.tbar > i');
  const wrap = document.querySelector('.tbar');
  if(!num || !bar) return;
  const warn = g.remain <= 10;
  num.textContent = g.remain + '秒';
  num.className = warn ? 'warn' : '';
  if(wrap) wrap.className = 'tbar' + (warn ? ' warn' : '');
  bar.style.width = Math.max(0, Math.min(100, (g.remain / g.cfg.timer) * 100)) + '%';
}
function amParent(g){ const p = parentOf(g); return !!(p && p.id===ME.id); }
function amHost(g){ return !!(g && g.hostId===ME.id); }

function sanitizeG(g){
  const o = clone(g);
  delete o._seen;
  const rev = ['reveal','score','final'].includes(g.phase);
  o.players = g.players.map(p=>({id:p.id, name:p.name, total:p.total, on: HOST.isOn(p.id)}));
  if(o.cur){
    const gs = g.cur.guesses || {};
    o.cur.submitted = Object.keys(gs).filter(k=>gs[k] && gs[k].done);
    if(!rev){ delete o.cur.ptier; delete o.cur.guesses; }
    if(g.phase==='ptopic' || g.phase==='pitems') o.cur.items = [];
  }
  return o;
}

/* =========================================================
   ホスト（権威）
   ========================================================= */
const HOST = {
  g:null, seen:{}, loop:null, lastSent:0,

  init(code){
    this.seen = {};
    this.g = {
      code, hostId: ME.id, phase:'lobby',
      cfg:{itemCount:5, tierCount:5, timer:90, topicMode:'fixed', rounds:0},
      topic:'',
      players:[], round:1, totalRounds:0, parentIdx:0,
      cur:null, history:[], remain:0
    };
    this.addPlayer(ME.id, ME.name);
    clearInterval(this.loop);
    this.loop = setInterval(()=>this.tick(), 1000);
  },
  stop(){ clearInterval(this.loop); this.g = null; },

  /* 前のホストの最後の配信内容を引き継ぐ。
     親のティア表と全員の予想は秘密なので手元に無い → そのラウンドだけやり直す */
  adopt(code, snap){
    this.seen = {};
    const g = clone(snap);
    g.hostId = ME.id; g.code = code;
    const goneId = snap.hostId;
    (g.players||[]).forEach(p=>{ if(p.on && p.id !== goneId) this.seen[p.id] = now(); delete p.on; });
    this.seen[ME.id] = now();
    g.history = g.history || [];
    this.g = g;
    clearInterval(this.loop);
    this.loop = setInterval(()=>this.tick(), 1000);
    if(['ptopic','pitems','ptier','guess'].includes(g.phase)){
      g.cur = null; g.remain = 0;
      this.beginRound();
    } else {
      this.broadcast(true);
    }
  },

  endNow(){
    const g = this.g;
    if(!g.history.length) return this.toLobby();
    g.totalRounds = g.history.length;
    g.phase = 'final'; g.cur = null; g.remain = 0;
    this.broadcast(true);
  },
  toLobby(){
    const g = this.g;
    g.phase = 'lobby'; g.cur = null; g.remain = 0;
    g.round = 1; g.parentIdx = 0; g.history = [];
    g.players.forEach(p=>p.total = 0);
    this.broadcast(true);
  },

  isOn(id){ return (now() - (this.seen[id]||0)) < 13000; },
  player(id){ return this.g.players.find(p=>p.id===id); },

  addPlayer(id, name){
    let p = this.player(id);
    if(p){ if(name) p.name = name; }
    else {
      if(this.g.players.length >= 12) return;
      this.g.players.push({id, name: name||'？', total:0});
    }
    this.seen[id] = now();
  },

  onClientMsg(m){
    const g = this.g; if(!g || !m || !m.id) return;
    if(m.t==='hi'){
      const had = !!this.player(m.id);
      this.addPlayer(m.id, m.name);
      if(!had) this.broadcast(true);
      return;
    }
    this.seen[m.id] = now();
    if(m.t==='bye'){ delete this.seen[m.id]; this.broadcast(true); return; }

    const par = parentOf(g);
    if(m.t==='topic' && g.phase==='ptopic' && par && par.id===m.id){
      g.cur.topic = String(m.topic||'').slice(0,40);
      g.phase = 'pitems'; return this.broadcast(true);
    }
    if(m.t==='items' && g.phase==='pitems' && par && par.id===m.id){
      g.cur.items = (m.items||[]).slice(0, g.cfg.itemCount).map(x=>String(x).slice(0,24));
      g.phase = 'ptier'; return this.broadcast(true);
    }
    if(m.t==='tier' && g.phase==='ptier' && par && par.id===m.id){
      g.cur.ptier = m.ptier || {};
      g.phase = 'guess';
      g.cur.endsAt = g.cfg.timer > 0 ? now() + g.cfg.timer*1000 : 0;
      g.remain = g.cfg.timer;
      return this.broadcast(true);
    }
    if(m.t==='g' && g.phase==='guess'){
      if(par && par.id===m.id) return;              // 親は予想しない
      if(!this.player(m.id)) return;
      g.cur.guesses[m.id] = {assign: m.assign||{}, done: !!m.done};
      if(this.allDone()) return this.finishGuess();
      return this.broadcast(true);
    }
  },

  allDone(){
    const g = this.g, par = parentOf(g);
    const kids = g.players.filter(p=>p.id!==par.id && this.isOn(p.id));
    if(!kids.length) return false;
    return kids.every(p => g.cur.guesses[p.id] && g.cur.guesses[p.id].done);
  },

  tick(){
    const g = this.g; if(!g) return;
    if(['ptopic','pitems','ptier'].includes(g.phase)){
      const par = parentOf(g);
      if(par && !this.isOn(par.id)){
        if(!this._parentGoneAt) this._parentGoneAt = now();
        if(now() - this._parentGoneAt > 15000){ this._parentGoneAt = 0; return this.skipRound(); }
      } else this._parentGoneAt = 0;
    } else this._parentGoneAt = 0;
    if(g.phase==='guess' && g.cur.endsAt){
      const r = Math.max(0, Math.ceil((g.cur.endsAt - now())/1000));
      if(r !== g.remain){ g.remain = r; this.broadcast(true); }
      if(r<=0) return this.finishGuess();
    }
    this.broadcast(false);
  },

  broadcast(force){
    if(!this.g) return;
    const t = now();
    if(!force && t - this.lastSent < 2500) { const v0 = ROOM.view(); maybeRender(roomSig(v0)); patchTimer(v0); return; }
    this.lastSent = t;
    NET.pub('s', {t:'S', g: sanitizeG(this.g)}, true);
    const v = ROOM.view();
    maybeRender(roomSig(v));
    patchTimer(v);
  },

  /* ---- 進行 ---- */
  startGame(){
    const g = this.g;
    const live = g.players.filter(p=>this.isOn(p.id));
    if(live.length < 3){ toast('3人以上集まってから！'); return; }
    g.players = live;
    g.players.forEach(p=>p.total=0);
    g.history = []; g.round = 1; g.parentIdx = 0;
    if(!g.totalRounds) g.totalRounds = g.players.length;
    this.beginRound();
  },

  beginRound(){
    const g = this.g;
    /* 抜けた人が親の番になるとゲームが止まるので、オンラインの人まで送る */
    for(let i=0; i<g.players.length; i++){
      const p = g.players[g.parentIdx % g.players.length];
      if(p && this.isOn(p.id)) break;
      g.parentIdx = (g.parentIdx + 1) % g.players.length;
    }
    this._parentGoneAt = 0;
    g.cur = {topic: g.cfg.topicMode==='fixed' ? g.topic : '', items:[], ptier:null, guesses:{}, results:null, parentPts:0, endsAt:0};
    g.remain = 0;
    g.phase = g.cfg.topicMode==='fixed' ? 'pitems' : 'ptopic';
    this.broadcast(true);
  },

  finishGuess(){
    const g = this.g, par = parentOf(g);
    const kids = g.players.filter(p=>p.id!==par.id);
    const results = kids.map(p=>{
      const gu = g.cur.guesses[p.id];
      const r = scoreOf(g.cur.items, g.cur.ptier, gu);
      r.id = p.id;
      r.answered = !!gu;
      return r;
    });
    const gained = {};
    results.forEach(r=>{ gained[r.id] = r.pts; const p = this.player(r.id); if(p) p.total += r.pts; });
    const avg = results.length ? Math.max(0, Math.round(results.reduce((a,b)=>a+b.pts,0)/results.length)) : 0;
    gained[par.id] = avg; par.total += avg;
    g.cur.results = results;
    g.cur.parentPts = avg;
    g.history.push({topic:g.cur.topic, items:g.cur.items.slice(), ptier:clone(g.cur.ptier), parentId:par.id, gained});
    g.phase = 'reveal';
    g.remain = 0;
    this.broadcast(true);
  },

  closeGuess(){ if(this.g.phase==='guess') this.finishGuess(); },

  next(){
    const g = this.g;
    if(g.phase==='reveal'){ g.phase='score'; return this.broadcast(true); }
    if(g.phase==='score'){
      g.round++;
      g.parentIdx = (g.parentIdx+1) % g.players.length;
      if(g.round > g.totalRounds){ g.phase='final'; return this.broadcast(true); }
      return this.beginRound();
    }
    if(g.phase==='final'){
      g.players.forEach(p=>p.total=0);
      g.history=[]; g.round=1; g.parentIdx=0; g.phase='lobby'; g.cur=null;
      return this.broadcast(true);
    }
  },

  skipRound(){
    const g = this.g;
    if(g.phase==='lobby' || g.phase==='final') return;
    this._parentGoneAt = 0;
    g.round++;
    g.parentIdx = (g.parentIdx+1) % g.players.length;
    if(g.round > g.totalRounds){ g.phase='final'; return this.broadcast(true); }
    this.beginRound();
  },

  setCfg(k, v){ this.g.cfg[k] = v; if(k==='rounds') this.g.totalRounds = v; this.broadcast(true); }
};

/* =========================================================
   オンラインの画面
   ========================================================= */
function itemChipsHTML(list, delAct){
  return list.map((x,i)=>`<button class="pick on" onclick="${delAct}(${i})">${esc(x)} <span style="opacity:.55">✕</span></button>`).join('')
    || '<span class="tiny">まだありません</span>';
}
function itemRecentHTML(topic, list, addAct){
  const recent = ((HIST.items||{})[topic]||[]).filter(x=>!list.includes(x)).slice(0,24);
  if(!recent.length) return '';
  return `<h3 style="margin-top:14px">前に使った項目（タップで追加）</h3><div class="pickwrap">
    ${recent.map(x=>`<button class="pick" onclick="${addAct}('${jsq(x)}')">${esc(x)}</button>`).join('')}</div>`;
}
/* 画面まるごと描き直すと入力欄が作り直されてキーボードが閉じるので、周辺だけ差し替える */
function patchItems(){
  const local = UI.screen === 'local';
  const d = local ? L.draft : ROOM.draft;
  const g = local ? null : ROOM.view();
  const cfg = local ? L.cfg : (g && g.cfg);
  const topic = local ? (L.cur||{}).topic : ((g&&g.cur)||{}).topic;
  if(!d || !cfg) return;
  const need = cfg.itemCount;
  const c = $('chips');  if(c) c.innerHTML = itemChipsHTML(d.list, local?'A.lidel':'A.idel');
  const r = $('recent'); if(r) r.innerHTML = itemRecentHTML(topic, d.list, local?'A.liadd2':'A.iadd2');
  const n = $('cnt');    if(n){ n.textContent = d.list.length + ' / ' + need; n.className = 'pill' + (d.list.length===need?' on':''); }
  const cl = $('clr');   if(cl) cl.style.display = d.list.length ? '' : 'none';
  const b = $('okbtn');
  if(b){
    b.disabled = d.list.length !== need;
    b.textContent = d.list.length===need ? 'ティア分けへすすむ' : `あと ${Math.max(0, need-d.list.length)}個`;
  }
}

function dft(key, init){
  if(!ROOM.draft || ROOM.draft.__k !== key) ROOM.draft = Object.assign({__k:key}, init);
  return ROOM.draft;
}
function seg(opts, cur, act){
  return `<div class="row wrap" style="gap:7px">${opts.map(o=>{
    const on = o.v===cur;
    const val = typeof o.v==='string' ? `'${jsq(o.v)}'` : o.v;
    return `<button class="btn sm" style="flex:1 0 auto;min-width:62px;background:${on?'var(--acc)':'var(--bg3)'};color:${on?'#201a05':'var(--fg)'}" onclick="${act}(${val})">${o.l}</button>`;
  }).join('')}</div>`;
}
function waitBox(title, sub, extra){
  return `<div class="waitbox"><div class="spin"></div>
    <div style="font-size:18px;font-weight:900">${title}</div>
    <div class="mut" style="max-width:300px">${sub||''}</div>${extra||''}</div>`;
}
function playerTags(g){
  return `<div class="plist">${g.players.map(p=>
    `<span class="ptag ${p.on?'':'offl'} ${p.id===g.hostId?'host':''}">
      <span class="dot"></span>${esc(p.name)}${p.id===ME.id?' <span class="tiny">(あなた)</span>':''}${p.id===g.hostId?' 🏠':''}
    </span>`).join('')}</div>`;
}
function timerBar(g){
  if(!g.cfg.timer) return '';
  const pct = Math.max(0, Math.min(100, (g.remain/g.cfg.timer)*100));
  const warn = g.remain<=10;
  return `<div class="timer">
    <div class="tnum"><span class="tiny">のこり時間</span><b class="${warn?'warn':''}">${g.remain}秒</b></div>
    <div class="tbar ${warn?'warn':''}"><i style="width:${pct}%"></i></div>
  </div>`;
}

function scRoom(){
  const g = ROOM.view();
  if(!g) return `<div class="screen center">${waitBox('部屋に接続しています…','ルームコード '+esc(ROOM.code))}
    <div style="width:100%;max-width:340px"><button class="btn ghost" onclick="A.leave()">やめる</button></div></div>`;
  switch(g.phase){
    case 'lobby':  return scLobby(g);
    case 'ptopic': return amParent(g) ? scPTopic(g) : scWait(g, 'お題を決めています');
    case 'pitems': return amParent(g) ? scPItems(g) : scWait(g, '項目を選んでいます');
    case 'ptier':  return amParent(g) ? scPTier(g)  : scWait(g, 'ティア表を作っています');
    case 'guess':  return amParent(g) ? scParentWait(g) : scGuess(g);
    case 'reveal': return scReveal(g);
    case 'score':  return scScore(g);
    case 'final':  return scFinal(g);
  }
  return '<div class="screen"><p>…</p></div>';
}

function scLobby(g){
  const host = amHost(g);
  const n = g.players.length;
  const rounds = g.totalRounds || n;
  return `<div class="screen">
    ${hdr(APP_NAME, `<span class="pill ${NET.status==='online'?'lv':'off'}">${NET.status==='online'?'接続中':'再接続中'}</span>${menuBtn()}`)}
    <div class="card cen">
      <div class="tiny">ルームコード</div>
      <div class="roomcode">${esc(g.code)}</div>
      <div class="tiny" style="margin-bottom:10px">このコードを友達に伝えてね</div>
      <button class="btn sm ghost" style="width:100%" onclick="A.copyLink()">🔗 参加リンクをコピーして送る</button>
    </div>
    <h3>メンバー（${n}人）</h3>
    ${playerTags(g)}
    ${host ? `
      <h3>ルール設定</h3>
      <div class="card">
        <b>大お題（ジャンル）</b>
        <div class="tiny" style="margin:4px 0 9px">ゲーム通して同じにするか、親が毎回決めるか</div>
        ${seg([{v:'fixed',l:'ずっと同じ'},{v:'each',l:'親が毎回決める'}], g.cfg.topicMode, 'A.cfg_topicMode')}
        ${g.cfg.topicMode==='fixed'?`
          <input type="text" id="lbt" style="margin-top:9px" maxlength="30" value="${esc(g.topic)}"
            placeholder="例）好きなコンビニスイーツ" oninput="A.setTopic(this.value)">`:''}
      </div>
      <div class="card">
        <b>子の制限時間</b>
        <div class="tiny" style="margin:4px 0 9px">0になると、その時点の予想で自動的に締め切ります</div>
        ${seg([{v:60,l:'60秒'},{v:90,l:'90秒'},{v:120,l:'120秒'},{v:0,l:'なし'}], g.cfg.timer, 'A.cfg_timer')}
      </div>
      <div class="card flat">
        <b>かたいルール</b>
        <div class="tiny" style="margin-top:6px;line-height:1.8">
          ・項目は <b>5個</b>、ティアは <b>S / A / B / C / D の5段</b><br>
          ・◎ピタリ +3／△となり +1／✕それ以上 0<br>
          ・<b>全部ピタリで +${PERFECT_BONUS}</b>（15点満点＋ボーナスで最高${3*5+PERFECT_BONUS}点）<br>
          ・親の点＝そのラウンドの子の平均点
        </div>
      </div>
      <div class="card">
        <b>ラウンド数</b>
        <div class="tiny" style="margin:4px 0 9px">全${rounds}ラウンド（親が${rounds}回まわります）</div>
        ${seg([{v:4,l:'4'},{v:6,l:'6'},{v:n,l:'人数分 '+n},{v:n*2,l:'人数×2 '+(n*2)}], rounds, 'A.cfg_rounds')}
      </div>
      <div class="tiny" style="margin-top:14px;line-height:1.7">
        ⚠️ ホストの端末が進行役です。<b>なるべくこの画面を開いたまま</b>に（他のアプリに移ると進行が止まります）。<br>
        もしホストが落ちても、残っている人の中から<b>自動で進行役が交代</b>します。
      </div>
      <div class="stack">
        <button class="btn pri" onclick="A.startGame()">ゲーム開始</button>
        <button class="btn ghost" onclick="A.leave()">部屋から出る</button>
      </div>`
    : `
      <div class="card flat" style="margin-top:16px">
        <div class="row"><span class="pill">全${rounds}R</span><span class="pill">項目${g.cfg.itemCount}個</span><span class="pill">${g.cfg.timer?g.cfg.timer+'秒':'時間無制限'}</span></div>
        ${g.cfg.topicMode==='fixed'&&g.topic?`<div style="margin-top:9px;font-weight:800">${esc(g.topic)}</div>`:''}
      </div>
      <div class="waitbox"><div class="spin"></div><div style="font-weight:900">ホストの開始待ち</div>
        <div class="mut">${esc((g.players.find(p=>p.id===g.hostId)||{}).name||'')} さんが設定しています</div></div>
      <div class="stack"><button class="btn ghost" onclick="A.leave()">部屋から出る</button></div>`}
  </div>`;
}

function roundHdrO(g){
  const p = parentOf(g);
  return hdr(`ROUND ${g.round} / ${g.totalRounds}`, `<span class="pill on">親 ${esc(p?p.name:'')}</span>${menuBtn()}`);
}

function scWait(g, what){
  const p = parentOf(g);
  const items = (g.cur && g.cur.items) || [];
  return `<div class="screen">
    ${roundHdrO(g)}
    ${g.cur && g.cur.topic ? `<div class="card flat"><div class="tiny">大お題</div><div style="font-size:18px;font-weight:900;margin-top:2px">${esc(g.cur.topic)}</div></div>`:''}
    ${items.length?`<h3>今回の項目</h3><div class="pickwrap">${items.map(x=>`<span class="pick on">${esc(x)}</span>`).join('')}</div>
      <div class="tiny" style="margin-top:10px">👀 ${esc(p.name)} さんがどう並べるか考えておこう</div>`:''}
    ${waitBox(`${esc(p?p.name:'')} さんが${what}`, 'スマホを置いて待っててOK')}
    ${amHost(g)?`<div class="stack"><button class="btn ghost" onclick="A.skip()">このラウンドを飛ばす（ホスト）</button></div>`:''}
  </div>`;
}

function scPTopic(g){
  const d = dft('ptopic'+g.round, {text:''});
  const recent = (HIST.topics||[]).slice(0,10);
  return `<div class="screen">
    ${roundHdrO(g)}
    <h1>大お題をきめる</h1>
    <p class="mut" style="margin-bottom:14px">あなたが親です。みんなに聞こえるように宣言しながら入れてね。</p>
    <input type="text" id="tp" maxlength="30" value="${esc(d.text)}" placeholder="例）好きなコンビニスイーツ"
      oninput="A.dtopic(this.value)" onkeydown="if(event.key==='Enter'){this.blur();A.topicOK()}">
    ${recent.length?`<h3>前に使ったお題</h3><div class="pickwrap">${recent.map(t=>`<button class="pick" onclick="A.dtopic2('${jsq(t)}')">${esc(t)}</button>`).join('')}</div>`:''}
    <div class="stack"><button class="btn pri" onclick="A.topicOK()">これでいく</button></div>
  </div>`;
}

function scPItems(g){
  const need = g.cfg.itemCount;
  const d = dft('pitems'+g.round, {list:[], text:''});
  const topic = g.cur.topic;
  return `<div class="screen">
    ${roundHdrO(g)}
    <div class="card flat"><div class="tiny">大お題</div><div style="font-size:18px;font-weight:900;margin-top:2px">${esc(topic)}</div></div>
    <h2>項目を ${need}個 えらぶ</h2>
    <p class="mut" style="margin-bottom:12px">声に出しながら入れると盛り上がります（この後みんなに公開されます）</p>
    <div class="row" style="margin-bottom:12px">
      <input type="text" id="it" maxlength="18" value="${esc(d.text)}" placeholder="項目をいれて Enter"
        enterkeyhint="done" autocomplete="off"
        oninput="A.ditem(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();A.iadd()}">
      <button class="btn sm pri" style="padding:14px 18px" onpointerdown="event.preventDefault()" onclick="A.iadd()">追加</button>
    </div>
    <div class="row" style="margin-bottom:10px">
      <span id="cnt" class="pill ${d.list.length===need?'on':''}">${d.list.length} / ${need}</span>
      <button id="clr" class="btn sm ghost" style="display:${d.list.length?'':'none'}" onclick="A.iclear()">ぜんぶ消す</button>
    </div>
    <div id="chips" class="pickwrap" style="margin-bottom:6px">${itemChipsHTML(d.list,'A.idel')}</div>
    <div id="recent" class="scroll">${itemRecentHTML(topic, d.list, 'A.iadd2')}</div>
    <div class="stack">
      <button id="okbtn" class="btn pri" ${d.list.length!==need?'disabled':''} onclick="A.itemsOK()">
        ${d.list.length===need?'ティア分けへすすむ':`あと ${Math.max(0,need-d.list.length)}個`}</button>
    </div>
  </div>`;
}

function scPTier(g){
  const items = g.cur.items;
  const d = dft('ptier'+g.round, {assign:{}});
  const done = items.filter(it=>d.assign[it]!==undefined).length;
  const used = new Set(items.map(it=>d.assign[it]).filter(v=>v!==undefined)).size;
  const ok = done===items.length && used>=2;
  return `<div class="screen">
    ${roundHdrO(g)}
    <div class="card flat"><div class="tiny">${esc(g.cur.topic)}</div>
      <div style="font-size:16px;font-weight:900;margin-top:2px">👑 あなたのティア表をつくる</div>
      <div class="tiny" style="margin-top:5px">画面を見られないように！ これを ${g.players.length-1}人が予想します。</div></div>
    <div class="sticky">${tierTable(items, d.assign, g.cfg)}</div>
    <div style="height:12px"></div>
    ${assignRows(items, d.assign, g.cfg, 'A.pset')}
    <div class="stack">
      ${used<2 && done===items.length?'<div class="tiny cen" style="margin-bottom:8px;color:var(--ng)">全部おなじティアはナシ！ 2段以上つかってね</div>':''}
      <button class="btn pri" ${ok?'':'disabled'} onclick="A.tierOK()">${done<items.length?`あと ${items.length-done}個`:'これで確定！ みんなの予想スタート'}</button>
    </div>
  </div>`;
}

function scGuess(g){
  const items = g.cur.items;
  const d = dft('guess'+g.round, {assign:{}, done:false});
  const subs = g.cur.submitted||[];
  const kids = g.players.filter(p=>p.id!==parentOf(g).id);
  if(d.done || subs.includes(ME.id)){
    return `<div class="screen">
      ${roundHdrO(g)}
      ${timerBar(g)}
      ${waitBox('提出ずみ！', `${subs.length} / ${kids.length} 人がおわりました`)}
      <h3>あなたの予想</h3>
      ${tierTable(items, d.assign, g.cfg, null, true)}
      <div class="plist" style="margin-top:14px">${kids.map(p=>`<span class="ptag ${subs.includes(p.id)?'':'offl'}"><span class="dot"></span>${esc(p.name)}</span>`).join('')}</div>
      <div class="stack">${amHost(g)?`<button class="btn ghost" onclick="A.close()">全員ぶんを締め切る（ホスト）</button>`:''}</div>
    </div>`;
  }
  const done = items.filter(it=>d.assign[it]!==undefined).length;
  return `<div class="screen">
    ${roundHdrO(g)}
    ${timerBar(g)}
    <div class="card flat"><div class="tiny">${esc(g.cur.topic)}</div>
      <div style="font-size:16px;font-weight:900;margin-top:2px">🔍 ${esc(parentOf(g).name)} さんのティア表を予想</div>
      <div class="tiny" style="margin-top:5px">◎ピタリ +3／△となり +1／全部ピタリでさらに +${PERFECT_BONUS}</div></div>
    <div class="sticky">${tierTable(items, d.assign, g.cfg)}</div>
    <div style="height:12px"></div>
    ${assignRows(items, d.assign, g.cfg, 'A.gset')}
    <div class="stack">
      <button class="btn pri" ${done===items.length?'':'disabled'} onclick="A.submit()">
        ${done<items.length?`あと ${items.length-done}個`:'この予想で決定'}</button>
    </div>
  </div>`;
}

function scParentWait(g){
  const subs = g.cur.submitted||[];
  const kids = g.players.filter(p=>p.id!==parentOf(g).id);
  return `<div class="screen">
    ${roundHdrO(g)}
    ${timerBar(g)}
    <div class="card flat"><div class="tiny">${esc(g.cur.topic)}</div>
      <div style="font-size:16px;font-weight:900;margin-top:2px">👑 みんなが予想中…</div></div>
    <div class="cen" style="margin:18px 0 10px"><span class="big">${subs.length}<span style="font-size:20px;color:var(--mut)"> / ${kids.length}</span></span>
      <div class="tiny">提出ずみ</div></div>
    <div class="plist">${kids.map(p=>`<span class="ptag ${subs.includes(p.id)?'':'offl'}"><span class="dot"></span>${esc(p.name)}</span>`).join('')}</div>
    <div class="stack">${amHost(g)?`<button class="btn ghost" onclick="A.close()">締め切って結果へ（ホスト）</button>`:''}</div>
  </div>`;
}

function scReveal(g){
  const items = g.cur.items, cfg = g.cfg;
  const par = parentOf(g);
  const res = (g.cur.results||[]).slice().sort((a,b)=>b.pts-a.pts);
  const mx = maxScore(cfg, items.length);
  const name = id => { const p = g.players.find(x=>x.id===id); return p?p.name:'？'; };
  return `<div class="screen">
    ${roundHdrO(g)}
    <div class="tiny">${esc(g.cur.topic)}</div>
    <h2>👑 ${esc(par.name)} さんの正解</h2>
    ${tierTable(items, g.cur.ptier, cfg)}
    <h3>予想のけっか（タップで中身）</h3>
    ${res.map((r,i)=>{
      const open = UI.expand === r.id;
      const hl = {}; r.marks.forEach(m=>hl[m.it]=m.k);
      const gu = (g.cur.guesses||{})[r.id];
      return `<div class="card tap" onclick="A.toggle('${jsq(r.id)}')">
        <div class="row">
          <div class="rk" style="width:26px;flex:0 0 26px;text-align:center;font-weight:900;color:var(--mut)">${['🥇','🥈','🥉'][i]||(i+1)}</div>
          <div class="nm2" style="flex:1;font-weight:900;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name(r.id))}${r.answered?'':' <span class="badge">未提出</span>'}</div>
          <div style="font-weight:900;font-size:21px;color:var(--acc)">${r.pts}<span style="font-size:11px;color:var(--mut)"> / ${mx}</span></div>
          <div class="tiny" style="margin-left:4px">${open?'▲':'▼'}</div>
        </div>
        <div class="marks">
          ${r.marks.map(m=>`<span class="mk ${m.k}">${m.blank?'—':(m.k==='o'?'◎':m.k==='t'?'△':'✕')} ${esc(m.it)}</span>`).join('')}
          ${r.perfect?`<span class="mk o">🎯 完全一致 +${PERFECT_BONUS}</span>`:''}
        </div>
        ${open && gu ? `<div style="margin-top:10px">${tierTable(items, gu.assign, cfg, hl, true)}</div>` : ''}
      </div>`;
    }).join('')}
    <div class="card flat">
      <div class="row"><div style="flex:1;font-weight:900">👑 ${esc(par.name)}（親・子の平均点）</div>
        <div style="font-weight:900;font-size:21px;color:var(--acc)">${g.cur.parentPts}</div></div>
    </div>
    <div class="stack">
      ${amHost(g)?`<button class="btn pri" onclick="A.next()">スコアをみる</button>`
                 :`<div class="tiny cen" style="padding:10px">ホストが進めるのを待っています…</div>`}
    </div>
  </div>`;
}

function scScore(g){
  const last = g.history[g.history.length-1] || {gained:{}};
  const rank = g.players.slice().sort((a,b)=>b.total-a.total);
  const end = g.round >= g.totalRounds;
  return `<div class="screen">
    ${hdr(`ROUND ${g.round} / ${g.totalRounds} おわり`, menuBtn())}
    <h1>とちゅう経過</h1>
    <p class="mut" style="margin-bottom:16px">${esc(last.topic||'')}</p>
    ${rank.map((p,i)=>`<div class="sc ${p.id===ME.id?'me':''}">
      <div class="rk">${['🥇','🥈','🥉'][i]||(i+1)}</div>
      <div class="nm2">${esc(p.name)}${last.parentId===p.id?' <span class="badge">👑親</span>':''}</div>
      <div style="text-align:right"><div class="pt">${p.total}</div><div class="dl">+${last.gained[p.id]||0}</div></div>
    </div>`).join('')}
    <div class="stack">
      ${amHost(g)?`<button class="btn pri" onclick="A.next()">${end?'けっか発表へ':`ROUND ${g.round+1} へ（親：${esc((g.players[(g.parentIdx+1)%g.players.length]||{}).name||'')}）`}</button>`
                 :`<div class="tiny cen" style="padding:10px">ホストが進めるのを待っています…</div>`}
    </div>
  </div>`;
}

function scFinal(g){
  const rank = g.players.slice().sort((a,b)=>b.total-a.total);
  const top = rank.length?rank[0].total:0;
  const win = rank.filter(p=>p.total===top);
  const name = id => { const p = g.players.find(x=>x.id===id); return p?p.name:'？'; };
  return `<div class="screen">
    <div class="cen" style="margin-bottom:8px">
      <div class="hero">👑</div>
      <h1>ゆうしょう</h1>
      <div class="big" style="color:var(--acc);margin:6px 0 2px">${win.map(p=>esc(p.name)).join(' & ')}</div>
      <div class="tiny">${top}点 ／ 全${g.totalRounds}ラウンド</div>
    </div>
    <div class="hr"></div>
    ${rank.map((p,i)=>`<div class="sc ${p.id===ME.id?'me':''}">
      <div class="rk">${['🥇','🥈','🥉'][i]||(i+1)}</div>
      <div class="nm2">${esc(p.name)}</div><div class="pt">${p.total}</div></div>`).join('')}
    <h3>ふりかえり（タップで展開）</h3>
    ${g.history.map((h,i)=>{
      const open = UI.expand === 'h'+i;
      return `<div class="card tap" onclick="A.toggle('h${i}')">
        <div class="row"><span class="pill">R${i+1}</span>
          <div style="flex:1;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.topic)}</div>
          <span class="tiny">👑${esc(name(h.parentId))}</span><span class="tiny">${open?'▲':'▼'}</span></div>
        ${open?`<div style="margin-top:9px">${tierTable(h.items, h.ptier, g.cfg, null, true)}</div>`:''}
      </div>`;
    }).join('')}
    <div class="stack">
      ${amHost(g)?`<button class="btn pri" onclick="A.next()">同じメンバーでもう1回</button>`:''}
      <button class="btn ghost" onclick="A.leave()">部屋から出る</button>
    </div>
  </div>`;
}

/* =========================================================
   入口の画面
   ========================================================= */
function scHome(){
  const resume = lsGet(LS_LOCAL, null);
  const hasLocal = resume && resume.players && resume.players.length>=3 && resume.screen && resume.screen!=='home';
  const lastRoom = lsGet(LS_ROOM, null);
  const canBack = lastRoom && lastRoom.code && (now() - (lastRoom.at||0) < 6*3600*1000);
  return `<div class="screen center">
    <div class="hero">🔮</div>
    <h1 style="margin-top:8px">${APP_NAME}</h1>
    <p class="mut" style="margin:12px 0 26px;max-width:310px">
      親がこっそり作ったティア表を、<br>子が何人読み当てられるか勝負するゲーム。
    </p>
    <div style="width:100%;max-width:340px">
      ${canBack?`<button class="btn pink" onclick="A.rejoin()">↩️ さっきの部屋にもどる（${esc(lastRoom.code)}）</button>`:''}
      <button class="btn pri" onclick="A.goCreate()">部屋をつくる</button>
      <button class="btn ${canBack?'':'pink'}" onclick="A.goJoin()">部屋に入る</button>
      <button class="btn ghost" onclick="A.go('howto')">あそび方をみる</button>
      <div class="hr"></div>
      <button class="btn ghost" onclick="A.localStart()">📵 1台で回して遊ぶ（通信なし）</button>
      ${hasLocal?`<button class="btn ghost" onclick="A.localResume()">1台モードのつづきから</button>`:''}
    </div>
    <div class="tiny" style="margin-top:20px">3〜12人・スマホ推奨</div>
  </div>`;
}

function scHowto(){
  return `<div class="screen">
    ${hdr('あそび方')}
    <h2>ひとことで言うと</h2>
    <p class="mut">「この人ならこう並べるだろうな」を当てるゲームです。</p>
    <div class="hr"></div>
    <ol class="rules">
      <li><b>大お題をみんなで決める</b><br><span class="mut">例「好きなコンビニスイーツ」「LoLの好きなチャンピオン」など、ざっくりしたジャンル。</span></li>
      <li><b>親が項目を5個えらぶ</b><br><span class="mut">大お題の中から親が自由に入力。ここは全員に公開されます。</span></li>
      <li><b>親がこっそりティア分け</b><br><span class="mut">S/A/B/C/D に並べて確定。他の人の画面には出ません。</span></li>
      <li><b>子はいっせいに予想</b><br><span class="mut">制限時間内に、親のティア表を各自のスマホで予想します。</span></li>
      <li><b>全員ぶん公開＆採点</b></li>
    </ol>
    <div class="hr"></div>
    <h2>てんすう</h2>
    <div class="card flat">
      <div class="row" style="margin-bottom:6px"><span class="mk o">◎ ピタリ</span><span>親と同じティア <b>+3点</b></span></div>
      <div class="row" style="margin-bottom:6px"><span class="mk t">△ となり</span><span>1つ隣のティア <b>+1点</b></span></div>
      <div class="row"><span class="mk x">✕ はずれ</span><span>2つ以上ずれ <b>0点</b></span></div>
    </div>
    <div class="card flat"><b>🎯 完全一致ボーナス</b>
      <p class="mut" style="margin:6px 0 0">5個ぜんぶ親と同じティアに置けたら、さらに<b style="color:var(--ok)">+${PERFECT_BONUS}点</b>。15点満点＋ボーナスで最高<b>${3*5+PERFECT_BONUS}点</b>です。</p></div>
    <div class="card flat"><b>👑 親の得点</b>
      <p class="mut" style="margin:6px 0 0">そのラウンドの<b>子の平均点</b>が親の点になります。ひねりすぎても、ベタすぎても損する設計です。</p></div>
    <p class="mut">設定したラウンド数ぶん親が交代して、合計点がいちばん高い人の勝ち。</p>
    <div class="stack"><button class="btn pri" onclick="A.go('home')">とじる</button></div>
  </div>`;
}

function scCreate(){
  return `<div class="screen">
    ${hdr('部屋をつくる')}
    <h1>なまえを入れてね</h1>
    <p class="mut" style="margin-bottom:16px">あなたがホストになります。最後まで同じ端末で進行してください。</p>
    <input type="text" id="nm" maxlength="10" value="${esc(ME.name)}" placeholder="なまえ"
      oninput="A.setName(this.value)" onkeydown="if(event.key==='Enter'){this.blur();A.create()}">
    <div class="stack">
      <button class="btn pri" onclick="A.create()">部屋をつくる</button>
      <button class="btn ghost" onclick="A.go('home')">もどる</button>
    </div>
  </div>`;
}

function scJoin(){
  const d = dft('join', {code:''});
  return `<div class="screen">
    ${hdr('部屋に入る')}
    <h1>ルームコード</h1>
    <p class="mut" style="margin-bottom:14px">ホストの画面に出ている4文字を入れてね</p>
    <input type="text" id="cd" class="code" maxlength="4" value="${esc(d.code)}" placeholder="----"
      autocapitalize="characters" autocomplete="off" oninput="A.setCode(this.value)">
    <h3>なまえ</h3>
    <input type="text" id="nm" maxlength="10" value="${esc(ME.name)}" placeholder="なまえ"
      oninput="A.setName(this.value)" onkeydown="if(event.key==='Enter'){this.blur();A.join()}">
    <div class="stack">
      <button class="btn pri" onclick="A.join()">入る</button>
      <button class="btn ghost" onclick="A.go('home')">もどる</button>
    </div>
  </div>`;
}

/* =========================================================
   1台モード（通信なし・順番に回す）
   ========================================================= */
let L = null;

function newLocal(){
  return {
    screen:'players', players:[], cfg:{itemCount:5, tierCount:5, topicMode:'fixed', laps:1},
    topic:'', round:1, totalRounds:0, parentIdx:0, cur:null, draft:null, next:null, revealed:false, history:[]
  };
}
const lsave = () => lsSet(LS_LOCAL, L);
const lparent = () => L.players[L.parentIdx];
const lpl = id => L.players.find(p=>p.id===id);

function scLocal(){
  const v = {
    players:lPlayers, config:lConfig, topic:lTopic, handoff:lHandoff, items:lItems,
    ptier:lPtier, guess:lGuess, reveal:lReveal, result:lResult, final:lFinal
  }[L.screen];
  return v ? v() : '<div class="screen"><p>…</p></div>';
}
function lRoundHdr(){ return hdr(`ROUND ${L.round} / ${L.totalRounds}`, `<span class="pill on">親 ${esc(lparent().name)}</span>${menuBtn()}`); }

function lPlayers(){
  const ps = L.players;
  return `<div class="screen">
    ${hdr('1台モード・STEP 1 / 3')}
    <h1>メンバー</h1>
    <p class="mut" style="margin-bottom:16px">スマホを回す順番で入力してね（3〜12人）</p>
    <div class="scroll">
      ${ps.map((p,i)=>`<div class="row" style="margin-bottom:9px">
        <div class="pill" style="width:34px;justify-content:center;text-align:center">${i+1}</div>
        <input type="text" id="pn${i}" value="${esc(p.name)}" placeholder="なまえ" maxlength="10" oninput="A.lname(${i}, this.value)">
        ${ps.length>3?`<button class="btn sm ghost" style="padding:12px 13px" onclick="A.ldel(${i})">✕</button>`:''}
      </div>`).join('')}
      ${ps.length<12?`<button class="btn ghost" onclick="A.ladd()">＋ メンバーを追加</button>`:''}
    </div>
    <div class="stack">
      <button class="btn pri" onclick="A.lToConfig()">つぎへ</button>
      <button class="btn ghost" onclick="A.lQuit()">やめる</button>
    </div>
  </div>`;
}

function lConfig(){
  const c = L.cfg;
  return `<div class="screen">
    ${hdr('1台モード・STEP 2 / 3')}
    <h1>ルール設定</h1>
    <div class="card flat"><b>かたいルール</b>
      <div class="tiny" style="margin-top:6px;line-height:1.8">
        ・項目は <b>5個</b>、ティアは <b>S / A / B / C / D の5段</b><br>
        ・◎ピタリ +3／△となり +1／全部ピタリで +${PERFECT_BONUS}<br>
        ・親の点＝そのラウンドの子の平均点
      </div></div>
    <div class="card"><b>大お題</b>${seg([{v:'fixed',l:'ずっと同じ'},{v:'each',l:'親が毎回決める'}], c.topicMode,'A.lcfg_topicMode')}</div>
    <div class="card"><b>まわす回数</b><div class="tiny" style="margin:4px 0 9px">全${L.players.length*c.laps}ラウンド</div>${seg([{v:1,l:'1周'},{v:2,l:'2周'}], c.laps,'A.lcfg_laps')}</div>
    <div class="stack">
      <button class="btn pri" onclick="A.lToTopic()">つぎへ</button>
      <button class="btn ghost" onclick="A.lgo('players')">もどる</button>
    </div>
  </div>`;
}

function lTopic(){
  const each = L.cfg.topicMode==='each';
  const recent = (HIST.topics||[]).slice(0,10);
  return `<div class="screen">
    ${each ? lRoundHdr() : hdr('1台モード・STEP 3 / 3')}
    <h1>大お題をきめる</h1>
    <p class="mut" style="margin-bottom:14px">${each?`親の<b>${esc(lparent().name)}</b>さんが決めます。`:'みんなで話し合って、ざっくりしたジャンルを入れてね。'}</p>
    <input type="text" id="tp" value="${esc(L.draft||'')}" maxlength="30" placeholder="例）好きなコンビニスイーツ"
      oninput="A.ltdraft(this.value)" onkeydown="if(event.key==='Enter'){this.blur();A.ltopicOK()}">
    ${recent.length?`<h3>前に使ったお題</h3><div class="pickwrap">${recent.map(t=>`<button class="pick" onclick="A.ltdraft2('${jsq(t)}')">${esc(t)}</button>`).join('')}</div>`:''}
    <div class="stack">
      <button class="btn pri" onclick="A.ltopicOK()">これでいく</button>
      ${each?'':`<button class="btn ghost" onclick="A.lgo('config')">もどる</button>`}
    </div>
  </div>`;
}

function lHandoff(){
  const p = lpl(L.next.to), isP = L.next.role==='parent';
  return `<div class="screen center">
    <div class="pill" style="margin-bottom:20px">ROUND ${L.round} / ${L.totalRounds}</div>
    <div class="hero">📱</div>
    <h1 style="margin-bottom:6px">${esc(p.name)} さんへ</h1>
    <div class="pill ${isP?'on':''}" style="margin:10px 0 22px;font-size:14px;padding:8px 16px">${isP?'👑 あなたが親です':'🔍 親の心を読む番'}</div>
    <p class="mut" style="max-width:300px;margin-bottom:28px">スマホを ${esc(p.name)} さんに渡してください。<br>${isP?'他の人は画面を見ないように！':`親の<b>${esc(lparent().name)}</b>さんのティア表を予想します。`}</p>
    <div style="width:100%;max-width:340px"><button class="btn pri" onclick="A.lhandoff()">${esc(p.name)} です、はじめる</button></div>
  </div>`;
}

function lItems(){
  const d = L.draft, need = L.cfg.itemCount, topic = L.cur.topic;
  return `<div class="screen">
    ${lRoundHdr()}
    <div class="card flat"><div class="tiny">大お題</div><div style="font-size:18px;font-weight:900;margin-top:2px">${esc(topic)}</div></div>
    <h2>項目を ${need}個 えらぶ</h2>
    <p class="mut" style="margin-bottom:12px">ここは全員に見せてOK</p>
    <div class="row" style="margin-bottom:12px">
      <input type="text" id="it" value="${esc(d.text)}" maxlength="18" placeholder="項目をいれて Enter"
        enterkeyhint="done" autocomplete="off"
        oninput="A.lidraft(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();A.liadd()}">
      <button class="btn sm pri" style="padding:14px 18px" onpointerdown="event.preventDefault()" onclick="A.liadd()">追加</button>
    </div>
    <div class="row" style="margin-bottom:10px">
      <span id="cnt" class="pill ${d.list.length===need?'on':''}">${d.list.length} / ${need}</span>
      <button id="clr" class="btn sm ghost" style="display:${d.list.length?'':'none'}" onclick="A.liclear()">ぜんぶ消す</button>
    </div>
    <div id="chips" class="pickwrap" style="margin-bottom:6px">${itemChipsHTML(d.list,'A.lidel')}</div>
    <div id="recent" class="scroll">${itemRecentHTML(topic, d.list, 'A.liadd2')}</div>
    <div class="stack"><button id="okbtn" class="btn pri" ${d.list.length!==need?'disabled':''} onclick="A.litemsOK()">${d.list.length===need?'ティア分けへすすむ':`あと ${Math.max(0,need-d.list.length)}個`}</button></div>
  </div>`;
}

function lPtier(){
  const items = L.cur.items, d = L.draft;
  const done = items.filter(it=>d.assign[it]!==undefined).length;
  const used = new Set(items.map(it=>d.assign[it]).filter(v=>v!==undefined)).size;
  const ok = done===items.length && used>=2;
  return `<div class="screen">
    ${lRoundHdr()}
    <div class="card flat"><div class="tiny">${esc(L.cur.topic)}</div>
      <div style="font-size:16px;font-weight:900;margin-top:2px">👑 あなたのティア表をつくる</div>
      <div class="tiny" style="margin-top:5px">他の人に見られないように！ これを ${L.players.length-1}人が予想します。</div></div>
    <div class="sticky">${tierTable(items, d.assign, L.cfg)}</div>
    <div style="height:12px"></div>
    ${assignRows(items, d.assign, L.cfg, 'A.lset')}
    <div class="stack">
      ${used<2 && done===items.length?'<div class="tiny cen" style="margin-bottom:8px;color:var(--ng)">全部おなじティアはナシ！ 2段以上つかってね</div>':''}
      <button class="btn pri" ${ok?'':'disabled'} onclick="A.lptierOK()">${done<items.length?`あと ${items.length-done}個`:'これで確定する'}</button>
    </div>
  </div>`;
}

function lGuess(){
  const items = L.cur.items, d = L.draft;
  const me = lpl(L.cur.queue[L.cur.qpos]);
  const done = items.filter(it=>d.assign[it]!==undefined).length;
  return `<div class="screen">
    ${hdr(`ROUND ${L.round} / ${L.totalRounds}`, `<span class="pill">${esc(me.name)} の予想</span>${menuBtn()}`)}
    <div class="card flat"><div class="tiny">${esc(L.cur.topic)}</div>
      <div style="font-size:16px;font-weight:900;margin-top:2px">🔍 ${esc(lparent().name)} さんのティア表を予想</div>
      <div class="tiny" style="margin-top:5px">◎ピタリ +3／△となり +1／全部ピタリでさらに +${PERFECT_BONUS}</div></div>
    <div class="sticky">${tierTable(items, d.assign, L.cfg)}</div>
    <div style="height:12px"></div>
    ${assignRows(items, d.assign, L.cfg, 'A.lset')}
    <div class="stack"><button class="btn pri" ${done===items.length?'':'disabled'} onclick="A.lguessOK()">${done<items.length?`あと ${items.length-done}個`:'この予想で決定'}</button></div>
  </div>`;
}

function lReveal(){
  const c = L.cur, items = c.items;
  if(!L.revealed){
    return `<div class="screen center">
      <div class="pill" style="margin-bottom:18px">ROUND ${L.round} / ${L.totalRounds}</div>
      <div class="hero">🥁</div><h1>ぜんいん予想おわり！</h1>
      <p class="mut" style="margin:12px 0 30px;max-width:300px">スマホをみんなが見える場所に置いて…<br><b>${esc(lparent().name)}</b> さんの本当のティア表は——</p>
      <div style="width:100%;max-width:340px"><button class="btn pink" onclick="A.lreveal()">せーの、公開！</button></div>
    </div>`;
  }
  const res = c.queue.map(pid=>({id:pid, r:scoreOf(items, c.ptier, c.guesses[pid])})).sort((a,b)=>b.r.pts-a.r.pts);
  const avg = Math.max(0, Math.round(res.reduce((a,b)=>a+b.r.pts,0)/res.length));
  const mx = maxScore(L.cfg, items.length);
  return `<div class="screen">
    ${lRoundHdr()}
    <div class="tiny">${esc(c.topic)}</div>
    <h2>👑 ${esc(lparent().name)} さんの正解</h2>
    ${tierTable(items, c.ptier, L.cfg)}
    <h3>予想のけっか（タップで中身）</h3>
    ${res.map(({id,r},i)=>{
      const open = UI.expand===id, hl={}; r.marks.forEach(m=>hl[m.it]=m.k);
      return `<div class="card tap" onclick="A.toggle('${jsq(id)}')">
        <div class="row">
          <div style="width:26px;flex:0 0 26px;text-align:center;font-weight:900;color:var(--mut)">${['🥇','🥈','🥉'][i]||(i+1)}</div>
          <div style="flex:1;font-weight:900;font-size:15px">${esc(lpl(id).name)}</div>
          <div style="font-weight:900;font-size:21px;color:var(--acc)">${r.pts}<span style="font-size:11px;color:var(--mut)"> / ${mx}</span></div>
          <div class="tiny">${open?'▲':'▼'}</div>
        </div>
        <div class="marks">${r.marks.map(m=>`<span class="mk ${m.k}">${m.k==='o'?'◎':m.k==='t'?'△':'✕'} ${esc(m.it)}</span>`).join('')}
          ${r.perfect?`<span class="mk o">🎯 完全一致 +${PERFECT_BONUS}</span>`:''}</div>
        ${open?`<div style="margin-top:10px">${tierTable(items, c.guesses[id].assign, L.cfg, hl, true)}</div>`:''}
      </div>`;
    }).join('')}
    <div class="card flat"><div class="row"><div style="flex:1;font-weight:900">👑 ${esc(lparent().name)}（親・子の平均点）</div>
      <div style="font-weight:900;font-size:21px;color:var(--acc)">${avg}</div></div></div>
    <div class="stack"><button class="btn pri" onclick="A.lapply()">スコアをみる</button></div>
  </div>`;
}

function lResult(){
  const rank = L.players.slice().sort((a,b)=>b.total-a.total);
  const last = L.history[L.history.length-1];
  const end = L.round > L.totalRounds;
  return `<div class="screen">
    ${hdr(`ROUND ${L.round-1} おわり`, menuBtn())}
    <h1>とちゅう経過</h1>
    <p class="mut" style="margin-bottom:16px">${esc(last.topic)}</p>
    ${rank.map((p,i)=>`<div class="sc">
      <div class="rk">${['🥇','🥈','🥉'][i]||(i+1)}</div>
      <div class="nm2">${esc(p.name)}${last.parentId===p.id?' <span class="badge">👑親</span>':''}</div>
      <div style="text-align:right"><div class="pt">${p.total}</div><div class="dl">+${last.gained[p.id]||0}</div></div>
    </div>`).join('')}
    <div class="stack"><button class="btn pri" onclick="A.lnext()">${end?'けっか発表へ':`ROUND ${L.round} へ（親：${esc(L.players[L.parentIdx].name)}）`}</button></div>
  </div>`;
}

function lFinal(){
  const rank = L.players.slice().sort((a,b)=>b.total-a.total);
  const win = rank.filter(p=>p.total===rank[0].total);
  return `<div class="screen">
    <div class="cen" style="margin-bottom:8px">
      <div class="hero">👑</div><h1>ゆうしょう</h1>
      <div class="big" style="color:var(--acc);margin:6px 0 2px">${win.map(p=>esc(p.name)).join(' & ')}</div>
      <div class="tiny">${rank[0].total}点 ／ 全${L.totalRounds}ラウンド</div>
    </div>
    <div class="hr"></div>
    ${rank.map((p,i)=>`<div class="sc ${i===0?'me':''}"><div class="rk">${['🥇','🥈','🥉'][i]||(i+1)}</div>
      <div class="nm2">${esc(p.name)}</div><div class="pt">${p.total}</div></div>`).join('')}
    <h3>ふりかえり（タップで展開）</h3>
    ${L.history.map((h,i)=>{
      const open = UI.expand==='h'+i;
      return `<div class="card tap" onclick="A.toggle('h${i}')">
        <div class="row"><span class="pill">R${i+1}</span>
          <div style="flex:1;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.topic)}</div>
          <span class="tiny">👑${esc(lpl(h.parentId).name)}</span><span class="tiny">${open?'▲':'▼'}</span></div>
        ${open?`<div style="margin-top:9px">${tierTable(h.items, h.ptier, L.cfg, null, true)}</div>`:''}
      </div>`;
    }).join('')}
    <div class="stack">
      <button class="btn pri" onclick="A.lagain()">同じメンバーでもう1回</button>
      <button class="btn ghost" onclick="A.lQuit()">さいしょから</button>
    </div>
  </div>`;
}

function lStartRound(){
  L.cur = {topic: L.cfg.topicMode==='fixed'?L.topic:'', items:[], ptier:{}, guesses:{}, queue:[], qpos:0};
  L.revealed = false; L.draft = null;
  L.next = {to: lparent().id, role:'parent', then: L.cfg.topicMode==='fixed'?'items':'topic'};
  L.screen = 'handoff';
}

/* =========================================================
   画面の振り分け
   ========================================================= */
function scMenu(){
  const online = UI.screen==='room';
  const g = online ? ROOM.view() : null;
  const host = online && g && amHost(g);
  const playing = online ? (g && !['lobby','final'].includes(g.phase)) : (L && L.screen!=='final');
  return `<div class="screen">
    ${hdr('メニュー')}
    <h1>どうする？</h1>
    <p class="mut" style="margin-bottom:18px">${online ? (host?'あなたが進行役です':'進行はホストが操作します') : '1台モード'}</p>
    ${online ? `
      ${host ? `
        ${playing?`<button class="btn" onclick="A.mSkip()">⏭ このラウンドを飛ばす</button>`:''}
        ${playing?`<button class="btn pri" onclick="A.mEnd()">🏁 ここで終了して結果発表へ</button>`:''}
        <button class="btn" onclick="A.mLobby()">↩️ ロビーにもどす（スコアリセット）</button>
      ` : `<div class="card flat"><div class="tiny">進行の操作はホスト（${esc((g.players.find(p=>p.id===g.hostId)||{}).name||'')} さん）だけができます。ホストが抜けた場合は、残っている人の中から自動で交代します。</div></div>`}
      <button class="btn ghost" onclick="A.leave()">部屋から出る</button>
    ` : `
      ${playing?`<button class="btn pri" onclick="A.lEnd()">🏁 ここで終了して結果発表へ</button>`:''}
      <button class="btn ghost" onclick="A.lQuit()">最初からやりなおす</button>
    `}
    <div class="stack"><button class="btn ghost" onclick="A.menu(0)">とじる</button></div>
  </div>`;
}

function menuBtn(){
  return `<button class="pill" style="border:none;font-family:inherit;cursor:pointer;font-size:15px;padding:5px 13px" onclick="A.menu(1)">⋯</button>`;
}

function currentHTML(){
  if(UI.menu) return scMenu();
  switch(UI.screen){
    case 'home':   return scHome();
    case 'howto':  return scHowto();
    case 'create': return scCreate();
    case 'join':   return scJoin();
    case 'room':   return scRoom();
    case 'local':  return scLocal();
  }
  return scHome();
}

/* =========================================================
   操作
   ========================================================= */
function sendGuess(done){
  const d = ROOM.draft; if(!d) return;
  clearTimeout(ROOM.gTimer);
  const fire = ()=> sendToHost({t:'g', id:ME.id, assign:d.assign, done:!!done});
  if(done) fire(); else ROOM.gTimer = setTimeout(fire, 400);
}

const A = {
  go(s){ UI.screen = s; UI.menu = false; ROOM.draft = null; render(); },
  menu(v){ UI.menu = !!v; render(); },
  mSkip(){ if(confirm('このラウンドを飛ばして次へ進みます。いいですか？')){ UI.menu=false; HOST.skipRound(); } },
  mEnd(){ if(confirm('ここでゲームを終了して結果発表に進みます。いいですか？')){ UI.menu=false; HOST.endNow(); } },
  mLobby(){ if(confirm('ロビーに戻ります。スコアはリセットされます。いいですか？')){ UI.menu=false; HOST.toLobby(); } },
  lEnd(){ if(!confirm('ここで終了して結果発表に進みます。いいですか？')) return;
    UI.menu=false;
    if(!L.history.length){ return A.lQuit(); }
    L.totalRounds = L.history.length; L.screen='final'; lsave(); render(); },
  rejoin(){
    const r = lsGet(LS_ROOM, null); if(!r || !r.code) return;
    if(!ME.name || !ME.name.trim()){ UI.screen='join'; ROOM.draft={__k:'join', code:r.code}; render(); return; }
    ROOM.open('guest', r.code);
  },
  toggle(id){ UI.expand = (UI.expand===id) ? null : id; render(); },
  setName(v){ ME.name = String(v).slice(0,10); lsSet(LS_ME, ME); },

  /* --- 入口 --- */
  goCreate(){ UI.screen='create'; ROOM.draft=null; render(); },
  goJoin(){ UI.screen='join'; ROOM.draft=null; render(); },
  setCode(v){
    const d = dft('join',{code:''});
    d.code = String(v).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    const el = $('cd');                 /* 入力中は再描画しない（二重入力の原因） */
    if(el && el.value !== d.code) el.value = d.code;
  },

  create(){
    if(!ME.name.trim()){ toast('なまえを入れてね'); return; }
    ME.name = ME.name.trim(); lsSet(LS_ME, ME);
    ROOM.open('host', randCode());
  },
  join(){
    const d = dft('join',{code:''});
    if(d.code.length!==4){ toast('4文字のルームコードを入れてね'); return; }
    if(!ME.name.trim()){ toast('なまえを入れてね'); return; }
    ME.name = ME.name.trim(); lsSet(LS_ME, ME);
    ROOM.open('guest', d.code);
  },
  leave(){
    if(ROOM.role==='host' && HOST.g && HOST.g.phase!=='lobby' && HOST.g.phase!=='final'){
      if(!confirm('ゲーム中です。部屋を閉じると全員が抜けます。いいですか？')) return;
    }
    ROOM.leave();
  },
  copyLink(){
    const url = location.origin + location.pathname + '#' + ROOM.code;
    const done = ()=>toast('リンクをコピーしました');
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done, ()=>toast(url)); }
    else toast(url);
  },

  /* --- ホスト設定 --- */
  cfg_topicMode(v){ HOST.setCfg('topicMode', v); },
  cfg_timer(v){ HOST.setCfg('timer', v); },
  cfg_rounds(v){ HOST.setCfg('rounds', v); },
  setTopic(v){ if(HOST.g){ HOST.g.topic = String(v).slice(0,30); } },
  startGame(){ if(HOST.g && HOST.g.cfg.topicMode==='fixed' && !HOST.g.topic.trim()){ toast('大お題を入れてね'); return; } HOST.startGame(); },
  next(){ HOST.next(); },
  close(){ HOST.closeGuess(); },
  skip(){ if(confirm('このラウンドを飛ばして次へ進みます。いいですか？')) HOST.skipRound(); },

  /* --- 親の入力（オンライン） --- */
  dtopic(v){ ROOM.draft.text = v; },
  dtopic2(v){ ROOM.draft.text = v; render(); },
  topicOK(){
    const t = String(ROOM.draft.text||'').trim();
    if(!t){ toast('大お題を入れてね'); return; }
    pushHistTopic(t);
    sendToHost({t:'topic', id:ME.id, topic:t});
  },
  ditem(v){ ROOM.draft.text = v; },
  iadd(){
    const g = ROOM.view(), d = ROOM.draft;
    const t = String(d.text||'').trim(); if(!t) return;
    if(d.list.includes(t)){ toast('もう入ってるよ'); return; }
    if(d.list.length >= g.cfg.itemCount){ toast(`${g.cfg.itemCount}個までです`); return; }
    d.list.push(t); d.text = '';
    const inp = $('it'); if(inp){ inp.value = ''; inp.focus(); }
    patchItems();
  },
  iadd2(x){
    const g = ROOM.view(), d = ROOM.draft;
    if(d.list.includes(x)) return;
    if(d.list.length >= g.cfg.itemCount){ toast(`${g.cfg.itemCount}個までです`); return; }
    d.list.push(x); patchItems();
  },
  idel(i){ ROOM.draft.list.splice(i,1); patchItems(); },
  iclear(){ ROOM.draft.list = []; patchItems(); },
  itemsOK(){
    const g = ROOM.view(), d = ROOM.draft;
    if(d.list.length !== g.cfg.itemCount) return;
    pushHistItems(g.cur.topic, d.list);
    sendToHost({t:'items', id:ME.id, items:d.list.slice()});
  },
  pset(i,ti){ const g = ROOM.view(); ROOM.draft.assign[g.cur.items[i]] = ti; render(); },
  tierOK(){
    if(!confirm('このティア表で確定します。\nもう変更できません。いいですか？')) return;
    sendToHost({t:'tier', id:ME.id, ptier: Object.assign({}, ROOM.draft.assign)});
  },

  /* --- 子の予想（オンライン） --- */
  gset(i,ti){ const g = ROOM.view(); ROOM.draft.assign[g.cur.items[i]] = ti; render(); sendGuess(false); },
  submit(){ ROOM.draft.done = true; sendGuess(true); render(); },

  /* --- 1台モード --- */
  localStart(){ L = newLocal(); L.players = [0,1,2].map(()=>({id:uid(), name:'', total:0})); UI.screen='local'; L.screen='players'; lsave(); render(); },
  localResume(){ const s = lsGet(LS_LOCAL, null); if(!s) return; L = s; UI.screen='local'; render(); },
  lgo(s){ L.screen = s; lsave(); render(); },
  ladd(){ if(L.players.length>=12) return; L.players.push({id:uid(),name:'',total:0}); render(); },
  ldel(i){ if(L.players.length<=3) return; L.players.splice(i,1); render(); },
  lname(i,v){ L.players[i].name = v; },
  lToConfig(){
    const used = {};
    L.players.forEach((p,i)=>{
      let n = (p.name||'').trim() || `プレイヤー${i+1}`;
      if(used[n]){ used[n]++; n = `${n}${used[n]}`; } else used[n]=1;
      p.name = n;
    });
    if(L.players.length<3){ toast('3人以上でね'); return; }
    L.screen='config'; lsave(); render();
  },
  lcfg_topicMode(v){ L.cfg.topicMode=v; render(); },
  lcfg_laps(v){ L.cfg.laps=v; render(); },
  lToTopic(){
    L.totalRounds = L.players.length * L.cfg.laps;
    L.round=1; L.parentIdx=0; L.history=[]; L.players.forEach(p=>p.total=0);
    if(L.cfg.topicMode==='fixed'){ L.draft = L.topic||''; L.screen='topic'; }
    else lStartRound();
    lsave(); render();
  },
  ltdraft(v){ L.draft = v; },
  ltdraft2(v){ L.draft = v; render(); },
  ltopicOK(){
    const t = String(L.draft||'').trim();
    if(!t){ toast('大お題を入れてね'); return; }
    pushHistTopic(t);
    if(L.cfg.topicMode==='fixed'){ L.topic = t; lStartRound(); }
    else { L.cur.topic = t; L.draft = {list:[], text:''}; L.screen='items'; }
    lsave(); render();
  },
  lhandoff(){
    const n = L.next;
    if(n.then==='topic'){ L.draft=''; L.screen='topic'; }
    else if(n.then==='items'){ L.draft={list:[], text:''}; L.screen='items'; }
    else if(n.then==='guess'){ L.draft={assign:{}}; L.screen='guess'; }
    lsave(); render();
  },
  lidraft(v){ L.draft.text = v; },
  liadd(){
    const t = String(L.draft.text||'').trim(); if(!t) return;
    if(L.draft.list.includes(t)){ toast('もう入ってるよ'); return; }
    if(L.draft.list.length>=L.cfg.itemCount){ toast(`${L.cfg.itemCount}個までです`); return; }
    L.draft.list.push(t); L.draft.text='';
    const inp = $('it'); if(inp){ inp.value = ''; inp.focus(); }
    patchItems();
  },
  liadd2(x){
    if(L.draft.list.includes(x)) return;
    if(L.draft.list.length>=L.cfg.itemCount){ toast(`${L.cfg.itemCount}個までです`); return; }
    L.draft.list.push(x); patchItems();
  },
  lidel(i){ L.draft.list.splice(i,1); patchItems(); },
  liclear(){ L.draft.list=[]; patchItems(); },
  litemsOK(){
    L.cur.items = L.draft.list.slice();
    pushHistItems(L.cur.topic, L.cur.items);
    L.draft = {assign:{}}; L.screen='ptier'; lsave(); render();
  },
  lset(i,ti){ L.draft.assign[L.cur.items[i]] = ti; render(); },
  lptierOK(){
    if(!confirm('このティア表で確定します。\nもう変更できません。いいですか？')) return;
    L.cur.ptier = Object.assign({}, L.draft.assign);
    L.cur.queue = L.players.filter(p=>p.id!==lparent().id).map(p=>p.id);
    L.cur.qpos = 0; L.draft = null;
    L.next = {to:L.cur.queue[0], role:'child', then:'guess'};
    L.screen='handoff'; lsave(); render();
  },
  lguessOK(){
    const pid = L.cur.queue[L.cur.qpos];
    L.cur.guesses[pid] = {assign: Object.assign({}, L.draft.assign)};
    L.cur.qpos++; L.draft = null;
    if(L.cur.qpos < L.cur.queue.length){ L.next = {to:L.cur.queue[L.cur.qpos], role:'child', then:'guess'}; L.screen='handoff'; }
    else { L.revealed=false; L.screen='reveal'; }
    lsave(); render();
  },
  lreveal(){ L.revealed = true; lsave(); render(); },
  lapply(){
    const c = L.cur, gained = {};
    const res = c.queue.map(pid=>({id:pid, r:scoreOf(c.items, c.ptier, c.guesses[pid])}));
    res.forEach(({id,r})=>{ gained[id]=r.pts; lpl(id).total += r.pts; });
    const avg = Math.max(0, Math.round(res.reduce((a,b)=>a+b.r.pts,0)/res.length));
    gained[lparent().id] = avg; lparent().total += avg;
    L.history.push({topic:c.topic, items:c.items.slice(), ptier:Object.assign({},c.ptier), parentId:lparent().id, gained});
    L.round++; L.parentIdx = (L.parentIdx+1)%L.players.length;
    L.cur = null; L.screen='result'; UI.expand=null; lsave(); render();
  },
  lnext(){ if(L.round > L.totalRounds){ L.screen='final'; } else lStartRound(); lsave(); render(); },
  lagain(){
    L.players.forEach(p=>p.total=0); L.history=[]; L.round=1; L.parentIdx=0;
    L.totalRounds = L.players.length * L.cfg.laps;
    if(L.cfg.topicMode==='fixed'){ L.draft = L.topic; L.screen='topic'; } else lStartRound();
    lsave(); render();
  },
  lQuit(){
    if(!confirm('1台モードをやめて最初にもどります。よろしいですか？')) return;
    lsDel(LS_LOCAL); L = null; UI.screen='home'; render();
  }
};
window.A = A;

/* =========================================================
   起動
   ========================================================= */
function boot(){
  ME = lsGet(LS_ME, null) || {id: uid(), name: ''};
  if(!ME.id) ME.id = uid();
  lsSet(LS_ME, ME);
  HIST = lsGet(LS_HIST, {}) || {};

  const m = (location.hash||'').match(/^#(?:r=)?([A-Za-z0-9]{4})$/);
  if(m){
    UI.screen = 'join';
    ROOM.draft = {__k:'join', code:m[1].toUpperCase()};
  }
  render();
}
if(typeof document !== 'undefined' && document.getElementById('app')) boot();
