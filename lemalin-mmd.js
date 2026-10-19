/**
 * 对面坐着的恶毒（MMD）
 * 模型：碧蓝航线CrossWave / Ricetans90° / 洛城提熙 —— 仅私人使用，仓库中只存加密包 models/lemalin.enc
 * 流程：fetch 加密包 → WebCrypto(PBKDF2-SHA256 + AES-GCM) 解密 → 内存 blob URL → three MMDLoader
 */
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';

const MAGIC = 'LMENC1';
const ENC_URL = 'models/lemalin.enc';
const VIRTUAL = 'lmvirtual/';
// 1 MMD 单位 ≈ 8cm；棋盘 1 格 ≈ 10cm（棋盘当作桌面），所以缩放约 0.8
const SCALE = 0.8;
const SEAT_DIST = 6.3;   // 椅子离棋盘中心（棋盘本地 z）
const FLOOR_Y = -6.3;    // 地面（桌面 = 棋盘 y=0）

let encCache = null;

/** 解密：错误密码会抛 'BAD_PASSWORD' */
export async function decryptModel(password) {
  if (!crypto?.subtle) throw new Error('NO_WEBCRYPTO');
  if (!encCache) {
    const r = await fetch(ENC_URL, { cache: 'force-cache' });
    if (!r.ok) throw new Error('NO_MODEL_FILE');
    encCache = new Uint8Array(await r.arrayBuffer());
  }
  const b = encCache;
  if (new TextDecoder().decode(b.subarray(0, 6)) !== MAGIC) throw new Error('BAD_FILE');
  const salt = b.subarray(6, 22);
  const iter = new DataView(b.buffer, b.byteOffset + 22, 4).getUint32(0, false);
  const iv = b.subarray(26, 38);
  const ct = b.subarray(38);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(MAGIC) }, key, ct));
  } catch (e) { throw new Error('BAD_PASSWORD'); }
  if (new TextDecoder().decode(plain.subarray(0, 4)) !== 'LMPK') throw new Error('BAD_FILE');
  const hlen = new DataView(plain.buffer, 4, 4).getUint32(0, false);
  const hdr = JSON.parse(new TextDecoder().decode(plain.subarray(8, 8 + hlen)));
  const dataStart = 8 + hlen;
  const files = {};
  for (const f of hdr.files) {
    files[f.name] = { bytes: plain.subarray(dataStart + f.off, dataStart + f.off + f.len), type: f.type };
  }
  return files;
}

const norm = s => s.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

export class LemalinMMD {
  /** @param {import('./board3d.js').Board3D} board */
  constructor(board) {
    this.board = board;
    this.anchor = null;
    this.mesh = null;
    this.bones = {};
    this.morph = {};
    this.boneMorphs = {};  // 名称 -> [{bi, pos:[x,y,z], quat:[x,y,z,w], r}]
    this.weights = {};
    this.t = 0;
    this.nextBlink = 2.5;
    this.blinkT = -1;
    this.expr = null;      // { name, t, dur, peak }
    this.tilt = 0; this.tiltTarget = 0;
    this.lookYaw = 0; this.lookYawTarget = 0;
    this.grab = { active: false, side: '右', target: new THREE.Vector3(), w: 0, grip: 0 };
    this.reachGap = 0;
    this.avatar = null;   // { renderer, camera, canvas }
    this.avatarOn = false;
    this._avFrame = 0;
    // 口型：文字时间轴 或 外部音频驱动（二选一，音频优先）
    this.talk = { active: false, t: 0, dur: 0, keys: [], cur: '', open: 0 };
    this.audioMouth = { amp: 0, viseme: null, ts: 0 };  // 有声库时：setMouthFromAudio({amp,viseme})
    // 手势：空闲 / 反应；拿子时暂停身体手势
    this.gest = null;   // { name, t, dur }
    this.nextIdle = 3.5;
    this.mode = 'idle';  // idle | think | grab
    this.poseOff = { lean: 0, leanY: 0, armL: [0,0,0], armR: [0,0,0], elbL: 0, elbR: 0, wristL: 0, wristR: 0, hipL: 0, hipR: 0, headP: 0 };
    this.blobUrls = [];
    this._frame = dt => this.update(dt);
  }

  get loaded() { return !!this.mesh; }

  async load(password) {
    const files = await decryptModel(password);
    const urlMap = {};
    for (const [name, f] of Object.entries(files)) {
      if (f.type === 'pmx') continue;
      const u = URL.createObjectURL(new Blob([f.bytes], { type: f.type }));
      this.blobUrls.push(u);
      urlMap[norm(VIRTUAL + name)] = u;
    }
    // 未打包的贴图（sph/spa 等）给一个 1x1 透明图，避免 404 和报错
    const EMPTY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      const k = norm(url);
      if (urlMap[k]) return urlMap[k];
      // 文件名大小写/路径分隔不一致时按文件名兜底
      const baseName = k.split('/').pop();
      const hit = Object.keys(urlMap).find(x => x.split('/').pop() === baseName);
      return hit ? urlMap[hit] : EMPTY;
    });
    const loader = new MMDLoader(manager);
    const pmx = files['model.pmx'].bytes;
    const ab = pmx.buffer.slice(pmx.byteOffset, pmx.byteOffset + pmx.byteLength);
    const data = loader._getParser().parsePmx(ab, true);
    const mesh = await new Promise((res, rej) => {
      try {
        const m = loader.meshBuilder.setCrossOrigin('anonymous').build(data, VIRTUAL, undefined, rej);
        manager.onLoad = () => res(m);
        // 没有需要加载的贴图时 onLoad 不会触发，保险起见超时也返回
        setTimeout(() => res(m), 4000);
      } catch (e) { rej(e); }
    });
    this._buildBoneMorphs(data);
    this._setup(mesh);
    return true;
  }

  /** 本模型的表情是“骨骼 morph”（面部骨骼），three 的 MMDLoader 不支持，这里自己展开 */
  _buildBoneMorphs(data) {
    const ms = data.morphs || [];
    const expand = (m, ratio, depth) => {
      if (depth > 4) return [];
      if (m.type === 2) return m.elements.map(e => ({
        bi: e.index, r: ratio,
        pos: [e.position[0], e.position[1], -e.position[2]],           // 左手系 -> 右手系
        quat: [-e.rotation[0], -e.rotation[1], e.rotation[2], e.rotation[3]],
      }));
      if (m.type === 0) return m.elements.flatMap(e => ms[e.index] ? expand(ms[e.index], ratio * e.ratio, depth + 1) : []);
      return [];
    };
    for (const m of ms) {
      const list = expand(m, 1, 0);
      if (list.length) this.boneMorphs[m.name.trim()] = list;
    }
  }

  _applyBoneMorphs() {
    if (!this._bmRest) {
      this._bmRest = new Map();
      for (const list of Object.values(this.boneMorphs)) for (const e of list) {
        const b = this.mesh.skeleton.bones[e.bi];
        if (b && !this._bmRest.has(b)) this._bmRest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });
      }
    }
    for (const [b, rest] of this._bmRest) { b.position.copy(rest.p); b.quaternion.copy(rest.q); }
    const q = this._tmpQ || (this._tmpQ = new THREE.Quaternion()), I = new THREE.Quaternion();
    for (const [name, w] of Object.entries(this.weights)) {
      if (!w) continue;
      const list = this.boneMorphs[name]; if (!list) continue;
      for (const e of list) {
        const b = this.mesh.skeleton.bones[e.bi]; if (!b) continue;
        const k = w * e.r;
        b.position.x += e.pos[0] * k; b.position.y += e.pos[1] * k; b.position.z += e.pos[2] * k;
        q.set(e.quat[0], e.quat[1], e.quat[2], e.quat[3]);
        b.quaternion.multiply(I.clone().slerp(q, Math.min(1, k)));
      }
    }
  }

  _setup(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    // 材质：保持卡通着色，但别被场景雾/色调映射洗得太灰
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.fog = true;
      if (m.map) m.map.anisotropy = 4;
      if (m.color) m.color.multiplyScalar(0.86);   // 月夜里稍暗一点，不要发白
    }
    this.mesh = mesh;
    for (const b of mesh.skeleton.bones) this.bones[b.name] = b;
    this.morph = mesh.morphTargetDictionary || {};

    // 锚点：椅子 + 角色，放在 board.actorRoot 中（随翻转转动）
    const anchor = new THREE.Group();
    anchor.userData.seatAnchor = true;
    anchor.userData.seatDist = SEAT_DIST;
    anchor.add(this._makeChair());
    const body = new THREE.Group();
    body.scale.setScalar(SCALE);
    body.add(mesh);
    anchor.add(body);
    this.body = body;
    this._sitPose();
    this._storeRest();
    this.anchor = anchor;
    this.board.actorRoot.add(anchor);
    this.board.setEngineColor(this.board.engineColor);
    this.board.onFrame.push(this._frame);
  }

  /** 椅子：月夜风深蓝木椅 + 淡紫坐垫 */
  _makeChair() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x232a4a, roughness: 0.55, metalness: 0.2 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xb8a8e8, roughness: 0.35, metalness: 0.6, emissive: 0x3a2a70, emissiveIntensity: 0.2 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x6a5aa8, roughness: 0.85 });
    const seatY = FLOOR_Y + 3.35;  // 坐面高度（约 42cm）
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 3.2), wood);
    seat.position.set(0, seatY - 0.2, -0.2);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.28, 2.9), cushion);
    pad.position.set(0, seatY + 0.08, -0.2);
    g.add(seat, pad);
    for (const [x, z] of [[-1.6, 1.25], [1.6, 1.25], [-1.6, -1.65], [1.6, -1.65]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, seatY - FLOOR_Y, 8), wood);
      leg.position.set(x, (seatY + FLOOR_Y) / 2 - 0.2, z);
      g.add(leg);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.6, 0.3), wood);
    back.position.set(0, seatY + 2.3, -1.85);
    const backTrim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 24), trim);
    backTrim.position.set(0, seatY + 3.3, -1.68);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.25, 0.42), trim);
    crest.position.set(0, seatY + 4.65, -1.85);
    g.add(back, backTrim, crest);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  _rot(name, x = 0, y = 0, z = 0) {
    for (const n of [name, name + 'D']) {
      const b = this.bones[n];
      if (b) b.rotation.set(x, y, z);
    }
  }

  /** 坐姿：大腿抬平、小腿垂下、手放在膝上 */
  _sitPose() {
    const lift = -1.45, knee = 1.5;
    this._rot('左足', lift, 0, -0.06); this._rot('右足', lift, 0, 0.06);
    this._rot('左ひざ', knee); this._rot('右ひざ', knee);
    this._rot('左足首', -0.1); this._rot('右足首', -0.1);
    // 手臂：A 字放下，前臂前伸搭在大腿上
    this._rot('左腕', 0.25, 0, -0.75); this._rot('右腕', 0.25, 0, 0.75);
    this._rot('左ひじ', -0.2, -0.9, 0); this._rot('右ひじ', -0.2, 0.9, 0);
    this._rot('左手首', 0, 0, -0.2); this._rot('右手首', 0, 0, 0.2);
    // 上身略前倾（看棋盘）
    this.baseLean = 0.08;
    // 位置：臀部关节约 9.9 → 放到坐面高度
    const hipY = 9.9, seatY = FLOOR_Y + 3.35 + 0.35;
    this.body.position.set(0, seatY - hipY * SCALE, -0.15);
  }

  setVisible(v) { if (this.anchor) this.anchor.visible = v; }
  get visible() { return !!(this.anchor && this.anchor.visible); }

  /* ---------------- 手臂 IK：拿棋子 ---------------- */
  _storeRest() {
    this.rest = new Map();
    for (const side of ['左', '右']) {
      for (const n of ['肩', '腕', '腕捩', 'ひじ', '手捩', '手首', '足', 'ひざ', '足首']) {
        const b = this.bones[side + n]; if (b) this.rest.set(b, b.quaternion.clone());
        const bd = this.bones[side + n + 'D']; if (bd) this.rest.set(bd, bd.quaternion.clone());
      }
      for (const f of ['親指０', '親指１', '親指２', '人指１', '人指２', '人指３', '中指１', '中指２', '中指３', '薬指１', '薬指２', '薬指３', '小指１', '小指２', '小指３']) {
        const b = this.bones[side + f]; if (b) this.rest.set(b, b.quaternion.clone());
      }
    }
  }
  _resetArms() { if (this.rest) for (const [b, q] of this.rest) b.quaternion.copy(q); }

  /** 棋盘逻辑可调用：当前能否做拿子动作 */
  canGrab() { return !!(this.mesh && this.loaded && this.visible && this.board.actorRoot.visible); }
  /** 开始一次拿子：按目标在她左/右侧选手 */
  beginGrab(worldPt) {
    const l = this.anchor.worldToLocal(worldPt.clone());
    this.grab.side = l.x >= 0 ? '左' : '右';
    this.grab.active = true;
    this.grab.target.copy(worldPt);
  }
  /** 每帧：手（握点）目标（世界坐标）、IK 权重 0..1、手指合拢 0..1 */
  setGrab(worldPt, w, grip) { this.grab.target.copy(worldPt); this.grab.w = w; this.grab.grip = grip; }
  endGrab() { const u = this.bones['上半身']; if (u) u.rotation.y = 0; this.lookYawTarget = 0; this.grab.active = false; this.grab.w = 0; this.grab.grip = 0; this.reachGap = 0; this._resetArms(); }

  _rotToward(bone, joint, eff, target) {
    const v1 = eff.clone().sub(joint), v2 = target.clone().sub(joint);
    if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) return;
    const dq = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), v2.normalize());
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq)));
    bone.updateMatrixWorld(true);
  }

  _solveGrab() {
    const g = this.grab, w = g.w;
    const side = g.side, sgn = side === '左' ? 1 : -1;
    const B = n => this.bones[side + n];
    const arm = B('腕'), elbow = B('ひじ'), wrist = B('手首'), mid = B('中指１');
    if (!arm || !elbow || !wrist || !mid) return;
    const up = this.bones['上半身'], up2 = this.bones['上半身2'];
    // 1) 身体前倾 + 侧转（远处格子够不到时）
    const gl = this.anchor.worldToLocal(g.target.clone());
    const hd = Math.hypot(gl.x - sgn * 0.8, gl.z + 0.15);
    const lean = w * THREE.MathUtils.clamp((hd - 2.8) * 0.22, 0, 0.5);
    const yaw = w * THREE.MathUtils.clamp(Math.atan2(gl.x, Math.max(0.5, gl.z)) * 0.4, -0.4, 0.4);
    if (up) { up.rotation.x += lean * 0.6; up.rotation.y = yaw; }
    if (up2) up2.rotation.x += lean * 0.4;
    this.lookYawTarget = THREE.MathUtils.clamp(Math.atan2(gl.x, Math.max(0.5, gl.z)) * 0.5, -0.5, 0.5) * w;
    this._resetArms();
    this.mesh.updateMatrixWorld(true);
    // 2) 两骨解析 IK：握点 → 手腕目标
    const S = arm.getWorldPosition(new THREE.Vector3());
    const E = elbow.getWorldPosition(new THREE.Vector3());
    const W = wrist.getWorldPosition(new THREE.Vector3());
    const a = E.distanceTo(S), b = W.distanceTo(E);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.anchor.getWorldQuaternion(new THREE.Quaternion()));
    const outward = new THREE.Vector3(sgn, 0, 0).applyQuaternion(this.anchor.getWorldQuaternion(new THREE.Quaternion()));
    const horiz = g.target.clone().sub(S).setY(0);
    if (horiz.lengthSq() < 1e-6) horiz.copy(fwd); horiz.normalize();
    const handDir = new THREE.Vector3(0, -0.8, 0).addScaledVector(horiz, 0.6).normalize();
    const handLen = mid.getWorldPosition(new THREE.Vector3()).distanceTo(W) * 1.35;
    const T = g.target.clone().addScaledVector(handDir, -handLen);
    const ST = T.clone().sub(S); const dRaw = ST.length();
    const d = THREE.MathUtils.clamp(dRaw, Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    this.reachGap = Math.max(0, dRaw - (a + b) * 0.999) * w;
    const n = ST.normalize();
    const Tr = S.clone().addScaledVector(n, d);
    const pole = new THREE.Vector3(0, -1, 0).addScaledVector(outward, 0.9).addScaledVector(fwd, -0.25);
    pole.addScaledVector(n, -pole.dot(n)).normalize();
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    const Ed = S.clone().addScaledVector(n, x).addScaledVector(pole, h);
    this._rotToward(arm, S, E, Ed);
    const E2 = elbow.getWorldPosition(new THREE.Vector3()), W2 = wrist.getWorldPosition(new THREE.Vector3());
    this._rotToward(elbow, E2, W2, Tr);
    const W3 = wrist.getWorldPosition(new THREE.Vector3()), M3 = mid.getWorldPosition(new THREE.Vector3());
    this._rotToward(wrist, W3, M3, W3.clone().add(handDir));
    // 3) 与坐姿按权重混合
    for (const bn of [arm, elbow, wrist]) {
      const sol = bn.quaternion.clone();
      bn.quaternion.copy(this.rest.get(bn)).slerp(sol, w);
    }
    // 4) 手指合拢（伸手时微张）
    const grip = g.grip, open = (1 - grip) * w * 0.15;
    for (const f of ['人指', '中指', '薬指', '小指']) {
      for (const [i, k] of [['１', 0.9], ['２', 1.15], ['３', 0.9]]) {
        const fb = B(f + i); if (fb) fb.rotation.set(0, 0, -sgn * (grip * k - open));
      }
    }
    const t1 = B('親指１'), t2 = B('親指２');
    if (t1) t1.rotation.set(0, sgn * grip * 0.5, -sgn * grip * 0.25);
    if (t2) t2.rotation.set(0, sgn * grip * 0.6, 0);
  }

  /** 世界坐标：她手的握点（中指根附近），用于调试/截图 */
  handWorld() {
    const m = this.bones[this.grab.side + '中指２'];
    return m ? m.getWorldPosition(new THREE.Vector3()) : null;
  }

  /* ---------------- 右侧 3D 头像（同一模型、同一骨骼状态） ---------------- */
  attachAvatar(canvas) {
    if (this.avatar) return;
    const main = this.board.renderer;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(canvas.clientWidth || 192, canvas.clientHeight || 192, false);
    r.outputColorSpace = main.outputColorSpace;
    r.toneMapping = main.toneMapping;
    r.toneMappingExposure = main.toneMappingExposure * 1.08;
    r.shadowMap.enabled = false;
    const cam = new THREE.PerspectiveCamera(24, 1, 6.2, 40);
    this.avatar = { renderer: r, camera: cam, canvas };
  }
  _renderAvatar() {
    const av = this.avatar;
    if (!av || !this.avatarOn || !this.visible) return;
    if ((this._avFrame++ & 1) === 1) return;   // 半帧率，省性能
    const head = this.bones['頭']; if (!head) return;
    const scene = this.board.scene;
    const actorVis = this.board.actorRoot.visible;
    this.board.actorRoot.visible = true;          // 交战特写时主画面隐藏她，头像照常
    this.board.actorRoot.updateMatrixWorld(true);
    const hp = head.getWorldPosition(new THREE.Vector3());
    const aq = this.anchor.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(aq);
    const look = hp.clone().add(new THREE.Vector3(0, -0.25, 0));
    av.camera.position.copy(look).addScaledVector(fwd, 8.2).add(new THREE.Vector3(0, 0.7, 0));
    av.camera.lookAt(look);
    const fog = scene.fog; scene.fog = null;
    av.renderer.render(scene, av.camera);
    scene.fog = fog;
    this.board.actorRoot.visible = actorVis;
  }

  _setMorph(name, w) {
    this.weights[name] = w;
    const i = this.morph[name];
    if (i !== undefined && !this.boneMorphs[name]) this.mesh.morphTargetInfluences[i] = w;
  }

  /* ==================== 口型 ====================
   * 优先：setMouthFromAudio({ amp, viseme }) —— 有声库时按音量/音素动嘴
   * 回退：speak(text) —— 按气泡文字生成 a/i/u/e/o 时间轴
   * 气泡结束 / stopSpeak() → 闭嘴
   */
  static _visemeOf(ch) {
    if (!ch || /\s/.test(ch)) return null;
    if (/[、，。！？!?～…·・,.;:…]/.test(ch)) return null; // 停顿
    // 日文假名 / 直接元音
    if (/[あアぁァかカさサたタなナはハまマやヤらラわワがガざザだダばバぱパ]/.test(ch)) return 'あ';
    if (/[いイぃィきキしシちチにニひヒみミりリゐヰぎギじジぢヂびビぴピ]/.test(ch)) return 'い';
    if (/[うウぅゥくクすスつツぬヌふフむムゆユるルをヲぐグずズづヅぶブぷプ]/.test(ch)) return 'う';
    if (/[えエぇェけケせセてテねネへヘめメれレゑヱげゲぜゼでデべベぺペ]/.test(ch)) return 'え';
    if (/[おオぉォこコそソとトのノほホもモよヨろロごゴぞゾどドぼボぽポ]/.test(ch)) return 'お';
    if (/[aAあ]/.test(ch)) return 'あ';
    if (/[iIyYい]/.test(ch)) return 'い';
    if (/[uUwWう]/.test(ch)) return 'う';
    if (/[eEえ]/.test(ch)) return 'え';
    if (/[oOお]/.test(ch)) return 'お';
    // 汉字粗分：按 Unicode 取模轮换，带一点开口偏好
    const code = ch.codePointAt(0) || 0;
    return ['あ', 'い', 'う', 'え', 'お', 'あ', 'ん'][code % 7];
  }

  /** 气泡台词 → 口型时间轴。dur 可覆盖；默认跟字数对齐（约 90ms/字，至少 1.1s） */
  speak(text, { dur } = {}) {
    if (!this.mesh || !text) return;
    const chars = [...String(text)];
    const d = dur ?? Math.max(1.1, Math.min(6.5, chars.length * 0.09 + 0.4));
    const keys = [];
    let t = 0.08;
    const step = d / Math.max(1, chars.length + 1);
    for (const ch of chars) {
      const v = LemalinMMD._visemeOf(ch);
      keys.push({ t, v, open: v ? (v === 'ん' ? 0.25 : v === 'い' ? 0.45 : v === 'う' ? 0.55 : 0.85) : 0 });
      t += step * (v ? 1 : 1.4);
    }
    keys.push({ t: d, v: null, open: 0 });
    this.talk = { active: true, t: 0, dur: d, keys, cur: '', open: 0 };
  }

  stopSpeak() {
    this.talk.active = false;
    this.talk.open = 0;
    this.talk.cur = '';
    for (const n of ['あ', 'い', 'う', 'え', 'お', 'ん', 'あ２', '□', 'ワ']) this._setMorph(n, 0);
  }

  /**
   * 有声库后接这里：每帧或按音素回调。
   * amp 0..1 开口幅度；viseme 可选 'あ'|'い'|'う'|'え'|'お'|'ん'|null
   * 超过 ~150ms 没更新会自动退回文字口型 / 闭嘴。
   */
  setMouthFromAudio({ amp = 0, viseme = null } = {}) {
    this.audioMouth = { amp: Math.max(0, Math.min(1, amp)), viseme, ts: performance.now() };
  }

  _updateMouth(dt) {
    // 清掉上帧口型
    for (const n of ['あ', 'い', 'う', 'え', 'お', 'ん', 'あ２']) {
      if (this.weights[n]) this._setMorph(n, 0);
    }
    const audioFresh = performance.now() - this.audioMouth.ts < 150;
    let vis = null, open = 0;
    if (audioFresh && this.audioMouth.amp > 0.02) {
      open = this.audioMouth.amp;
      vis = this.audioMouth.viseme || 'あ';
    } else if (this.talk.active) {
      this.talk.t += dt;
      const keys = this.talk.keys;
      let k = keys[0];
      for (const x of keys) if (this.talk.t >= x.t) k = x;
      vis = k.v; open = k.open;
      // 音节内微抖，更像说话
      if (open > 0.05) open *= 0.82 + 0.18 * Math.sin(this.talk.t * 28);
      if (this.talk.t >= this.talk.dur) this.stopSpeak();
    }
    this.talk.cur = vis || '';
    this.talk.open = open;
    if (vis && open > 0.02) this._setMorph(vis === 'ん' ? 'ん' : vis, open);
  }

  /* ==================== 手势 / 表情 ==================== */
  _playGest(name, dur) {
    // 拿子时只允许纯表情类
    const faceOnly = { yawn: 1, wink: 1 };
    if (this.grab.active && !faceOnly[name]) return;
    this.gest = { name, t: 0, dur };
  }

  /** 表情 + 身体反应 */
  react(kind) {
    if (!this.mesh) return;
    if (kind === 'think') {
      this.mode = 'think';
      this.tiltTarget = 0.14;
      this._playGest(Math.random() < 0.55 ? 'chin' : 'sigh', 2.4 + Math.random());
      this._face(['真面目'], 2.2, 0.55);
      return;
    }
    if (kind === 'idle') {
      this.mode = 'idle';
      this.tiltTarget = 0;
      this.nextIdle = 1.5 + Math.random() * 2;
      return;
    }
    const face = {
      capture: { names: ['笑い', '口角上げ'], dur: 1.8, peak: 0.9, gest: 'wave' },
      captured: { names: ['困る', '口角下げ'], dur: 1.8, peak: 0.85, gest: 'flinch' },
      check: { names: ['びっくり', 'お'], dur: 1.5, peak: 0.85, gest: 'cover' },  // 被将军
      checkGive: { names: ['にこり', '口角上げ'], dur: 1.6, peak: 0.9, gest: 'wave' },
      win: { names: ['にこり', 'にっこり'], dur: 3.5, peak: 1.0, gest: 'cheer' },
      lose: { names: ['じと目', '口角下げ'], dur: 3.5, peak: 0.75, gest: 'slump' },
      nod: { names: ['にこり'], dur: 1.2, peak: 0.6, gest: 'nod' },
      smug: { names: ['笑い', '口角上げ'], dur: 1.5, peak: 0.75, gest: 'smug' },
      start: { names: ['なごみ'], dur: 2.0, peak: 0.6, gest: 'settle' },
      yawn: { names: ['あ'], dur: 1.8, peak: 0.7, gest: 'yawn' },
    };
    const m = face[kind];
    if (!m) return;
    this._face(m.names, m.dur, m.peak);
    if (m.gest) this._playGest(m.gest, m.dur);
    this.tiltTarget = 0;
  }

  _face(names, dur, peak) {
    if (this.expr) for (const n of this.expr.names) this._setMorph(n, 0);
    this.expr = { names, dur, peak, t: 0 };
  }

  lookAtSquare(x, z) {
    if (!this.anchor) return;
    const side = this.board.engineColor === 'b' ? 1 : -1;
    this.lookYawTarget = THREE.MathUtils.clamp(side * x * 0.06, -0.35, 0.35);
  }

  _pickIdle() {
    const pool = this.mode === 'think'
      ? ['chin', 'sigh', 'lookBoard', 'lookPlayer']
      : ['stretch', 'chin', 'swingFoot', 'lookBoard', 'lookPlayer', 'yawn', 'wink'];
    return pool[(Math.random() * pool.length) | 0];
  }

  /** u=0..1 手势姿态 → poseOff */
  _evalGest(u) {
    const o = this.poseOff;
    const ez = x => x * x * (3 - 2 * x);
    const env = u < 0.18 ? ez(u / 0.18) : u > 0.78 ? ez((1 - u) / 0.22) : 1;
    const n = this.gest.name;
    // 清零
    o.lean = 0; o.leanY = 0;
    o.armL = [0, 0, 0]; o.armR = [0, 0, 0];
    o.elbL = 0; o.elbR = 0; o.wristL = 0; o.wristR = 0;
    o.hipL = 0; o.hipR = 0; o.headP = 0;
    const A = (side, v) => { if (side === 'L') o.armL = v; else o.armR = v; };
    if (n === 'stretch') {
      o.lean = -0.18 * env;
      A('L', [0.55 * env, 0, -1.1 * env]); A('R', [0.55 * env, 0, 1.1 * env]);
      o.elbL = -0.3 * env; o.elbR = -0.3 * env;
      o.headP = -0.15 * env;
    } else if (n === 'chin') {
      // 右手托腮
      A('R', [0.35 * env, -0.4 * env, 0.95 * env]);
      o.elbR = -1.4 * env; o.wristR = 0.5 * env;
      o.leanY = -0.08 * env; o.headP = 0.08 * env;
      this.tiltTarget = 0.12 * env;
    } else if (n === 'swingFoot') {
      const w = Math.sin(u * Math.PI * 4) * env;
      o.hipL = 0.25 * w; o.hipR = -0.15 * w;
    } else if (n === 'lookBoard') {
      this.lookYawTarget = 0;
      o.headP = 0.22 * env;
    } else if (n === 'lookPlayer') {
      this.lookYawTarget = 0;
      o.headP = -0.12 * env;
    } else if (n === 'yawn') {
      o.lean = -0.06 * env; o.headP = -0.2 * env;
      A('L', [0.2 * env, 0, -0.3 * env]);
      // 打哈欠开口由表情 'あ' 承担，这里顺便抬手挡一下
    } else if (n === 'sigh') {
      o.lean = 0.1 * env * Math.sin(u * Math.PI);
      o.headP = 0.1 * env;
    } else if (n === 'nod') {
      o.headP = 0.28 * Math.sin(u * Math.PI * 2) * env;
    } else if (n === 'smug' || n === 'wave') {
      A('L', [-0.15 * env, 0.2 * env, -0.9 * env]);
      o.elbL = -0.8 * env;
      o.wristL = 0.4 * Math.sin(u * Math.PI * 3) * env;
      o.headP = -0.05 * env;
    } else if (n === 'flinch') {
      o.lean = 0.2 * env; o.headP = 0.15 * env;
      A('L', [0.2 * env, 0, -0.4 * env]); A('R', [0.2 * env, 0, 0.4 * env]);
    } else if (n === 'cover') {
      // 双手捂嘴
      A('L', [0.5 * env, 0.3 * env, -0.7 * env]); A('R', [0.5 * env, -0.3 * env, 0.7 * env]);
      o.elbL = -1.6 * env; o.elbR = -1.6 * env;
      o.headP = 0.1 * env;
    } else if (n === 'cheer') {
      A('L', [0.8 * env, 0, -1.0 * env]); A('R', [0.8 * env, 0, 1.0 * env]);
      o.elbL = -0.5 * env; o.elbR = -0.5 * env;
      o.headP = -0.1 * env; o.lean = -0.1 * env;
    } else if (n === 'slump') {
      o.lean = 0.28 * env; o.headP = 0.25 * env;
      A('L', [0.15 * env, 0, -0.2 * env]); A('R', [0.15 * env, 0, 0.2 * env]);
    } else if (n === 'settle') {
      o.lean = 0.08 * Math.sin(u * Math.PI) * env;
      A('L', [0.1 * env, 0, -0.15 * env]); A('R', [0.1 * env, 0, 0.15 * env]);
    } else if (n === 'wink') {
      this._setMorph('ウィンク', env * 0.9);
    }
  }

  _applyPoseOff() {
    const o = this.poseOff;
    const up = this.bones['上半身'];
    if (up) { up.rotation.y = o.leanY; }  // lean.x 在呼吸段统一：baseLean + poseOff.lean + br
    const add = (name, dx, dy, dz) => {
      const b = this.bones[name]; if (!b) return;
      b.rotation.x += dx; b.rotation.y += dy; b.rotation.z += dz;
      const d = this.bones[name + 'D'];
      if (d) { d.rotation.x += dx; d.rotation.y += dy; d.rotation.z += dz; }
    };
    add('左腕', o.armL[0], o.armL[1], o.armL[2]);
    add('右腕', o.armR[0], o.armR[1], o.armR[2]);
    add('左ひじ', o.elbL, 0, 0); add('右ひじ', o.elbR, 0, 0);
    add('左手首', 0, 0, o.wristL); add('右手首', 0, 0, o.wristR);
    add('左足', o.hipL, 0, 0); add('右足', o.hipR, 0, 0);
  }

  update(dt) {
    if (!this.mesh || !this.anchor.visible) return;
    this.t += dt;
    // —— 空闲手势调度 ——
    if (!this.grab.active && !this.gest) {
      this.nextIdle -= dt;
      if (this.nextIdle <= 0) {
        const g = this._pickIdle();
        const dur = g === 'swingFoot' ? 2.8 : g === 'stretch' ? 2.4 : 1.8 + Math.random();
        this._playGest(g, dur);
        if (g === 'yawn') this._face(['あ', 'なごみ'], 1.6, 0.75);
        this.nextIdle = (this.mode === 'think' ? 3.5 : 5.5) + Math.random() * 4;
      }
    }
    if (this.gest) {
      this.gest.t += dt;
      const u = Math.min(1, this.gest.t / this.gest.dur);
      this._evalGest(u);
      if (u >= 1) {
        if (this.gest.name === 'wink') this._setMorph('ウィンク', 0);
        this.gest = null;
        // 清 poseOff
        Object.assign(this.poseOff, { lean: 0, leanY: 0, armL: [0,0,0], armR: [0,0,0], elbL: 0, elbR: 0, wristL: 0, wristR: 0, hipL: 0, hipR: 0, headP: 0 });
      }
    }

    // 身体手势：恢复坐姿 rest → 叠加 poseOff（拿子时手臂交给 IK）
    if (!this.grab.active) {
      this._resetArms();
      for (const side of ['左', '右']) for (const n of ['足', 'ひざ', '足首']) {
        const b = this.bones[side + n];
        if (b && this.rest.has(b)) b.quaternion.copy(this.rest.get(b));
        const d = this.bones[side + n + 'D'];
        if (d && this.rest.has(d)) d.quaternion.copy(this.rest.get(d));
      }
      this._applyPoseOff();
    }

    // 呼吸叠在手势之上
    const br = Math.sin(this.t * 1.7);
    const up = this.bones['上半身'], up2 = this.bones['上半身2'];
    if (up) up.rotation.x = this.baseLean + this.poseOff.lean + br * 0.012;
    if (up2) up2.rotation.x = br * 0.01;
    const sh = [this.bones['左肩'], this.bones['右肩']];
    sh.forEach((b, i) => { if (b) b.rotation.z += (i ? -1 : 1) * br * 0.012; });

    // 头
    this.tilt += (this.tiltTarget - this.tilt) * Math.min(1, dt * 4);
    this.lookYaw += (this.lookYawTarget - this.lookYaw) * Math.min(1, dt * 3);
    const head = this.bones['頭'], neck = this.bones['首'];
    const hp = this.poseOff.headP;
    if (head) head.rotation.set(0.03 + Math.sin(this.t * 0.6) * 0.02 + hp, this.lookYaw, this.tilt);
    if (neck) neck.rotation.set(0.05 + hp * 0.4, this.lookYaw * 0.4, this.tilt * 0.3);

    // 眨眼
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.nextBlink = (this.talk.active ? 3.5 : 2.5) + Math.random() * 3.5;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.16;
      this._setMorph('まばたき', k < 1 ? Math.sin(k * Math.PI) : 0);
      if (k >= 1) this.blinkT = -1;
    }
    if (this.expr) {
      const e = this.expr; e.t += dt;
      const uu = e.t / e.dur;
      const w = uu < 0.15 ? uu / 0.15 : uu > 0.75 ? Math.max(0, (1 - uu) / 0.25) : 1;
      for (const n of e.names) this._setMorph(n, uu >= 1 ? 0 : w * e.peak);
      if (uu >= 1) this.expr = null;
    }

    this._updateMouth(dt);
    if (this.grab.active) this._solveGrab();
    this._applyBoneMorphs();
    this._renderAvatar();
  }


  dispose() {
    if (this.anchor) {
      this.board.actorRoot.remove(this.anchor);
      this.anchor.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(m => { m.map?.dispose(); m.gradientMap?.dispose(); m.dispose(); });
      });
    }
    this.blobUrls.forEach(u => URL.revokeObjectURL(u));
    this.blobUrls = [];
    const i = this.board.onFrame.indexOf(this._frame);
    if (i >= 0) this.board.onFrame.splice(i, 1);
    if (this.avatar) { this.avatar.renderer.dispose(); this.avatar = null; }
    this.mesh = null; this.anchor = null;
  }
}
