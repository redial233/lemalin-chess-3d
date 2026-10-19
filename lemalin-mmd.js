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
      for (const n of ['腕', '腕捩', 'ひじ', '手捩', '手首']) { const b = this.bones[side + n]; if (b) this.rest.set(b, b.quaternion.clone()); }
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

  /** 表情反应：'capture' 吃子 / 'captured' 被吃 / 'check' 将军 / 'think' 思考 / 'idle' */
  react(kind) {
    if (!this.mesh) return;
    if (kind === 'think') { this.tiltTarget = 0.16; return; }
    if (kind === 'idle') { this.tiltTarget = 0; return; }
    const map = {
      capture: { names: ['笑い', '口角上げ'], dur: 1.7, peak: 0.9 },
      captured: { names: ['困る', '口角下げ'], dur: 1.7, peak: 0.85 },
      check: { names: ['びっくり', 'お'], dur: 1.4, peak: 0.8 },
      win: { names: ['にこり', 'にっこり'], dur: 3.2, peak: 1.0 },
      lose: { names: ['じと目', '口角下げ'], dur: 3.2, peak: 0.75 },
    };
    const m = map[kind];
    if (!m) return;
    if (this.expr) for (const n of this.expr.names) this._setMorph(n, 0);
    this.expr = { ...m, t: 0 };
    this.tiltTarget = 0;
  }

  /** 头部略微看向某格（棋盘本地 x,z） */
  lookAtSquare(x, z) {
    if (!this.anchor) return;
    const side = this.board.engineColor === 'b' ? 1 : -1; // 角色朝向
    this.lookYawTarget = THREE.MathUtils.clamp(side * x * 0.06, -0.35, 0.35);
  }

  update(dt) {
    if (!this.mesh || !this.anchor.visible) return;
    this.t += dt;
    // 呼吸：上半身轻微起伏
    const br = Math.sin(this.t * 1.7);
    const up = this.bones['上半身'], up2 = this.bones['上半身2'];
    if (up) up.rotation.x = this.baseLean + br * 0.012;
    if (up2) up2.rotation.x = br * 0.01;
    const sh = [this.bones['左肩'], this.bones['右肩']];
    sh.forEach((b, i) => { if (b) b.rotation.z = (i ? -1 : 1) * br * 0.012; });
    // 头：歪头 / 看向
    this.tilt += (this.tiltTarget - this.tilt) * Math.min(1, dt * 4);
    this.lookYaw += (this.lookYawTarget - this.lookYaw) * Math.min(1, dt * 3);
    const head = this.bones['頭'], neck = this.bones['首'];
    if (head) head.rotation.set(0.03 + Math.sin(this.t * 0.6) * 0.02, this.lookYaw, this.tilt);
    if (neck) neck.rotation.set(0.05, this.lookYaw * 0.4, this.tilt * 0.3);
    // 眨眼
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) { this.blinkT = 0; this.nextBlink = 2.5 + Math.random() * 3.5; }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.16;
      this._setMorph('まばたき', k < 1 ? Math.sin(k * Math.PI) : 0);
      if (k >= 1) this.blinkT = -1;
    }
    // 表情
    if (this.expr) {
      const e = this.expr; e.t += dt;
      const u = e.t / e.dur;
      const w = u < 0.15 ? u / 0.15 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
      for (const n of e.names) this._setMorph(n, u >= 1 ? 0 : w * e.peak);
      if (u >= 1) this.expr = null;
    }
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
