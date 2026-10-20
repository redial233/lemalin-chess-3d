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
    this._ensureAnimationState();
    this.blobUrls = [];
    this._frame = dt => this.update(dt);
  }

  // A development preview may retain the unlocked actor while replacing its
  // prototype. Initialize newly introduced state once, not every frame, so an
  // older instance does not throw inside the board's frame callback forever.
  _ensureAnimationState() {
    if (!this.smoothPose) {
      this.smoothPose = Object.fromEntries(Object.entries(this.poseOff)
        .map(([key, value]) => [key, Array.isArray(value) ? value.slice() : value]));
    }
    if (!this.mouthWeights) {
      this.mouthWeights = Object.fromEntries(['あ', 'い', 'う', 'え', 'お', 'ん'].map(n => [n, 0]));
    }
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
    this._toonify(mesh);
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

  /* ---------------- 赛璐璐渲染 ----------------
   * MMDToonMaterial（包里没有自定义 toon/sphere 贴图）→ MeshToonMaterial：
   * 三阶渐变阴影（脸用两阶、阴影更浅更干净）、sRGB 贴图 + 各向异性、菲涅尔边缘光、
   * 反法线外壳描线（共用骨骼与 morph，头像同样生效）
   */
  static _ramp(steps) {
    const data = new Uint8Array(steps.length * 4);
    steps.forEach((v, i) => { const c = Math.round(v * 255); data.set([c, c, c, 255], i * 4); });
    const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  _toonify(mesh) {
    const maxAniso = this.board.renderer.capabilities.getMaxAnisotropy?.() || 4;
    const rampBody = LemalinMMD._ramp([0.62, 0.84, 1.0]);
    const rampFace = LemalinMMD._ramp([0.86, 1.0]);
    const rim = { value: new THREE.Color(0xbfd4ff) };
    this._rimUniform = rim;
    const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const OUTLINE = { Body: 1, Hair: 1, Body_Metal: 0.8, '坠饰': 0.7, '领带': 0.8, belt: 0.8, wings: 1, Face: 0.6 };
    const mats = old.map(m => {
      const name = (m.name || '').trim();
      const isFace = name === 'Face' || name.startsWith('eye') || name === 'Face_Brow';
      const isEye = name.startsWith('eye') || name === 'Face_Brow';
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = Math.min(8, maxAniso); m.map.needsUpdate = true; }
      const t = new THREE.MeshToonMaterial({
        name, map: m.map || null, color: (m.color ? m.color.clone() : new THREE.Color(1, 1, 1)).multiplyScalar(isFace ? 1.0 : 0.96),
        gradientMap: isFace ? rampFace : rampBody,
        transparent: m.transparent || isEye, opacity: m.opacity ?? 1, alphaTest: isEye ? 0.02 : (m.alphaTest || 0),
        side: m.side, depthWrite: m.depthWrite, fog: true,
        emissive: new THREE.Color(isFace ? 0x1c1a26 : 0x14152a),
      });
      t.userData.lmName = name;
      t.userData.outline = OUTLINE[name] || 0;
      if (!isEye) {
        t.onBeforeCompile = sh => {
          sh.uniforms.uRim = rim;
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
            .replace('#include <opaque_fragment>', `
              float lmF = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
              float lmRim = smoothstep(0.62, 0.92, lmF);
              outgoingLight += uRim * lmRim * ${isFace ? '0.10' : '0.22'};
              #include <opaque_fragment>`);
        };
      }
      // Shader source differs for face/body, even though the callback text is identical.
      t.customProgramCacheKey = () => `lm-toon-v2-${isEye ? 'eye' : isFace ? 'face' : 'body'}`;
      m.dispose?.();
      return t;
    });
    mesh.material = mats;
    // 描线：反法线外壳
    // Constant CSS-pixel silhouette width in both cameras. Extrude after skinning,
    // not in model units (which made the portrait's outlines much too heavy).
    const viewport = { value: new THREE.Vector2(1, 1) };
    const pixelRatio = { value: 1 };
    const lineMat = source => {
      const w = source.userData.outline;
      const lm = new THREE.MeshBasicMaterial({
        color: 0x29233f, side: THREE.BackSide, fog: true,
        // Respect cut-out hair/accessories instead of outlining their invisible polygons.
        map: source.map, alphaTest: Math.max(source.alphaTest, 0.05),
        opacity: source.opacity, transparent: source.transparent, depthWrite: false,
      });
      lm.onBeforeCompile = sh => {
        sh.uniforms.uOutlineViewport = viewport;
        sh.uniforms.uOutlinePixelRatio = pixelRatio;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uOutlineViewport;\nuniform float uOutlinePixelRatio;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            vec2 lmNormal = (projectionMatrix * vec4(normalMatrix * objectNormal, 0.0)).xy * uOutlineViewport;
            float lmLength = length(lmNormal);
            if (lmLength > 0.0001) {
              gl_Position.xy += (lmNormal / lmLength) * (2.0 * uOutlinePixelRatio / uOutlineViewport)
                * gl_Position.w * ${(w * 0.85).toFixed(3)};
            }`);
      };
      // Keep the alpha cut-out, not the source texture's color, on the shell.
      lm.onBeforeCompile = ((compile) => sh => {
        compile(sh);
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            diffuseColor.a *= texture2D(map, vMapUv).a;
          #endif`);
      })(lm.onBeforeCompile);
      lm.customProgramCacheKey = () => 'lm-pixel-outline-v2-' + w;
      return lm;
    };
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const lineMats = mats.map(m => m.userData.outline ? lineMat(m) : hidden);
    const outline = new THREE.SkinnedMesh(mesh.geometry, lineMats);
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.morphTargetInfluences = mesh.morphTargetInfluences;
    outline.morphTargetDictionary = mesh.morphTargetDictionary;
    outline.frustumCulled = false;
    outline.raycast = () => {};
    outline.onBeforeRender = renderer => {
      const target = renderer.getRenderTarget();
      if (target) viewport.value.set(target.width, target.height);
      else renderer.getDrawingBufferSize(viewport.value);
      pixelRatio.value = renderer.getPixelRatio();
    };
    outline.userData.isOutline = true;
    mesh.add(outline);
    this.outline = outline;
  }
  /** 画质：high/std 描线开，low 关 */
  setQuality(q) {
    this.quality = q;
    if (this.outline) this.outline.visible = q !== 'low';
    if (this.avatar) this.avatar.renderer.setPixelRatio(q === 'low' ? 1 : Math.min(2, window.devicePixelRatio || 1));
  }

  /* ---------------- 触摸分区（raycast） ---------------- */
  _region(hit) {
    const name = hit.object.material?.[hit.face.materialIndex]?.userData?.lmName || '';
    const head = this.bones['頭'], neck = this.bones['首'];
    const p = hit.point;
    const hp = head.getWorldPosition(new THREE.Vector3()), np = neck.getWorldPosition(new THREE.Vector3());
    const hs = Math.max(0.2, hp.distanceTo(np) * 2.6);          // 头部尺度（世界单位）
    for (const n of ['左手首', '右手首', '左中指１', '右中指１']) {
      const b = this.bones[n]; if (b && b.getWorldPosition(new THREE.Vector3()).distanceTo(p) < hs * 0.6) return 'hand';
    }
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    const dy = p.clone().sub(hp).dot(up) / hs;                   // 以头骨为原点、沿头顶方向
    const dist = p.distanceTo(hp) / hs;
    // 标定（hs≈头骨到颈骨×2.6）：眼睛 dy≈0.5，脸颊 dy<0.45，头顶 0.5–1.8，发团/发饰 >1.85
    if (name === 'Face') return (p.y - hp.y) / hs < 0.36 ? 'cheek' : 'head';   // 用世界高度，低头时也稳定      // 脸部可见区多为脸颊/嘴；额头被刘海挡住
    if (name.startsWith('eye') || name === 'Face_Brow') return 'head';
    if (name === 'Hair' || name === '坠饰') {
      const wy = (p.y - hp.y) / hs, horiz = Math.hypot(p.x - hp.x, p.z - hp.z) / hs;
      if (dy > 2.0 && dist < 3.4) return 'orn';
      if (wy < 0.36 && wy > -0.45 && horiz < 1.2) return 'cheek';   // 脸旁的鬓发：算戳脸
      if (wy <= -0.45) return 'other';                                  // 垂到身上的长发
      if (dist < 3.0) return 'head';
    }
    return 'other';
  }
  /** 主画面：射线（board3d 已设置好） → 分区；未命中返回 null */
  pickRay(raycaster) {
    if (!this.mesh || !this.visible) return null;
    this.mesh.updateMatrixWorld(true);
    this.mesh.computeBoundingSphere();
    const hits = raycaster.intersectObject(this.mesh, false);
    return hits.length ? this._region(hits[0]) : null;
  }
  /** 右侧头像画布点击 */
  pickAvatar(ev) {
    const av = this.avatar; if (!av) return null;
    const r = av.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, av.camera);
    const vis = this.board.actorRoot.visible; this.board.actorRoot.visible = true;
    const res = this.pickRay(rc); this.board.actorRoot.visible = vis;
    return res;
  }
  /** 触摸反应（动作 + 表情）；台词由 app 负责 */
  touch(region, angry = false) {
    if (!this.mesh) return;
    if (angry) { this._face(['怒り', '∧', 'じと目'], 2.2, 0.85); this._playGest('pout', 2.2); return; }
    const R = {
      head: [['なごみ', '笑い', '口角上げ'], 2.6, 0.95, 'headpat'],
      cheek: [['怒り', '∧'], 2.0, 0.7, 'pout'],
      hand: [['困る', 'にこり'], 2.4, 0.7, 'shy'],
      orn: [['びっくり', '困る'], 1.8, 0.8, 'coverHead'],
      other: [['真面目'], 1.4, 0.5, 'tiltHead'],
    }[region] || [['真面目'], 1.4, 0.5, 'tiltHead'];
    this._face(R[0], R[1], R[2]);
    this.gest = null; this._playGest(R[3], R[1]);
  }
  /** 局势心情：adv（她优势）| even | dis（她劣势） */
  setMood(m) { this.moodState = m; }

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
    this._ensureAnimationState();
    const l = this.anchor.worldToLocal(worldPt.clone());
    this.grab.side = l.x >= 0 ? '左' : '右';
    this.grab.active = true;
    // Preserve the displayed gesture at IK takeover, then relax this baseline
    // while reach weight rises. Do not filter the target: fingers must track the piece.
    this.grab.entryTime = 0;
    this.grab.entryYaw = this.bones['上半身']?.rotation.y || 0;
    // Snapshot only the previous reach contribution. Breathing and the smoothed
    // gesture continue independently, so their pitch must not be added twice.
    const breath = Math.sin(this.t * 1.7);
    this.grab.entryLean = (this.bones['上半身']?.rotation.x || 0)
      - (this.baseLean + this.smoothPose.lean + breath * 0.012);
    this.grab.entryLean2 = (this.bones['上半身2']?.rotation.x || 0) - breath * 0.01;
    this.grab.entryPose = new Map([...this.rest.keys()].map(b => [b, b.quaternion.clone()]));
    if (this.gest?.name === 'wink') this._setMorph('ウィンク', 0);
    this.gest = null; // A superseded gesture must not reappear when the hand returns.
    this.tiltTarget = this.mode === 'think' ? 0.14 : 0;
    this.lookYawTarget = 0;
    for (const key of Object.keys(this.poseOff)) {
      if (Array.isArray(this.poseOff[key])) this.poseOff[key].fill(0);
      else this.poseOff[key] = 0;
    }
    this.grab.target.copy(worldPt);
  }
  /** 每帧：手（握点）目标（世界坐标）、IK 权重 0..1、手指合拢 0..1 */
  setGrab(worldPt, w, grip) { this.grab.target.copy(worldPt); this.grab.w = w; this.grab.grip = grip; }
  endGrab() { const u = this.bones['上半身']; if (u) u.rotation.y = 0; this.lookYawTarget = 0; this.grab.active = false; this.grab.w = 0; this.grab.grip = 0; this.reachGap = 0; this.grab.entryPose = null; this._resetArms(); }

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
    const entryWeight = Math.exp(-10 * (g.entryTime || 0));
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
    if (up) {
      up.rotation.x += lean * 0.6 + (g.entryLean || 0) * entryWeight * (1 - w);
      up.rotation.y = yaw + (g.entryYaw || 0) * entryWeight * (1 - w);
    }
    if (up2) up2.rotation.x += lean * 0.4 + (g.entryLean2 || 0) * entryWeight * (1 - w);
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
    // 3) Blend from the actual entry gesture, not a one-frame snap to seated rest.
    const solved = [arm, elbow, wrist].map(bn => bn.quaternion.clone());
    for (const [bn, rest] of this.rest) {
      bn.quaternion.copy(rest);
      const entry = g.entryPose?.get(bn);
      if (entry) bn.quaternion.slerp(entry, entryWeight);
    }
    [arm, elbow, wrist].forEach((bn, i) => bn.quaternion.slerp(solved[i], w));
    // 4) 手指合拢（伸手时微张）
    const grip = g.grip, open = (1 - grip) * w * 0.15;
    const blendFinger = bone => {
      const entry = g.entryPose?.get(bone);
      if (entry) bone.quaternion.slerp(entry, entryWeight * (1 - w));
    };
    for (const f of ['人指', '中指', '薬指', '小指']) {
      for (const [i, k] of [['１', 0.9], ['２', 1.15], ['３', 0.9]]) {
        const fb = B(f + i); if (fb) { fb.rotation.set(0, 0, -sgn * (grip * k - open)); blendFinger(fb); }
      }
    }
    const t1 = B('親指１'), t2 = B('親指２');
    if (t1) { t1.rotation.set(0, sgn * grip * 0.5, -sgn * grip * 0.25); blendFinger(t1); }
    if (t2) { t2.rotation.set(0, sgn * grip * 0.6, 0); blendFinger(t2); }
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
    r.toneMappingExposure = main.toneMappingExposure; // Same colors in portrait and board.
    r.shadowMap.enabled = false;
    const cam = new THREE.PerspectiveCamera(24, 1, 6.2, 40);
    this.avatar = { renderer: r, camera: cam, canvas };
    this.setQuality(this.quality || this.board.quality || 'std');
  }
  _renderAvatar() {
    const av = this.avatar;
    if (!av || !this.avatarOn || !this.visible) return;
    if ((this._avFrame++ & 1) === 1) return;   // 半帧率，省性能
    const head = this.bones['頭']; if (!head) return;
    const width = av.canvas.clientWidth || 192, height = av.canvas.clientHeight || 192;
    if (av.width !== width || av.height !== height) {
      av.renderer.setSize(width, height, false);
      av.camera.aspect = width / height;
      av.camera.updateProjectionMatrix();
      av.width = width; av.height = height;
    }
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
    for (const n in this.mouthWeights) this.mouthWeights[n] = 0;
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
    if (audioFresh) {
      // Fresh silent audio is a pause, not permission to fall back to text.
      open = this.audioMouth.amp > 0.02 ? this.audioMouth.amp : 0;
      vis = this.audioMouth.viseme || 'あ';
    } else if (this.talk.active) {
      this.talk.t += dt;
      const keys = this.talk.keys;
      let k = keys[0];
      for (const x of keys) if (this.talk.t >= x.t) k = x;
      vis = k.v; open = k.open;
      // 音节内微抖，更像说话
      if (open > 0.05) open *= 0.82 + 0.18 * Math.sin(this.talk.t * 28);
      if (this.talk.t >= this.talk.dur) { this.talk.active = false; vis = null; open = 0; }
    }
    this.talk.cur = vis || '';
    this.talk.open = open;
    // Coarticulation: fade the previous vowel out while the next opens.
    // Exponential smoothing is stable at 30/60/120 Hz, without extra bones or physics.
    for (const n in this.mouthWeights) {
      const target = n === vis ? open : 0;
      const rate = target > this.mouthWeights[n] ? 24 : 18;
      this.mouthWeights[n] += (target - this.mouthWeights[n]) * -Math.expm1(-rate * dt);
      this._setMorph(n, this.mouthWeights[n] < 0.001 ? 0 : this.mouthWeights[n]);
    }
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
      // 优势：臭屁
      advHips: { names: ['じと目', '口角上げ', '笑い'], dur: 2.8, peak: 0.6, gest: 'handsHips' },
      advChin: { names: ['じと目', '口角上げ'], dur: 2.4, peak: 0.7, gest: 'chinUp' },
      advWag: { names: ['ウィンク', '口角上げ'], dur: 2.4, peak: 0.8, gest: 'fingerWag' },
      advLegs: { names: ['にこり', '口角上げ'], dur: 3.0, peak: 0.7, gest: 'legSwing' },
      // 劣势：耍赖
      disPout: { names: ['怒り', '∧', '困る'], dur: 2.6, peak: 0.8, gest: 'pout' },
      disTurn: { names: ['怒り', 'じと目'], dur: 2.8, peak: 0.7, gest: 'turnAway' },
      disSleep: { names: ['まばたき', 'なごみ'], dur: 3.2, peak: 1.0, gest: 'fakeSleep' },
      disBeg: { names: ['困る', 'にこり'], dur: 2.4, peak: 0.8, gest: 'beg' },
      // 长考 / 催促
      thinkTap: { names: ['真面目'], dur: 2.6, peak: 0.6, gest: 'tapAir' },
      thinkTilt: { names: ['真面目', '困る'], dur: 2.2, peak: 0.5, gest: 'tiltHead' },
      thinkFrown: { names: ['真面目', '怒り'], dur: 2.2, peak: 0.45, gest: 'chin' },
      urgeTap: { names: ['じと目'], dur: 2.6, peak: 0.5, gest: 'tapTable' },
      urgePoke: { names: ['怒り', '∧'], dur: 2.6, peak: 0.75, gest: 'poke' },
    };
    const m = face[kind];
    if (!m) return;
    this._face(m.names, m.dur, m.peak);
    if (m.gest) { if (this.gest && !this.grab.active) this.gest = null; this._playGest(m.gest, m.dur); }
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
    const mood = this.moodState || 'even';
    const pool = this.mode === 'think'
      ? ['chin', 'tapAir', 'tiltHead', 'lookBoard', 'lookPlayer', 'chin', 'sigh']
      : mood === 'adv' ? ['handsHips', 'chinUp', 'legSwing', 'fingerWag', 'wink', 'stretch', 'lookPlayer', 'swingFoot']
      : mood === 'dis' ? ['pout', 'turnAway', 'sigh', 'chin', 'fakeSleep', 'lookBoard', 'swingFoot']
      : ['stretch', 'chin', 'swingFoot', 'lookBoard', 'lookPlayer', 'yawn', 'wink', 'tiltHead', 'legSwing'];
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
    } else if (n === 'handsHips') {
      // 叉腰：上臂外展后摆，肘外翻，手背到腰
      A('L', [-0.35 * env, 0.35 * env, -0.55 * env]); A('R', [-0.35 * env, -0.35 * env, 0.55 * env]);
      o.elbL = -1.25 * env; o.elbR = -1.25 * env; o.wristL = -0.4 * env; o.wristR = 0.4 * env;
      o.lean = -0.12 * env; o.headP = -0.16 * env;
    } else if (n === 'chinUp') {
      o.headP = -0.32 * env; o.lean = -0.1 * env;
      this.tiltTarget = -0.1 * env;
      A('L', [-0.2 * env, 0.3 * env, -0.45 * env]); o.elbL = -1.1 * env;
    } else if (n === 'fingerWag') {
      A('R', [0.75 * env, -0.25 * env, 0.55 * env]); o.elbR = -1.35 * env;
      o.wristR = 0.45 * Math.sin(u * Math.PI * 9) * env;
      o.headP = -0.1 * env; this.tiltTarget = 0.12 * Math.sin(u * Math.PI * 4.5) * env;
    } else if (n === 'legSwing') {
      const w = Math.sin(u * Math.PI * 6) * env;
      o.hipL = 0.45 * w; o.hipR = -0.45 * w; o.lean = -0.05 * env;
      this.tiltTarget = 0.1 * Math.sin(u * Math.PI * 3) * env;
    } else if (n === 'pout') {
      // 鼓脸 + 抱臂
      A('L', [0.55 * env, 0.45 * env, -0.5 * env]); A('R', [0.55 * env, -0.45 * env, 0.5 * env]);
      o.elbL = -1.7 * env; o.elbR = -1.7 * env;
      o.headP = 0.06 * env; this.tiltTarget = 0.16 * env;
      this._setMorph('□', 0.0);
    } else if (n === 'turnAway') {
      this.lookYawTarget = 0.75 * env; o.leanY = 0.22 * env; o.headP = -0.08 * env;
      A('L', [0.5 * env, 0.4 * env, -0.5 * env]); A('R', [0.5 * env, -0.4 * env, 0.5 * env]);
      o.elbL = -1.6 * env; o.elbR = -1.6 * env;
    } else if (n === 'fakeSleep') {
      o.headP = 0.32 * env; o.lean = 0.12 * env; this.tiltTarget = 0.28 * env;
      A('L', [0.2 * env, 0, -0.25 * env]); A('R', [0.2 * env, 0, 0.25 * env]);
    } else if (n === 'beg') {
      // 双手合十拜托
      A('L', [0.9 * env, 0.35 * env, -0.45 * env]); A('R', [0.9 * env, -0.35 * env, 0.45 * env]);
      o.elbL = -1.5 * env; o.elbR = -1.5 * env; o.headP = 0.1 * env;
      this.tiltTarget = 0.18 * Math.sin(u * Math.PI * 2) * env;
    } else if (n === 'tapAir') {
      // 手指在棋盘上方点点
      A('R', [0.9 * env, -0.15 * env, 0.35 * env]); o.elbR = -0.55 * env;
      o.wristR = (0.15 + 0.25 * Math.abs(Math.sin(u * Math.PI * 7))) * env;
      o.headP = 0.22 * env; o.lean = 0.1 * env;
    } else if (n === 'tiltHead') {
      this.tiltTarget = 0.3 * env * (u < 0.5 ? 1 : 0.8); o.headP = 0.04 * env;
    } else if (n === 'tapTable') {
      A('R', [0.75 * env, -0.1 * env, 0.4 * env]); o.elbR = -0.45 * env;
      o.wristR = 0.35 * Math.abs(Math.sin(u * Math.PI * 8)) * env;
      o.headP = -0.06 * env; this.tiltTarget = 0.14 * env;
    } else if (n === 'poke') {
      // 伸手点点指挥官
      A('R', [1.15 * env, -0.25 * env, 0.25 * env]); o.elbR = -0.25 * env;
      o.wristR = 0.25 * Math.sin(u * Math.PI * 8) * env;
      o.lean = 0.16 * env; o.headP = -0.06 * env;
    } else if (n === 'headpat') {
      o.lean = 0.1 * env; o.headP = 0.16 * env; this.tiltTarget = 0.18 * Math.sin(u * Math.PI * 3) * env;
      A('L', [0.25 * env, 0, -0.3 * env]); A('R', [0.25 * env, 0, 0.3 * env]);
    } else if (n === 'shy') {
      this.lookYawTarget = -0.35 * env; o.headP = 0.2 * env; this.tiltTarget = 0.14 * env;
      A('L', [0.45 * env, 0.4 * env, -0.45 * env]); A('R', [0.45 * env, -0.4 * env, 0.45 * env]);
      o.elbL = -1.2 * env; o.elbR = -1.2 * env;
    } else if (n === 'coverHead') {
      A('L', [1.4 * env, 0.2 * env, -0.7 * env]); A('R', [1.4 * env, -0.2 * env, 0.7 * env]);
      o.elbL = -1.9 * env; o.elbR = -1.9 * env; o.headP = 0.12 * env;
    }
  }

  _smoothPoseOff(dt) {
    const alpha = -Math.expm1(-14 * dt);
    for (const key of Object.keys(this.poseOff)) {
      const target = this.poseOff[key];
      if (Array.isArray(target)) {
        for (let i = 0; i < target.length; i++) this.smoothPose[key][i] += (target[i] - this.smoothPose[key][i]) * alpha;
      } else this.smoothPose[key] += (target - this.smoothPose[key]) * alpha;
    }
  }

  _applyPoseOff() {
    const o = this.smoothPose;
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
    this._ensureAnimationState();
    dt = Math.min(0.05, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.t += dt;
    // —— 空闲手势调度 ——
    if (!this.grab.active && !this.gest) {
      this.nextIdle -= dt;
      if (this.nextIdle <= 0) {
        const g = this._pickIdle();
        const dur = g === 'swingFoot' || g === 'legSwing' ? 3.0 : g === 'stretch' ? 2.6 : g === 'fakeSleep' ? 3.4 : 2.0 + Math.random();
        this._playGest(g, dur);
        const F = { yawn: [['あ', 'なごみ'], 0.75], wink: null, handsHips: [['じと目', '口角上げ'], 0.55], chinUp: [['じと目', '口角上げ'], 0.6],
          fingerWag: [['ウィンク', '口角上げ'], 0.7], pout: [['怒り', '∧'], 0.7], turnAway: [['怒り', 'じと目'], 0.6], fakeSleep: [['まばたき'], 1.0],
          tiltHead: [['真面目'], 0.4], tapAir: [['真面目'], 0.5], legSwing: [['にこり'], 0.5] }[g];
        if (F) this._face(F[0], dur, F[1]);
        this.nextIdle = (this.mode === 'think' ? 2.2 : 3.2) + Math.random() * 3;
      }
    }
    if (this.gest) {
      this.gest.t += dt;
      const u = Math.min(1, this.gest.t / this.gest.dur);
      this._evalGest(u);
      if (u >= 1) {
        if (this.gest.name === 'wink') this._setMorph('ウィンク', 0);
        if (!this.grab.active) { this.lookYawTarget = 0; this.tiltTarget = this.mode === 'think' ? 0.14 : 0; }
        this.gest = null;
        // 清 poseOff
        Object.assign(this.poseOff, { lean: 0, leanY: 0, armL: [0,0,0], armR: [0,0,0], elbL: 0, elbR: 0, wristL: 0, wristR: 0, hipL: 0, hipR: 0, headP: 0 });
      }
    }

    this._smoothPoseOff(dt);

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
    if (up) up.rotation.x = this.baseLean + this.smoothPose.lean + br * 0.012;
    if (up2) up2.rotation.x = br * 0.01;
    const sh = [this.bones['左肩'], this.bones['右肩']];
    sh.forEach((b, i) => { if (b) b.rotation.z += (i ? -1 : 1) * br * 0.012; });

    // 头
    this.tilt += (this.tiltTarget - this.tilt) * -Math.expm1(-dt * 4);
    this.lookYaw += (this.lookYawTarget - this.lookYaw) * -Math.expm1(-dt * 3);
    const head = this.bones['頭'], neck = this.bones['首'];
    const hp = this.smoothPose.headP;
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
    if (this.grab.active) { this.grab.entryTime = (this.grab.entryTime || 0) + dt; this._solveGrab(); }
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
