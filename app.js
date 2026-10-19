import { Chess } from './vendor/chess.js';
import { chibiSVG, backgroundSVG } from './chibi.js';
import { lemalin, blinkFrame, drawGrid, drawBackground } from './pixel.js';
import { Board3D } from './board3d.js';
import { LemalinMMD } from './lemalin-mmd.js';
import { LemalinVoice } from './voice.js';

const $ = s => document.querySelector(s);

/* ---------- Stockfish ---------- */
class Engine {
  constructor() {
    this.w = new Worker('vendor/stockfish-nnue-16-single.js');
    this.lis = null;
    this.q = Promise.resolve();
    this.w.onmessage = e => this.lis && this.lis(String(e.data));
    this.ready = this.cmd(['uci'], l => l === 'uciok').then(() => this.cmd(['isready'], l => l === 'readyok'));
  }
  cmd(lines, done) {
    return new Promise(res => {
      const out = [];
      this.lis = l => { out.push(l); if (done(l)) { this.lis = null; res(out); } };
      lines.forEach(x => this.w.postMessage(x));
    });
  }
  analyze(fen, { depth, movetime, skill = 20, elo = null } = {}) {
    const job = async () => {
      await this.ready;
      this.w.postMessage('setoption name Skill Level value ' + skill);
      this.w.postMessage('setoption name UCI_LimitStrength value ' + (elo ? 'true' : 'false'));
      if (elo) this.w.postMessage('setoption name UCI_Elo value ' + elo);
      this.w.postMessage('position fen ' + fen);
      const out = await this.cmd([depth ? 'go depth ' + depth : 'go movetime ' + movetime], l => l.startsWith('bestmove'));
      let cp = 0, mate = null, pv = [];
      for (const l of out) if (l.startsWith('info') && l.includes(' score ')) {
        const m = l.match(/score (cp|mate) (-?\d+)/);
        if (m) {
          if (m[1] === 'cp') { cp = +m[2]; mate = null; }
          else { mate = +m[2]; cp = mate > 0 ? 10000 - mate : -10000 - mate; }
        }
        const p = l.match(/ pv (.+)$/);
        if (p) pv = p[1].split(' ');
      }
      const best = out[out.length - 1].split(' ')[1];
      return { best, cp, mate, pv };
    };
    const p = this.q.then(job);
    this.q = p.catch(() => {});
    return p;
  }
}
const analyzer = new Engine(), player = new Engine();

/* ---------- 开局库 ---------- */
let BOOK = [];
fetch('openings.json').then(r => r.json()).then(j => {
  BOOK = j.map(([eco, fam, v, line]) => ({ eco, fam, v, name: fam + (v ? '·' + v : ''), moves: line ? line.split(' ') : [] }));
  if (typeof board3d !== 'undefined') renderUI();
});

/* ---------- 恶毒台词 ---------- */
const L = {
  start: ['哈啊……立体棋盘也要开始了吗？指挥官，慢慢来哦~', '好困……不过立体棋子转起来还挺好看的吧~', '棋盘准备好了……右键可以转转镜头哦。'],
  best: ['这步……和我想的一样哦，指挥官好厉害~', '嗯，完美的一步。奖励你……摸摸头吧~', '哦？指挥官今天很清醒嘛。'],
  good: ['不错的一步哦~', '稳稳的，我喜欢这样的指挥官吧~', '嗯嗯，这样就好。'],
  inacc: ['唔……这步有点松懈哦，是不是也困了？', '还有更好的下法哦，不过没关系吧~'],
  mist: ['哈啊？指挥官，这步不太好哦……', '诶……要不要用悔棋？我假装没看见吧~'],
  blun: ['……指挥官！这步会丢东西的哦，我都被吓醒了。', '呜，这步是大失误……要不要悔棋？我不会说出去的哦。'],
  check: ['将军哦~', '哈啊，被将军了……指挥官小心哦。'],
  giveCheck: ['将军！指挥官好帅哦~', '哦，将军了呢，对面慌了吧~'],
  capture: ['吃掉了哦，嗯……好吃吧~', '指挥官收下了一枚棋子哦。'],
  win: ['指挥官赢了哦！……嘿嘿，那现在可以一起睡午觉了吧~', '胜利！辛苦指挥官了，也辛苦我自己了吧~'],
  lose: ['输了也没关系哦，指挥官……我陪你复盘吧~', '哈啊……这局就当做梦，明天再赢回来吧~'],
  draw: ['和棋哦。平分秋色……也平分枕头吧~'],
  think: ['让我想想……哈啊……', '嗯……对面在想下一步了哦。'],
  hint: m => `指挥官，试试 ${m} 吧……我只说一次哦~`,
  undo: ['悔棋了哦……这次就当没发生吧~'],
  low: ['指挥官，时间不多了哦，快一点吧~'],
  // —— 通用语音句（气泡显示具体内容时，音频播这些）/ 局势心情 / 触摸 / 长考 / 催促 ——
  hintG: ["这样下吧……我只说一次哦~", "试试这里吧~", "嗯……这步应该不错哦。"],
  openG: ["是熟悉的开局呢~", "这个开局我知道哦。"],
  reviewMove: ["这步还可以更好哦……下次注意吧~"],
  adv: ["哼哼~这局是我的了哦。", "指挥官，要不要现在认输呀？", "嘿嘿，这就是空想级的实力~", "再这样下去，我边睡午觉边下都能赢~", "不行不行，指挥官要再加油哦~"],
  dis: ["刚才那步不算！", "指挥官……让我悔一步嘛~", "哼，我才没有输呢！", "Zzz……我睡着了，什么都没看见……", "不理你了啦！", "这、这是战术性撤退！"],
  even: ["嗯……势均力敌呢。", "还早还早，慢慢来~"],
  touchHead: ["嘿嘿……再摸一下也可以哦~", "呼啊……被摸头好舒服……"],
  touchCheek: ["唔！不要戳我的脸啦~", "哼，脸都被戳鼓了……"],
  touchHand: ["手、手吗……那就牵一下下吧……", "指挥官的手好暖和……"],
  touchOrn: ["发饰不可以乱碰哦~", "这、这个是很重要的东西！"],
  touchOther: ["指挥官？", "嗯？有什么事吗？"],
  touchAngry: ["够了啦！再戳我就生气了！", "呜……指挥官好坏~"],
  think2: ["嗯……让我想想……", "这里……还是那里呢……", "唔，有点难呢……"],
  urgeSoft: ["指挥官？还在想吗~", "哈啊……我都快睡着了……"],
  urgeHard: ["指挥官还没好吗~", "再不下我就要睡午觉了哦！"],
  urgeAdv: ["慢慢想也没用哦，哼哼~", "想好怎么认输了吗？"],
  urgeDis: ["指挥官~快一点嘛~", "呜……别让我等太久嘛……"]
};
const pick = a => a[Math.floor(Math.random() * a.length)];
let mood = 'sleepy', frame = 0, tick2 = 0;
let lm = null, lmLoading = false;
const voice = new LemalinVoice();
const artPixel = () => $('#artStyle').value === 'pixel';
function drawAvatar() {
  if (!artPixel()) { $('#avatar').innerHTML = chibiSVG(mood); return; }
  let c = $('#avatar canvas');
  if (!c) { $('#avatar').innerHTML = '<canvas class="px"></canvas>'; c = $('#avatar canvas'); }
  const blink = tick2 % 9 === 8 && mood !== 'happy' && mood !== 'yawn';
  drawGrid(c, blink ? blinkFrame(mood) : lemalin(mood, frame), 4);
}
setInterval(() => { tick2++; frame = tick2 % 2; if (artPixel()) drawAvatar(); }, 700);
let lastSayAt = 0;
/** t：气泡文字；vt：要播放的语音句（默认同 t；动态内容气泡用通用句） */
function say(t, m = 'sleepy', vt = null) {
  $('#bubble').textContent = t; mood = m; drawAvatar(); lastSayAt = performance.now();
  const dur = voice.play(vt || t);            // 0 = 无音频/未解锁/关闭 → 文字口型
  if (lm && lm.loaded && lm.visible) {
    if (dur) lm.stopSpeak();            // 口型改由 voice.onAmp → setMouthFromAudio
    else lm.speak(t);
  }
}
function drawBg() {
  if (artPixel()) { $('#bgArt').innerHTML = '<canvas class="px"></canvas>'; drawBackground($('#bgArt canvas')); }
  else $('#bgArt').innerHTML = backgroundSVG();
}

/* ---------- 音效 ---------- */
let ac;
function beep(f = 520, d = .08) {
  if (!$('#snd').checked) return;
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d * 3);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d * 3);
  } catch (e) {}
}

/* ---------- 状态 ---------- */
let game = new Chess(), me = 'w', flipped = false, sel = null, running = false, token = 0;
let clock = { w: 0, b: 0 }, inc = 0, timed = true, lastTick = 0, lowWarned = false;
let meta = [];
let evals = [0];
let arrow = null;
let view = null;
let rv = null;
let startFen = new Chess().fen();
let moveBusy = false;
let animMover = null;   // 动画期间：恶毒拿子算她自己的时间；玩家自己的走子动画不计时

function disp() {
  if (view === null) return game;
  const g = new Chess(startFen);
  const h = game.history({ verbose: true });
  for (let i = 0; i < view; i++) g.move(h[i]);
  return g;
}

const QN = {
  best: ['最佳', 'q-best', '★'], good: ['好棋', 'q-good', '✓'], inacc: ['不精确', 'q-inacc', '?!'],
  mist: ['错着', 'q-mist', '?'], blun: ['大失误', 'q-blun', '??'], book: ['开局库', 'q-book', '📖']
};
const PROMO_GLYPH = { q: '♕', r: '♖', b: '♗', n: '♘', Q: '♛', R: '♜', B: '♝', N: '♞' };

/* ---------- 3D 棋盘 ---------- */
const board3d = new Board3D($('#board3d'), {
  onSquareClick: sq => onSquareClick(sq)
});
function syncCineOpt(){ board3d.cinematicCaptures = $('#cineCap').checked; }
syncCineOpt();
$('#cineCap').onchange = () => { syncCineOpt(); localStorage.lm3dCine = $('#cineCap').checked ? '1' : '0'; };
if (localStorage.lm3dCine === '0') { $('#cineCap').checked = false; syncCineOpt(); }

function syncBoard3d(g = disp()) {
  board3d.syncPosition(g.board());
  const hist = g.history({ verbose: true });
  const last = hist[hist.length - 1] || null;
  const targets = sel && view === null ? game.moves({ square: sel, verbose: true }).map(m => ({ to: m.to, captured: !!m.captured })) : [];
  let kingSq = null;
  if (g.inCheck()) for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === g.turn()) kingSq = p.square;
  board3d.setSelection(sel, targets, last ? { from: last.from, to: last.to } : null, kingSq, arrow);
}

function renderUI() {
  const g = disp();
  syncBoard3d(g);
  renderMoves();
  renderOpening();
  renderClocks();
  renderEval();
}

function renderMoves() {
  const m = $('#moves'); m.innerHTML = '';
  meta.forEach((x, i) => {
    if (i % 2 === 0) m.innerHTML += `<span class="n">${i / 2 + 1}.</span>`;
    const q = x.q ? QN[x.q] : null;
    m.innerHTML += `<span class="m ${q ? q[1] : ''}${view === i + 1 ? ' cur' : ''}" data-ply="${i + 1}" title="${q ? q[0] : ''}">${x.san}${q ? ' ' + q[2] : ''}</span>`;
  });
  if (meta.length % 2) m.innerHTML += '<span></span>';
  m.scrollTop = 1e6;
}
function bookMatch(gm = game) {
  const h = gm.history();
  let best = null;
  for (const o of BOOK) if (o.moves.length <= h.length && o.moves.every((x, i) => x === h[i]) && (!best || o.moves.length >= best.moves.length)) best = o;
  const nm = new Map(), cnt = {};
  for (const o of BOOK) if (o.moves.length > h.length && h.every((x, i) => x === o.moves[i])) {
    const m = o.moves[h.length]; cnt[m] = (cnt[m] || 0) + 1;
    if (!nm.has(m) || o.moves.length === h.length + 1) nm.set(m, o.name);
  }
  const nextMoves = [...nm].sort((a, b) => cnt[b[0]] - cnt[a[0]]).slice(0, 4);
  return { best, next: nextMoves.map(([m, n]) => m + '（' + n + '）'), nextMoves, inBook: !!best && best.moves.length === h.length && h.length > 0 || (h.length > 0 && nextMoves.length > 0) };
}
function renderOpening() {
  const { best, next } = bookMatch(disp());
  $('#opName').textContent = best && best.moves.length ? `${best.eco} · ${best.fam}` : '—';
  $('#opVar').textContent = best && best.v ? best.v : '';
  $('#opBook').innerHTML = (best && best.moves.length ? '谱着：' + best.moves.map((x, i) => (i % 2 ? '' : (i / 2 + 1) + '.') + x).join(' ') + '<br>' : '') +
    (next.length ? '库内后续：<br>' + next.join('<br>') : '已离开开局库');
}
const fmt = ms => {
  if (!timed) return '∞';
  ms = Math.max(0, ms);
  const s = Math.ceil(ms / 1000);
  return s < 20 && ms < 20000 ? (ms / 1000).toFixed(1) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function renderClocks() {
  const top = flipped ? 'w' : 'b', bot = flipped ? 'b' : 'w';
  for (const [el, c] of [[$('#clockTop'), top], [$('#clockBot'), bot]]) {
    el.querySelector('.who').textContent = (c === 'w' ? '⚪ 白' : '⚫ 黑') + (c === me ? ' · 指挥官' : ' · 恶毒（引擎）');
    el.querySelector('.t').textContent = fmt(clock[c]);
    el.classList.toggle('active', running && game.turn() === c);
    el.classList.toggle('low', timed && clock[c] < 20000);
  }
}
function renderEval() {
  const cp = evals[evals.length - 1] ?? 0, c = Math.max(-1000, Math.min(1000, cp));
  const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * c)) - 1);
  const f = $('#evalFill');
  f.style.height = pct + '%';
  f.style.top = flipped ? '0' : 'auto';
  f.style.bottom = flipped ? 'auto' : '0';
  const t = Math.abs(cp) > 9000 ? (cp > 0 ? '+M' : '-M') + (10000 - Math.abs(cp)) : (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
  $('#evalTxt').textContent = t;
  $('#evalBar').title = '白方视角评估 ' + t;
}

/* ---------- 交互 ---------- */
function onSquareClick(s) {
  if (view !== null || !running || game.turn() !== me || moveBusy || board3d.inputLocked) return;
  const p = game.get(s);
  if (sel) {
    const mv = game.moves({ square: sel, verbose: true }).filter(m => m.to === s);
    if (mv.length) {
      if (mv.length > 1) return promo(sel, s);
      return playerMove({ from: sel, to: s });
    }
  }
  sel = p && p.color === me ? s : null;
  renderUI();
}

function promo(from, to) {
  const box = $('#promo');
  box.hidden = false;
  box.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.textContent = PROMO_GLYPH[me === 'w' ? t.toUpperCase() : t] || t;
    btn.onclick = () => { box.hidden = true; playerMove({ from, to, promotion: t }); };
    box.appendChild(btn);
  }
}

function playerMove(m) {
  sel = null; arrow = null;
  const fenBefore = game.fen();
  const mv = game.move(m);
  if (!mv) return renderUI();
  afterMove(mv, true, fenBefore);
}

let wasInBook = true;
function bookTalk(mv, byMe) {
  const { best, nextMoves, inBook } = bookMatch();
  const nm = best ? best.name : '';
  if (inBook && best) {
    const sug = nextMoves.length ? ` 谱着上接下来可以走 ${nextMoves.slice(0, 3).map(x => x[0]).join(' / ')} 吧~` : '';
    if (byMe) say(`指挥官，你走的是${nm}哦~`, 'happy', pick(L.openG));
    else say(`我回了 ${mv.san}，现在是${nm}哦~${game.turn() === me ? sug : ''}`, 'smug', pick(L.openG));
  } else if (wasInBook && game.history().length > 1) {
    wasInBook = false;
    say(`哈啊……从${byMe ? '指挥官这步' : '这里'}开始就离开谱着了哦，要靠自己想了吧~`, 'yawn', '哈啊……从这里开始就离开谱着了哦，要靠自己想了吧~');
  }
  if (!inBook) wasInBook = false;
}

async function afterMove(mv, byMe, fenBefore) {
  moveBusy = true;
  const mover = mv.color;
  if (timed && meta.length >= 1) clock[mover] += inc * 1000;
  const bm = bookMatch(), inBook = bm.best && bm.best.moves.length === game.history().length;
  meta.push({ san: mv.san, q: null, by: byMe });
  const idx = meta.length - 1;
  beep(mv.captured ? 330 : 520);

  animMover = mover;
  await board3d.animateMove(mv, game.board(), { actor: !byMe && lm && lm.loaded ? lm : null });
  animMover = null;
  sel = null;
  renderUI();
  moveBusy = false;
  if (lm && lm.loaded) {
    lm.lookAtSquare(board3d._sqToXZ(mv.to)[0], board3d._sqToXZ(mv.to)[1]);
    if (!byMe && game.inCheck()) lm.react('checkGive');       // 她将军玩家
    else if (byMe && game.inCheck()) lm.react('check');         // 玩家将军她
    else if (mv.captured) lm.react(byMe ? 'captured' : 'capture');
    else if (!byMe) lm.react(Math.random() < 0.45 ? 'nod' : 'smug');
  }

  const my = token;
  if (game.isGameOver()) return end();
  bookTalk(mv, byMe);
  if (!byMe && game.inCheck()) say(pick(L.check), 'shock');

  const ev = analyzer.analyze(game.fen(), { depth: 12 }).then(r => {
    if (my !== token) return;
    const cpW = mover === 'w' ? -r.cp : r.cp;
    evals[idx + 1] = cpW;
    const prev = evals[idx] ?? 0;
    const loss = Math.max(0, mover === 'w' ? prev - cpW : cpW - prev);
    const q = inBook && idx < 20 ? 'book' : loss <= 20 ? 'best' : loss <= 60 ? 'good' : loss <= 150 ? 'inacc' : loss <= 300 ? 'mist' : 'blun';
    meta[idx].q = q; meta[idx].loss = loss;
    renderMoves(); renderEval();
    updateMood(cpW, byMe);
    if (byMe && $('#liveFb').checked) {
      const [n] = QN[q];
      $('#fbLast').innerHTML = `你的 <b>${mv.san}</b>：<span class="${QN[q][1]}">${n}</span>${q !== 'book' && q !== 'best' ? `（损失约 ${(loss / 100).toFixed(1)} 兵）` : ''}`;
      if (q === 'book') {}
      else if (mv.san.includes('+') && (q === 'best' || q === 'good')) say(pick(L.giveCheck), 'happy');
      else if (mv.captured && (q === 'best' || q === 'good')) say(pick(L.capture), 'smug');
      else say(pick(L[q]), q === 'blun' || q === 'mist' ? 'shock' : q === 'best' ? 'happy' : 'sleepy');
    }
  });
  if (game.turn() !== me) await engineMove(my);
  await ev;
}

/** 像真人一样的思考时间（毫秒）：开局快、普通 2–5s、复杂/评估波动时偶尔 8–15s；剩余时间少时缩短 */
function humanThinkMs() {
  if ($('#pace').value === 'fast') return 250;
  const ply = game.history().length, rnd = (a, b) => a + Math.random() * (b - a);
  let ms;
  if (ply < 8 && bookMatch().inBook) ms = rnd(700, 1800);
  else if (ply < 6) ms = rnd(900, 2200);
  else {
    const e = evals.filter(x => x !== undefined), swing = e.length > 2 ? Math.abs(e[e.length - 1] - e[e.length - 3]) : 0;
    const complex = game.moves().length > 34 || swing > 120 || game.inCheck();
    ms = complex && Math.random() < 0.3 ? rnd(8000, 15000) : rnd(2000, 5000);
  }
  if (timed) {
    const her = me === 'w' ? 'b' : 'w', left = clock[her];
    ms = Math.min(ms, Math.max(300, left * 0.05));   // 不把自己的钟耗光
    if (left < 15000) ms = Math.min(ms, 600);
  }
  return ms;
}
async function engineMove(my) {
  const lvl = +$('#lvl').value, useElo = $('#useElo').checked;
  const mt = 150 + lvl * 60;
  const thinkMs = humanThinkMs();
  if (Math.random() < 0.35 || thinkMs > 7000) say(pick(L.think), 'yawn');
  lm?.react('think');
  if (thinkMs > 2500) setTimeout(() => { if (my === token && running && game.turn() !== me) lm?.react(pick(['thinkTap', 'thinkTilt', 'thinkFrown'])); }, 600);
  if (thinkMs > 7000) {
    setTimeout(() => { if (my === token && running && game.turn() !== me) { say(pick(L.think2), 'yawn'); lm?.react('thinkTilt'); } }, thinkMs * 0.45);
    setTimeout(() => { if (my === token && running && game.turn() !== me) lm?.react(pick(['thinkTap', 'thinkFrown'])); }, thinkMs * 0.75);
  }
  const t0 = performance.now();
  const r = await player.analyze(game.fen(), { movetime: mt, skill: lvl, elo: useElo ? +$('#elo').value : null });
  const rest = thinkMs - (performance.now() - t0);
  if (rest > 0) await new Promise(res => setTimeout(res, rest));
  lm?.react('idle');
  if (my !== token || !running) return;
  const fenBefore = game.fen();
  const mv = game.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
  if (mv) await afterMove(mv, false, fenBefore);
}

function tick() {
  const now = performance.now(), dt = now - lastTick;
  lastTick = now;
  if (!running || !timed || meta.length < 1) return;
  if (animMover && animMover === me) return;
  const c = animMover || game.turn();
  clock[c] -= dt;
  if (c === me && clock[c] < 20000 && !lowWarned) { lowWarned = true; say(pick(L.low), 'shock'); }
  if (clock[c] <= 0) { clock[c] = 0; end(c === me ? 'lose' : 'win', '超时'); }
  renderClocks();
}
setInterval(tick, 100);

function end(res, why) {
  running = false; token++;
  if (!res) {
    if (game.isCheckmate()) { res = game.turn() === me ? 'lose' : 'win'; why = '将杀'; }
    else {
      res = 'draw';
      why = game.isStalemate() ? '逼和' : game.isThreefoldRepetition() ? '三次重复' : game.isInsufficientMaterial() ? '子力不足' : '50 步规则';
    }
  }
  say(pick(L[res]), res === 'win' ? 'happy' : res === 'lose' ? 'sleepy' : 'smug');
  lm?.react(res === 'win' ? 'lose' : res === 'lose' ? 'win' : 'idle');
  beep(res === 'win' ? 780 : 260, .2);
  renderClocks();
  setTimeout(() => summary(res, why), 1500);
}
function summary(res, why) {
  const mine = meta.filter(x => x.by && x.q), cnt = {};
  mine.forEach(x => cnt[x.q] = (cnt[x.q] || 0) + 1);
  const scored = mine.filter(x => x.q !== 'book');
  const avg = scored.length ? scored.reduce((a, x) => a + Math.min(x.loss, 1000), 0) / scored.length : 0;
  const acc = Math.max(0, Math.min(100, 103 * Math.exp(-0.0045 * avg) - 3)).toFixed(0);
  const worst = scored.slice().sort((a, b) => b.loss - a.loss)[0];
  const s = $('#summary'); s.hidden = false;
  s.innerHTML = `<b>对局总结</b>：${{ win: '指挥官胜 🌙', lose: '恶毒胜', draw: '和棋' }[res]}（${why}）<br>开局：${$('#opName').textContent}<br>
  准确度（估）：<b>${acc}%</b>，平均损失 ${(avg / 100).toFixed(2)} 兵<br>` +
    Object.keys(QN).map(k => `<span class="${QN[k][1]}">${QN[k][0]} ${cnt[k] || 0}</span>`).join(' · ') +
    (worst && worst.loss > 100 ? `<br>最需要复盘的一步：<b>${worst.san}</b>` : '') +
    '<br><button id="goReview">🔍 开始复盘分析</button>' +
    `<br><i>${acc > 85 ? '哈啊……今天的指挥官好清醒，我都不用操心了哦~' : acc > 65 ? '整体还不错哦，几处小失误，下次注意吧~' : '有点迷糊的一局呢……复盘一下再睡吧，指挥官~'}</i>`;
}

$('#newGame').onclick = () => {
  token++; game = new Chess(); startFen = game.fen(); exitReview(); moodState = 'even'; lm?.setMood('even'); resetUrge();
  wasInBook = true; meta = []; evals = [0]; sel = null; arrow = null; lowWarned = false; moveBusy = false;
  $('#summary').hidden = true; $('#fbLast').textContent = ''; $('#promo').hidden = true;
  const sv = $('#side').value;
  me = sv === 'r' ? (Math.random() < .5 ? 'w' : 'b') : sv;
  flipped = me === 'b';
  board3d.setFlipped(flipped);
  board3d.setEngineColor(me === 'w' ? 'b' : 'w');
  let tc = $('#tc').value;
  if (tc === 'custom') tc = $('#cMin').value + '+' + $('#cInc').value;
  timed = tc !== 'none';
  if (timed) { const [m, i] = tc.split('+').map(Number); clock.w = clock.b = m * 60000; inc = i; }
  running = true; lastTick = performance.now();
  say(pick(L.start));
  lm?.react('start');
  renderUI();
  if (me === 'b') engineMove(token);
};
$('#hint').onclick = async () => {
  if (view !== null) return;
  if (!running || game.turn() !== me) return say('现在不是指挥官的回合哦~');
  say('嗯……让我看看……');
  const my = token;
  const r = await analyzer.analyze(game.fen(), { depth: 14 });
  if (my !== token) return;
  arrow = r.best;
  const t = new Chess(game.fen());
  const m = t.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
  say(L.hint(m ? m.san : r.best), 'smug', pick(L.hintG));
  renderUI();
};
$('#undo').onclick = () => {
  if (view !== null || !meta.length || moveBusy) return;
  token++;
  let n = game.turn() === me ? 2 : 1;
  if (meta.length < n) n = meta.length;
  for (let i = 0; i < n; i++) { game.undo(); meta.pop(); evals.length = meta.length + 1; }
  if (!running) running = true;
  sel = null; arrow = null; $('#summary').hidden = true;
  say(pick(L.undo));
  renderUI();
  if (game.turn() !== me) engineMove(token);
};
$('#flip').onclick = () => {
  flipped = !flipped;
  board3d.setFlipped(flipped);
  renderUI();
};
$('#resign').onclick = () => { if (running && meta.length && confirm('指挥官，真的要认输吗？')) end('lose', '认输'); };
$('#tc').onchange = () => $('#customTc').hidden = $('#tc').value !== 'custom';
const lvlNames = l => l <= 3 ? '（迷糊）' : l <= 8 ? '（半睡半醒）' : l <= 14 ? '（清醒）' : '（全力·不困了）';
$('#lvl').oninput = () => $('#lvlTxt').textContent = $('#lvl').value + lvlNames(+$('#lvl').value);
$('#lvl').oninput();
$('#useElo').onchange = () => { $('#eloRow').hidden = !$('#useElo').checked; $('#lvl').disabled = $('#useElo').checked; };
$('#elo').oninput = () => $('#eloTxt').textContent = $('#elo').value;
$('#artStyle').onchange = () => { $('#avatar').innerHTML = ''; drawBg(); drawAvatar(); localStorage.lm3dArt = $('#artStyle').value; };
if (localStorage.lm3dArt) $('#artStyle').value = localStorage.lm3dArt;
drawBg();
say('哈啊……指挥官，这是立体棋盘哦。左边选好时制和棋力，点「开始新对局」吧~');
renderUI();

/* ---------- 复盘 ---------- */
const wp = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);
function exitReview() {
  view = null; rv = null;
  $('#review').hidden = true;
  document.body.classList.remove('reviewing');
}
async function startReview() {
  const hist = game.history({ verbose: true });
  if (!hist.length) return say('还没有走过棋哦，指挥官~');
  running = false; token++;
  const my = token;
  view = hist.length; arrow = null;
  document.body.classList.add('reviewing');
  $('#review').hidden = false;
  $('#rvInfo').textContent = ''; $('#rvKeys').innerHTML = ''; $('#rvGraph').innerHTML = '';
  say('哈啊……那我认真看一遍棋谱哦，稍等一下吧~', 'yawn');
  const g = new Chess(startFen), res = [];
  for (let i = 0; i <= hist.length; i++) {
    if (my !== token) return;
    const r = await analyzer.analyze(g.fen(), { depth: 13 });
    const white = g.turn() === 'w' ? r.cp : -r.cp;
    let bestSan = r.best;
    if (g.isGameOver()) res.push({ cpW: g.isCheckmate() ? (g.turn() === 'w' ? -10000 : 10000) : 0, best: null, bestSan: '' });
    else {
      const t = new Chess(g.fen());
      try { bestSan = t.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] }).san; } catch (e) {}
      res.push({ cpW: white, best: r.best, bestSan });
    }
    $('#rvBar').style.width = (100 * (i + 1) / (hist.length + 1)) + '%';
    $('#rvPct').textContent = `分析中 ${i + 1}/${hist.length + 1}`;
    if (i < hist.length) g.move(hist[i]);
  }
  const bk = new Chess(startFen); let book = true;
  const moves = hist.map((m, i) => {
    bk.move(m);
    if (book) {
      const b = bookMatch(bk);
      book = !!(b.best && b.best.moves.length === i + 1 && startFen === new Chess().fen());
    }
    const a = res[i], b = res[i + 1], side = m.color === 'w' ? 1 : -1;
    const loss = Math.max(0, side * (a.cpW - b.cpW));
    const wl = Math.max(0, side === 1 ? wp(a.cpW) - wp(b.cpW) : wp(-a.cpW) - wp(-b.cpW));
    const accm = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * wl) - 3.1669));
    const q = book ? 'book' : (m.from + m.to + (m.promotion || '')) === a.best || loss <= 15 ? 'best' : wl < 5 ? 'good' : wl < 10 ? 'inacc' : wl < 20 ? 'mist' : 'blun';
    return { san: m.san, color: m.color, loss, wl, acc: accm, q, best: a.best, bestSan: a.bestSan };
  });
  const acc = c => {
    const xs = moves.filter(x => x.color === c);
    return xs.length ? (xs.reduce((s, x) => s + x.acc, 0) / xs.length).toFixed(1) : '—';
  };
  rv = { res, moves, accW: acc('w'), accB: acc('b') };
  $('#rvPct').textContent = `分析完成 · 白方准确度 ${rv.accW}% · 黑方准确度 ${rv.accB}%`;
  drawGraph(); keyMoments(); gotoPly(0);
  const bad = moves.filter(x => (x.q === 'blun' || x.q === 'mist') && x.color === me).length;
  say(bad ? `看完了哦，指挥官有 ${bad} 处比较大的失误，我在下面标出来了，点一下就能跳过去吧~` : '看完了哦……指挥官这局几乎没有大失误，好厉害，我可以安心睡了吧~', bad ? 'smug' : 'happy',
    bad ? '看完了哦，指挥官有几处比较大的失误，我在下面标出来了，点一下就能跳过去吧~' : null);
}
function drawGraph() {
  const n = rv.res.length, W = 600, H = 120;
  const x = i => i * W / Math.max(1, n - 1);
  const y = cp => H / 2 - (wp(cp) - 50) / 50 * (H / 2 - 4);
  const pts = rv.res.map((r, i) => `${x(i).toFixed(1)},${y(r.cpW).toFixed(1)}`).join(' ');
  const dots = rv.moves.map((m, i) => (m.q === 'blun' || m.q === 'mist')
    ? `<circle cx="${x(i + 1)}" cy="${y(rv.res[i + 1].cpW)}" r="5" fill="${m.q === 'blun' ? '#ff7aa0' : '#ffb36b'}" data-ply="${i + 1}"/>` : '').join('');
  $('#rvGraph').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#1a1f38"/>
   <polygon points="0,${H} ${pts} ${W},${H}" fill="#e8eef7"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#b49cff88" stroke-dasharray="4"/>
   <line id="rvCursor" x1="0" y1="0" x2="0" y2="${H}" stroke="#8fe3ff" stroke-width="2"/>${dots}</svg>`;
  $('#rvGraph svg').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    gotoPly(Math.round((e.clientX - r.left) / r.width * (n - 1)));
  };
}
function keyMoments() {
  $('#rvKeys').innerHTML = rv.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.q === 'blun' || m.q === 'mist')
    .sort((a, b) => b.m.wl - a.m.wl).slice(0, 8)
    .map(({ m, i }) => `<span class="key ${QN[m.q][1]}" data-ply="${i + 1}">${Math.floor(i / 2) + 1}${m.color === 'w' ? '.' : '…'}${m.san} ${QN[m.q][2]}</span>`).join('')
    || '<i>没有明显的转折点哦~</i>';
  document.querySelectorAll('#rvKeys .key').forEach(el => el.onclick = () => gotoPly(+el.dataset.ply));
}
function gotoPly(p) {
  if (!rv) return;
  const n = rv.moves.length;
  view = Math.max(0, Math.min(n, p));
  arrow = null;
  const m = rv.moves[view - 1];
  if (m) {
    if (m.q !== 'best' && m.q !== 'book' && m.best) arrow = m.best;
    $('#rvInfo').innerHTML = `第 ${Math.floor((view - 1) / 2) + 1} 回合 ${m.color === 'w' ? '白' : '黑'}方 <b>${m.san}</b>：<span class="${QN[m.q][1]}">${QN[m.q][0]}</span>` +
      (m.q !== 'best' && m.q !== 'book' && m.bestSan ? `，更好的是 <b>${m.bestSan}</b>（青色箭头）` : '') +
      ` · 局面评估 ${fmtEval(rv.res[view].cpW)}`;
    if (m.color === me && (m.q === 'blun' || m.q === 'mist'))
      say(`这步 ${m.san} 是${QN[m.q][0]}哦……${m.bestSan ? '走 ' + m.bestSan + ' 会好很多' : ''}，下次注意吧~`, 'shock', pick(L.reviewMove));
    else if (m.color === me && m.q === 'best') say('这步走得好哦，和我想的一样~', 'happy');
  } else $('#rvInfo').textContent = '初始局面 · 用 ← → 或按钮逐步查看';
  const c = document.getElementById('rvCursor');
  if (c) { const x = view * 600 / Math.max(1, n); c.setAttribute('x1', x); c.setAttribute('x2', x); }
  evalsView();
  renderUI();
}
const fmtEval = cp => Math.abs(cp) > 9000 ? (cp > 0 ? '白' : '黑') + '方将杀' : (cp > 0 ? '+' : '') + (cp / 100).toFixed(2);
function evalsView() {
  if (rv) {
    evals = rv.res.map(r => r.cpW).slice(0, view + 1);
    meta = rv.moves.map(m => ({ san: m.san, q: m.q, by: m.color === me, loss: m.loss }));
  }
}
$('#rvFirst').onclick = () => gotoPly(0);
$('#rvPrev').onclick = () => gotoPly(view - 1);
$('#rvNext').onclick = () => gotoPly(view + 1);
$('#rvLast').onclick = () => gotoPly(1e9);
$('#rvExit').onclick = () => { exitReview(); renderUI(); say('复盘结束了哦，再来一局吧~'); };
document.addEventListener('keydown', e => {
  if (!rv || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') gotoPly(view - 1);
  if (e.key === 'ArrowRight') gotoPly(view + 1);
});
$('#moves').addEventListener('click', e => {
  const el = e.target.closest('.m');
  if (el && rv) gotoPly(+el.dataset.ply);
});
$('#reviewBtn').onclick = startReview;
document.addEventListener('click', e => { if (e.target.id === 'goReview') startReview(); });

/* ---------- PGN ---------- */
$('#pgnBtn').onclick = () => {
  $('#pgnModal').hidden = false;
  $('#pgnText').value = game.history().length ? exportPgn() : '';
};
function exportPgn() {
  const g = new Chess(startFen);
  game.history().forEach(m => g.move(m));
  g.header('Event', '恶毒的月夜棋盘·3D', 'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    'White', me === 'w' ? '指挥官' : 'Le Malin (Stockfish)',
    'Black', me === 'b' ? '指挥官' : 'Le Malin (Stockfish)');
  const r = game.isCheckmate() ? (game.turn() === 'w' ? '0-1' : '1-0') : game.isDraw() ? '1/2-1/2' : '*';
  g.header('Result', r);
  return g.pgn();
}
$('#pgnCopy').onclick = async () => {
  $('#pgnText').value = exportPgn();
  try { await navigator.clipboard.writeText($('#pgnText').value); } catch (e) {}
  say('棋谱复制好了哦~');
};
$('#pgnDl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportPgn()], { type: 'application/x-chess-pgn' }));
  a.download = 'lemalin-3d-game.pgn'; a.click();
};
$('#pgnLoad').onclick = () => {
  const t = new Chess();
  const raw = $('#pgnText').value.trim().replace(/\r/g, '');
  try {
    try { t.loadPgn(raw); }
    catch (e1) { t.loadPgn(raw.replace(/^((?:\[[^\n]*\]\s*\n)+)\s*/, '$1\n')); }
  } catch (e) { return say('这份棋谱我看不懂哦……检查一下格式吧~', 'shock'); }
  token++; running = false; exitReview();
  const hdr = t.header();
  startFen = hdr.FEN || new Chess().fen();
  game = t;
  me = hdr.Black && /指挥官/.test(hdr.Black) ? 'b' : 'w';
  flipped = me === 'b';
  board3d.setFlipped(flipped);
  board3d.setEngineColor(me === 'w' ? 'b' : 'w');
  meta = game.history().map((s, i) => ({ san: s, q: null, by: (i % 2 === 0) === (me === 'w') }));
  evals = [0];
  $('#pgnModal').hidden = true;
  renderUI();
  startReview();
};
$('#pgnClose').onclick = () => $('#pgnModal').hidden = true;

window.__dbg3d = { game: () => game, board3d, meta: () => meta };

/* ---------- 局势心情：她优势臭屁 / 劣势耍赖 ---------- */
let moodState = 'even', moodSaidAt = 0;
function updateMood(cpW, byMe) {
  const her = me === 'w' ? 'b' : 'w';
  const herCp = her === 'w' ? cpW : -cpW;
  const st = herCp > 150 ? 'adv' : herCp < -150 ? 'dis' : 'even';
  const changed = st !== moodState;
  moodState = st; lm?.setMood(st);
  const now = performance.now();
  if (!running || now - moodSaidAt < 22000) return;
  if (!changed && Math.random() > 0.18) return;
  moodSaidAt = now;
  const fire = () => {
    if (!running || performance.now() - lastSayAt < 1500) return;   // 不抢刚说的话
    if (st === 'adv') { say(pick(L.adv), 'smug'); lm?.react(pick(['advHips', 'advChin', 'advWag', 'advLegs'])); }
    else if (st === 'dis') { say(pick(L.dis), 'shock'); lm?.react(pick(['disPout', 'disTurn', 'disSleep', 'disBeg'])); }
    else if (changed) { say(pick(L.even), 'sleepy'); lm?.react('nod'); }
  };
  setTimeout(fire, byMe ? 2600 : 1800);
}

/* ---------- 指挥官长考时催促（有冷却） ---------- */
let turnStartAt = performance.now(), urgeLevel = 0, urgeSoftAt = 25000, urgeHardAt = 52000, lastUrgeAt = 0;
function resetUrge() {
  turnStartAt = performance.now(); urgeLevel = 0;
  urgeSoftAt = 20000 + Math.random() * 10000; urgeHardAt = 45000 + Math.random() * 15000;
}
document.addEventListener('pointerdown', () => { if (urgeLevel === 0) turnStartAt = performance.now(); }, { capture: true, passive: true });
setInterval(() => {
  if (!running || view !== null || moveBusy || game.turn() !== me) { if (game.turn() !== me) resetUrge(); return; }
  const idle = performance.now() - turnStartAt, now = performance.now();
  if (now - lastUrgeAt < 25000) return;
  if (timed && clock[me] < 20000) return;   // 时间紧时别添乱
  if (urgeLevel === 0 && idle > urgeSoftAt) {
    urgeLevel = 1; lastUrgeAt = now;
    lm?.react(pick(['urgeTap', 'yawn', 'thinkTilt', 'advLegs']));
    if (now - lastSayAt > 6000) say(pick(moodState === 'adv' ? L.urgeAdv : moodState === 'dis' ? L.urgeDis : L.urgeSoft), 'sleepy');
  } else if (urgeLevel === 1 && idle > urgeHardAt) {
    urgeLevel = 2; lastUrgeAt = now;
    lm?.react(moodState === 'dis' ? 'disBeg' : 'urgePoke');
    say(pick(moodState === 'adv' ? L.urgeAdv : moodState === 'dis' ? L.urgeDis : L.urgeHard), moodState === 'adv' ? 'smug' : 'shock');
  }
}, 1000);

/* ---------- 触摸她（主画面未点到棋盘格时 / 右侧头像） ---------- */
let touchLog = [], lastTouchAt = 0;
function onTouchLm(region) {
  if (!region || !lm) return;
  const now = performance.now();
  if (now - lastTouchAt < 450) return;
  lastTouchAt = now;
  touchLog = touchLog.filter(t => now - t < 4000); touchLog.push(now);
  const angry = touchLog.length >= 4;
  lm.touch(region, angry);
  const key = angry ? 'touchAngry' : { head: 'touchHead', cheek: 'touchCheek', hand: 'touchHand', orn: 'touchOrn' }[region] || 'touchOther';
  say(pick(L[key]), angry ? 'shock' : region === 'head' ? 'happy' : region === 'cheek' ? 'shock' : 'sleepy');
  if (angry) touchLog = [];
}
board3d.onMissClick = rc => { if (lm && lm.loaded && lm.visible) onTouchLm(lm.pickRay(rc)); };
$('#avatar3d').addEventListener('pointerup', e => { if (lm && lm.loaded) onTouchLm(lm.pickAvatar(e)); });

/* ---------- 画质 / 节奏 ---------- */
const defQ = matchMedia('(pointer: coarse)').matches ? 'std' : 'high';
$('#quality').value = localStorage.lm3dQ || defQ;
function applyQuality() { board3d.setQuality($('#quality').value); lm?.setQuality($('#quality').value); localStorage.lm3dQ = $('#quality').value; }
$('#quality').onchange = applyQuality; applyQuality();
$('#pace').value = localStorage.lm3dPace || 'human';
$('#pace').onchange = () => { localStorage.lm3dPace = $('#pace').value; };

/* ---------- 对面就座的恶毒（加密 MMD 模型，仅私人使用） ---------- */
function syncAvatar() {
  const on = !!(lm && lm.loaded && $('#showLm').checked);
  if (lm) lm.avatarOn = on;
  $('#avatar3d').hidden = !on;
  $('#avatar').hidden = on;
}
const lmStatus = (t, cls = '') => { const el = $('#lmStatus'); el.textContent = t; el.className = cls; };
async function loadLemalin(pw) {
  if (lmLoading) return;
  if (lm && lm.loaded) { lm.setVisible(true); syncAvatar(); return; }
  if (!pw) { $('#lmRow').hidden = false; lmStatus('输入模型密码后点「载入」'); return; }
  lmLoading = true; lmStatus('解密并载入模型中……');
  const inst = new LemalinMMD(board3d);
  try {
    await inst.load(pw);
    lm = inst;
    if (localStorage.lm3dRemember === '1') localStorage.lm3dPw = pw; else delete localStorage.lm3dPw;
    $('#lmPw').value = '';
    $('#lmRow').hidden = true;
    lmStatus('恶毒已在对面就座 🌙', 'ok');
    lm.setVisible($('#showLm').checked);
    lm.attachAvatar($('#avatar3d'));
    lm.setQuality($('#quality').value); lm.setMood(moodState);
    syncAvatar();
    voice.onAmp = amp => { if (lm && lm.loaded && lm.visible) lm.setMouthFromAudio({ amp }); };
    try { const n = await voice.load(pw); lmStatus('恶毒已在对面就座 🌙 · 语音 ' + n + ' 句', 'ok'); }
    catch (ve) { console.warn('[voice]', ve); }
    say('哈啊……我坐到对面来了哦，指挥官，好好下吧~', 'happy');
  } catch (e) {
    inst.dispose();
    const msg = e.message === 'BAD_PASSWORD' ? '密码不对哦……已回退到 Q 版秘书'
      : e.message === 'NO_MODEL_FILE' ? '没找到模型包（models/lemalin.enc），已回退到 Q 版'
      : e.message === 'NO_WEBCRYPTO' ? '浏览器不支持解密（需 https 或 localhost），已回退到 Q 版'
      : '模型载入失败，已回退到 Q 版秘书';
    console.warn('[lemalin-mmd]', e);
    if (e.message === 'BAD_PASSWORD') delete localStorage.lm3dPw;
    $('#lmRow').hidden = false;
    lmStatus(msg, 'err');
  } finally { lmLoading = false; }
}
$('#lmRemember').checked = localStorage.lm3dRemember === '1';
$('#lmRemember').onchange = () => {
  localStorage.lm3dRemember = $('#lmRemember').checked ? '1' : '0';
  if (!$('#lmRemember').checked) delete localStorage.lm3dPw;
};
$('#voiceOn').checked = localStorage.lm3dVoice !== '0';
voice.setEnabled($('#voiceOn').checked);
$('#voiceOn').onchange = () => { voice.setEnabled($('#voiceOn').checked); localStorage.lm3dVoice = $('#voiceOn').checked ? '1' : '0'; };
$('#voiceVol').value = localStorage.lm3dVol || '80';
voice.setVolume((+$('#voiceVol').value) / 100);
$('#voiceVol').oninput = () => { voice.setVolume((+$('#voiceVol').value) / 100); localStorage.lm3dVol = $('#voiceVol').value; };
$('#showLm').onchange = () => {
  const on = $('#showLm').checked;
  localStorage.lm3dShow = on ? '1' : '0';
  if (on) loadLemalin(localStorage.lm3dPw || '');
  else { lm?.setVisible(false); $('#lmRow').hidden = true; lmStatus(''); }
  syncAvatar();
};
$('#lmLoad').onclick = () => loadLemalin($('#lmPw').value);
$('#lmPw').addEventListener('keydown', e => { if (e.key === 'Enter') loadLemalin($('#lmPw').value); });
if (localStorage.lm3dShow === '1') { $('#showLm').checked = true; loadLemalin(localStorage.lm3dPw || ''); }
window.__dbg3d.lm = () => lm;
