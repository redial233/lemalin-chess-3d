// 原创像素风 Q版「恶毒」：64x64 网格程序化绘制（蓬松白发、侧扫刘海、抱黄色小鸡抱枕；仅参考配色元素，非描摹）
export const PAL = {
  o:'#2b2342', // 轮廓
  h:'#f6f5fc', H:'#dcd6f2', j:'#aaa2d8', l:'#cfe4fa', P:'#f27c9c', r:'#f7c6cf', R:'#eaa3b2', Y:'#f0b04f', q:'#e9874a', // 头发 亮/中/暗
  s:'#fff1ea', S:'#f6d6cf',             // 皮肤
  w:'#ffffff', b:'#7fa6dc', B:'#4a68a8', d:'#2c3d73', // 眼白/虹膜/瞳孔
  p:'#ff9fb4', m:'#c4546f',             // 腮红 嘴
  n:'#2a3366', N:'#1a2046', c:'#8fe0f5', C:'#4fa9cc', // 洋装 / 蝴蝶结
  W:'#f2f5ff', k:'#e6e9f7', y:'#ffd683', v:'#b49cff'  // 领子 枕头 月亮 紫
};
const SZ = 64;
function grid(){ return Array.from({ length: SZ }, () => Array(SZ).fill(null)); }
function ell(g, cx, cy, rx, ry, c, cond){ for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry; if (dx * dx + dy * dy <= 1 && (!cond || cond(x, y, g[y][x]))) g[y][x] = c; } }
function rect(g, x0, y0, x1, y1, c){ for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < SZ && x >= 0 && x < SZ) g[y][x] = c; }
function px(g, pts, c){ for (const [x, y] of pts) if (g[y]) g[y][x] = c; }
function outline(g){ const o = g.map(r => r.slice()); for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (!g[y][x]) { for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const v = g[y + dy] && g[y + dy][x + dx]; if (v && v !== 'o') { o[y][x] = 'o'; break; } } } return o; }
function mirror(fn){ return (x, ...a) => { fn(x, ...a); }; }

const EX = [24, 40], EY = 28; // 眼睛位置（左上角 x = cx-4）
function eyes(g, mode){
  const E = (cx, look) => { const L = cx - 4, T = EY;
    if (mode === 'yawn') { px(g, [[L,T+5],[L+1,T+6],[L+2,T+6],[L+3,T+6],[L+4,T+6],[L+5,T+6],[L+6,T+6],[L+7,T+5]], 'o'); return; }
    if (mode === 'happy') { px(g, [[L,T+6],[L+1,T+5],[L+2,T+4],[L+3,T+4],[L+4,T+4],[L+5,T+4],[L+6,T+5],[L+7,T+6]], 'o'); px(g, [[L+1,T+6],[L+6,T+6]], 'o'); return; }
    rect(g, L+1, T, L+6, T, 'o'); rect(g, L, T+1, L+7, T+1, 'o');
    if (mode === 'shock') { rect(g, L, T+2, L+7, T+9, 'w'); rect(g, L+3, T+4, L+5, T+7, 'b'); rect(g, L+3, T+5, L+4, T+6, 'd'); px(g, [[L+3,T+4]], 'w'); px(g, [[L-1,T+2],[L+8,T+2],[L-1,T+3],[L+8,T+3]], 'o'); rect(g, L+1, T+10, L+6, T+10, 'o'); return; }
    rect(g, L, T+2, L+7, T+10, 'b'); rect(g, L, T+2, L+7, T+4, 'B'); rect(g, L+1, T+11, L+6, T+11, 'o');
    rect(g, L+2+look, T+4, L+5+look, T+9, 'd'); rect(g, L+1, T+10, L+6, T+10, 'c');
    rect(g, L+1+look, T+2, L+3+look, T+4, 'w'); px(g, [[L+6+look,T+7],[L+5+look,T+8]], 'w');
    px(g, [[L-1,T+1],[L+8,T+1],[L-1,T+2]], 'o');
    if (mode === 'sleepy' || mode === 'smug') { const h = mode === 'smug' ? 3 : 4; rect(g, L-1, T, L+8, T + h, 's'); rect(g, L, T + h + 1, L+7, T + h + 1, 'o'); px(g, [[L-1,T+h+1],[L+8,T+h]], 'o'); }
  };
  const look = mode === 'smug' ? 1 : 0; E(EX[0], look); E(EX[1], look);
  if (mode === 'yawn') px(g, [[46,EY+7],[46,EY+8],[47,EY+8]], 'c');
  if (mode === 'shock') px(g, [[51,20],[51,21],[50,22],[51,22],[52,22],[51,23]], 'c');
}
function mouth(g, mode){ const Y = 42;
  if (mode === 'yawn') { rect(g, 31, Y-1, 33, Y+1, 'm'); px(g, [[30,Y],[34,Y],[31,Y+2],[32,Y+2],[33,Y+2],[31,Y-2],[32,Y-2],[33,Y-2],[30,Y-1],[34,Y-1],[30,Y+1],[34,Y+1]], 'o'); px(g, [[32,Y+1]], 'p'); return; }
  if (mode === 'shock') { px(g, [[32,Y-1],[33,Y-1]], 'o'); rect(g, 32, Y, 33, Y, 'm'); px(g, [[31,Y],[34,Y],[32,Y+1],[33,Y+1]], 'o'); return; }
  if (mode === 'happy') { px(g, [[29,Y-1],[35,Y-1],[30,Y],[34,Y]], 'o'); rect(g, 31, Y, 33, Y, 'm'); rect(g, 31, Y+1, 33, Y+1, 'o'); return; }
  if (mode === 'smug') { px(g, [[30,Y],[31,Y+1],[32,Y+1],[33,Y],[34,Y-1]], 'o'); return; }
  px(g, [[31,Y],[33,Y]], 'o'); px(g, [[32,Y+1]], 'o');
}
export function lemalin(mode = 'sleepy', frame = 0){
  const g = grid();
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 粉色床品（背景点缀）
  ell(g, 10, 52, 12, 10, 'r'); ell(g, 55, 50, 11, 11, 'r'); ell(g, 8, 56, 8, 5, 'R', (x, y, v) => v === 'r' && y > 55);
  // 蓬松凌乱的长发（无丸子头）：不规则外缘 + 飞出的发丝
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const a = Math.atan2(y - 30, x - 32), bump = 2.2 * Math.abs(Math.sin(a * 6)) + 1.0 * Math.sin(a * 13 + 1) - 1;
    const dx = (x + .5 - 32) / (25 + bump), dy = (y + .5 - 30) / (24 + bump); if (dx * dx + dy * dy <= 1) g[y][x] = 'H'; }
  for (let y = 28; y < 60; y++) { const t = (y - 28) / 32, w = Math.round(7 - 2 * t); const x0 = 6 - Math.round(3 * t * t), x1 = 57 + Math.round(3 * t * t);
    rect(g, x0, y, x0 + w, y, 'H'); rect(g, x1 - w, y, x1, y, 'H'); }
  const strands = [[[14,6],[11,3],[9,2]], [[48,6],[52,3],[55,3]], [[30,5],[29,2],[30,0]], [[36,5],[38,2],[40,1]], [[6,24],[3,22],[2,19]], [[58,26],[61,24],[62,21]], [[5,44],[2,47],[1,51]], [[59,46],[62,50]]];
  for (const st of [[[30,6],[30,5],[29,4],[29,3],[28,2],[31,5],[30,4]], [[37,6],[38,5],[38,4],[39,3],[37,5]], [[7,22],[6,21],[5,20],[6,22],[7,23]], [[57,25],[58,24],[59,23],[57,24]]]) px(g, st, 'h');
  // 头发明暗：亮部 h、蓝色高光 l、暗部 j
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (g[y][x] === 'H') { const d = Math.hypot((x - 28) / 25, (y - 18) / 24); g[y][x] = d < .7 ? 'h' : d < 1.12 ? 'H' : 'j'; }
  // 发束分隔线（少量弯曲线）
  for (const [x0, y0, dx] of [[12, 20, -1], [52, 22, 1], [10, 34, -1], [54, 36, 1], [20, 8, -1], [44, 9, 1]]) for (let i = 0; i < 9; i++) { const x = x0 + Math.round(dx * i * .4), y = y0 + i; if (g[y] && g[y][x] && 'hH'.includes(g[y][x])) g[y][x] = 'j'; }
  // 抱着的黄色圆滚滚小鸡抱枕
  ell(g, 32, 60, 22, 13, 'y'); ell(g, 38, 63, 16, 6, 'Y', (x, y, v) => v === 'y'); ell(g, 14, 50, 4, 4, 'y'); // 小耳朵
  px(g, [[24,53],[24,54],[24,55],[40,53],[40,54],[40,55]], 'o'); // 小眼睛（竖线）
  px(g, [[31,56],[32,56],[33,56],[32,57]], 'q'); px(g, [[20,57],[21,57],[43,57],[44,57]], 'p');
  // 肩/脖子
  rect(g, 27, 44, 37, 47, 's'); px(g, [[26,47],[38,47]], 'n'); rect(g, 22, 48, 42, 48, 'n');
  ell(g, 13, 52, 4, 3, 's'); ell(g, 51, 52, 4, 3, 's'); // 手
  // 脸
  ell(g, 32, 33, 16.5, 14, 's');
  eyes(g, mode);
  rect(g, 17, 39, 22, 40, 'p'); rect(g, 42, 39, 47, 40, 'p'); px(g, [[19,39],[44,39],[20,40],[45,40]], 'P'); px(g, [[18,41],[21,41],[43,41],[46,41]], 'p');
  mouth(g, mode);
  // 侧扫刘海：从右上斜向左下，遮住左眼上半
  const bottom = x => { const jag = [0, 1, 3, 2, 0, 2, 1][x % 7]; return x < 31 ? Math.round(36 - (x - 14) * .3) + jag : Math.round(27 - (x - 31) * .3) + jag; };
  for (let x = 13; x <= 52; x++) for (let y = 12; y <= bottom(x); y++) { const v = g[y][x]; if (v !== null) g[y][x] = 'h'; }
  for (let x = 13; x <= 52; x++) { const b = bottom(x); if (g[b + 1] && 'swbBdcCoSpP'.includes(g[b + 1][x] || '-')) g[b][x] = 'j'; }
  // 斜向发丝线 + 蓝色高光
  for (let k = 0; k < 4; k++) for (let i = 4; i < 14; i++) { const x = 46 - k * 8 - Math.round(i * .8), y = 14 + i; if (g[y] && g[y][x] && 'hH'.includes(g[y][x]) && y < bottom(x) - 1) g[y][x] = 'H'; }
  px(g, [[22,18],[23,17],[24,17],[25,16],[34,14],[35,14],[36,13]], 'l'); px(g, [[26,16],[37,13]], 'w');
  // 侧边长发垂到脸颊两侧
  for (let y = 26; y < 48; y++) { const e = Math.round((y - 26) / 10); rect(g, 13 + e, y, 16 + e, y, 'h'); rect(g, 48 - e, y, 51 - e, y, 'h'); px(g, [[14 + e, y], [50 - e, y]], 'H'); px(g, [[16 + e, y], [48 - e, y]], 'j'); }
  let out = outline(g);
  if (frame) { out = [Array(SZ).fill(null), ...out.slice(0, SZ - 1)]; }
  return out;
}
export function blinkFrame(mode){ const g = lemalin(mode, 0); if (mode === 'happy' || mode === 'yawn') return g; // 眨眼：把眼睛区域换成闭眼线
  for (const cx of EX) { const L = cx - 4; for (let y = EY; y < EY + 11; y++) for (let x = L - 1; x <= L + 8; x++) if (g[y][x] && 'wbBdCoc'.includes(g[y][x])) g[y][x] = 's'; for (let x = L; x <= L + 7; x++) g[EY + 6][x] = 'o'; g[EY + 5][L - 1] = 'o'; g[EY + 5][L + 8] = 'o'; }
  return g; }
export function drawGrid(canvas, g, scale = 4){ canvas.width = SZ * scale; canvas.height = SZ * scale; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { const c = g[y][x]; if (c) { ctx.fillStyle = PAL[c]; ctx.fillRect(x * scale, y * scale, scale, scale); } } }

// 像素夜空背景（含睡在月亮上的小恶毒）
export function drawBackground(canvas){
  const W = 320, H = 180; canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
  for (let y = 0; y < H; y++) { const t = y / H; ctx.fillStyle = `rgb(${Math.round(7 + 12 * t)},${Math.round(10 + 10 * t)},${Math.round(24 + 28 * t)})`; ctx.fillRect(0, y, W, 1); }
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) { const x = Math.floor(r() * W), y = Math.floor(r() * H * .8), b = r(); ctx.fillStyle = b > .9 ? '#ffe08a' : b > .6 ? '#b49cff' : '#e8eef7'; ctx.globalAlpha = .35 + b * .5; ctx.fillRect(x, y, 1, 1); if (b > .93) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } }
  ctx.globalAlpha = 1;
  // 月亮
  const mx = 262, my = 118, R = 22; for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const d = x * x + y * y, d2 = (x + 11) ** 2 + (y - 7) ** 2; if (d <= R * R && d2 > (R - 3) ** 2) { ctx.fillStyle = d > (R - 2) ** 2 ? '#b9c8ef' : (x + y) % 9 === 0 ? '#cfdcfa' : '#e6eeff'; ctx.fillRect(mx + x, my + y, 1, 1); } }
  // 小恶毒睡在月牙上（12x8 像素）
  const tiny = ['..h..h......', '.hhhhhh.h...', 'hhhhhhhhhh..', 'hhhsssshhhh.', 'hhs-s-sshhhhh', '.hssssshhhkkk', '..nnnnnnkkkk', '...nnnn..kk.'];
  const tp = { h: '#f4f6fc', s: '#fff1ea', '-': '#2b2342', n: '#2a3366', k: '#ffd683' };
  tiny.forEach((row, y) => [...row].forEach((c, x) => { if (tp[c]) { ctx.fillStyle = tp[c]; ctx.fillRect(mx - 16 + x, my + 10 + y, 1, 1); } }));
  ctx.fillStyle = '#8fe3ff'; ctx.fillRect(mx - 10, my + 8, 2, 1); ctx.fillRect(mx - 9, my + 7, 1, 1); ctx.fillStyle = '#b49cff'; ctx.fillRect(mx - 5, my + 3, 1, 1);
  // 云/枕头山
  ctx.fillStyle = '#1c2450'; for (let x = 0; x < W; x++) { const h = 10 + Math.round(5 * Math.sin(x / 13) + 3 * Math.sin(x / 5.3)); ctx.fillRect(x, H - h, 1, h); }
  ctx.fillStyle = '#141a3c'; for (let x = 0; x < W; x++) { const h = 5 + Math.round(3 * Math.sin(x / 9 + 1)); ctx.fillRect(x, H - h, 1, h); }
}
