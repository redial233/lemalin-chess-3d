/**
 * Three.js 月夜立体棋盘 · 华丽几何体棋子 + 特效（选中光环/合法格脉动/走子拖尾/吃子碎光/将军警示）
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SQ = 1;
const FILES = 'abcdefgh';

/* ---------- 简易粒子对象池 ---------- */
class ParticleBurst {
  constructor(scene, max = 48) {
    this.scene = scene;
    this.max = max;
    this.geo = new THREE.SphereGeometry(0.035, 6, 6);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({
        mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, active: false,
      });
    }
  }
  burst(x, y, z, { count = 22, color = 0x8fe3ff, speed = 2.2, life = 0.55 } = {}) {
    let n = 0;
    for (const p of this.pool) {
      if (p.active) continue;
      if (n >= count) break;
      p.active = true;
      p.life = life * (0.7 + Math.random() * 0.4);
      p.maxLife = p.life;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.55;
      const sp = speed * (0.5 + Math.random());
      p.vx = Math.cos(th) * Math.sin(ph) * sp;
      p.vy = Math.cos(ph) * sp * 0.9 + 0.6;
      p.vz = Math.sin(th) * Math.sin(ph) * sp;
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.7 + Math.random() * 0.8);
      n++;
    }
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
        continue;
      }
      p.vy -= 4.5 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const k = p.life / p.maxLife;
      p.mesh.material.opacity = k;
      p.mesh.scale.setScalar(0.4 + k * 0.9);
    }
  }
}

class RisingSparks {
  constructor(scene, max = 16) {
    this.pool = [];
    this.geo = new THREE.SphereGeometry(0.022, 5, 5);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcfe8ff, transparent: true, opacity: 0, depthWrite: false,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, life: 0, maxLife: 0, active: false, ox: 0, oz: 0 });
    }
    this.anchor = null; // {x,z} or null
    this.color = 0x8fe3ff;
    this._acc = 0;
  }
  setAnchor(x, z, color = 0x8fe3ff) {
    this.anchor = { x, z };
    this.color = color;
  }
  clear() { this.anchor = null; }
  update(dt) {
    if (this.anchor) {
      this._acc += dt;
      if (this._acc > 0.07) {
        this._acc = 0;
        for (const p of this.pool) {
          if (p.active) continue;
          p.active = true;
          p.life = p.maxLife = 0.7 + Math.random() * 0.35;
          const a = Math.random() * Math.PI * 2;
          const r = 0.12 + Math.random() * 0.22;
          p.ox = Math.cos(a) * r;
          p.oz = Math.sin(a) * r;
          p.mesh.visible = true;
          p.mesh.position.set(this.anchor.x + p.ox, 0.15, this.anchor.z + p.oz);
          p.mesh.material.color.setHex(this.color);
          p.mesh.material.opacity = 0.9;
          break;
        }
      }
    }
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0 || !this.anchor) {
        p.active = false; p.mesh.visible = false; continue;
      }
      p.mesh.position.y += 0.9 * dt;
      p.mesh.position.x = (this.anchor?.x ?? p.mesh.position.x) + p.ox;
      p.mesh.position.z = (this.anchor?.z ?? p.mesh.position.z) + p.oz;
      p.mesh.material.opacity = (p.life / p.maxLife) * 0.85;
    }
  }
}

export class Board3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.onSquareClick = opts.onSquareClick || (() => {});
    this.flipped = false;
    this.sel = null;
    this.targets = [];
    this.lastMove = null;
    this.checkSq = null;
    this.arrow = null;
    this.pieces = new Map();
    this.animating = false;
    this._pendingSync = null;
    this._fxTime = 0;
    this._checkPulse = 0;
    this._trailGhosts = [];
    this.cinematicCaptures = true; // 哈利波特式吃子交战特写
    this.inputLocked = false;
    this._camSave = null;
    this._combatFlash = null;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070a16, 0.016);

    const w = container.clientWidth || 560;
    const h = container.clientHeight || 560;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this.camera.position.set(0, 9.5, 10.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = {
      LEFT: -1,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this._pointerDown = null;

    this.fxRoot = new THREE.Group();
    this.scene.add(this.fxRoot);

    this._buildLights();
    this._buildBoard();
    this._buildAtmosphere();
    this.pieceRoot = new THREE.Group();
    this.scene.add(this.pieceRoot);
    this.markerRoot = new THREE.Group();
    this.scene.add(this.markerRoot);
    this.arrowRoot = new THREE.Group();
    this.scene.add(this.arrowRoot);
    this.trailRoot = new THREE.Group();
    this.scene.add(this.trailRoot);

    this.bursts = new ParticleBurst(this.fxRoot, 48);
    this.sparks = new RisingSparks(this.fxRoot, 16);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointerdown', e => this._onPointerDown(e));
    this.renderer.domElement.addEventListener('pointerup', e => this._onPointerUp(e));
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);

    this._clock = new THREE.Clock();
    this._anims = [];
    this._sharedGeo = this._makeSharedGeo();
    this._loop();
  }

  _makeSharedGeo() {
    return {
      cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
      cyl20: new THREE.CylinderGeometry(1, 1, 1, 20),
      cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
      sphere12: new THREE.SphereGeometry(1, 12, 10),
      sphere16: new THREE.SphereGeometry(1, 16, 12),
      torus: new THREE.TorusGeometry(1, 0.12, 8, 24),
      cone: new THREE.ConeGeometry(1, 1, 16),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0xb0bce8, 0.42));
    const moon = new THREE.DirectionalLight(0xd8e8ff, 1.25);
    moon.position.set(-7, 15, 5);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 40;
    moon.shadow.camera.left = -10;
    moon.shadow.camera.right = 10;
    moon.shadow.camera.top = 10;
    moon.shadow.camera.bottom = -10;
    this.scene.add(moon);
    const fillLight = new THREE.DirectionalLight(0xb49cff, 0.4);
    fillLight.position.set(8, 6, -5);
    this.scene.add(fillLight);
    const rim = new THREE.PointLight(0x8fe3ff, 0.55, 28);
    rim.position.set(0, 5, 9);
    this.scene.add(rim);
    this._checkLight = new THREE.PointLight(0xff6688, 0, 6);
    this.scene.add(this._checkLight);
  }

  _buildAtmosphere() {
    // 月亮
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xeef2ff, emissive: 0x9ab0d8, emissiveIntensity: 0.55, roughness: 0.65,
      })
    );
    moon.position.set(-9.2, 8.2, -6.2);
    this.scene.add(moon);

    // 轻量月光光柱（半透明圆锥）
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(2.8, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xa8c4ff, transparent: true, opacity: 0.045,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    shaft.position.set(-4.5, 6, -2);
    shaft.rotation.z = 0.35;
    shaft.rotation.x = 0.15;
    this.scene.add(shaft);
    this._moonShaft = shaft;

    // 远景星点
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 42;
      pos[i * 3 + 1] = 3 + Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 42;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.7, depthWrite: false })
    );
    this.scene.add(this._stars);

    // 缓缓飘落的星尘（少量）
    const dn = 40;
    const dpos = new Float32Array(dn * 3);
    this._dustVel = new Float32Array(dn);
    for (let i = 0; i < dn; i++) {
      dpos[i * 3] = (Math.random() - 0.5) * 14;
      dpos[i * 3 + 1] = Math.random() * 8;
      dpos[i * 3 + 2] = (Math.random() - 0.5) * 14;
      this._dustVel[i] = 0.15 + Math.random() * 0.25;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this._dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xb49cff, size: 0.04, transparent: true, opacity: 0.45, depthWrite: false,
      })
    );
    this.scene.add(this._dust);
  }

  _buildBoard() {
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    // 多层底座
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x141a38, roughness: 0.5, metalness: 0.25,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.38, 9.0), baseMat);
    base.position.y = -0.22;
    base.receiveShadow = true;
    base.castShadow = true;
    this.boardGroup.add(base);

    // 斜切外框（略大、略矮）
    const bevel = new THREE.Mesh(
      new THREE.BoxGeometry(9.35, 0.16, 9.35),
      new THREE.MeshStandardMaterial({
        color: 0x2a2550, roughness: 0.4, metalness: 0.45,
        emissive: 0x1a1040, emissiveIntensity: 0.15,
      })
    );
    bevel.position.y = -0.48;
    this.boardGroup.add(bevel);

    // 银紫镶线
    const inlay = new THREE.Mesh(
      new THREE.BoxGeometry(8.75, 0.04, 8.75),
      new THREE.MeshStandardMaterial({
        color: 0xc8b6ff, roughness: 0.25, metalness: 0.85,
        emissive: 0x6a4cff, emissiveIntensity: 0.22,
      })
    );
    inlay.position.y = -0.02;
    this.boardGroup.add(inlay);

    // 内框细线
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(8.15, 0.03, 8.15),
      new THREE.MeshStandardMaterial({
        color: 0x8fe3ff, roughness: 0.3, metalness: 0.7,
        emissive: 0x3a90b0, emissiveIntensity: 0.15,
      })
    );
    inner.position.y = 0.01;
    this.boardGroup.add(inner);

    // 四角装饰
    const cornerMat = new THREE.MeshStandardMaterial({
      color: 0xe8e0ff, roughness: 0.28, metalness: 0.8,
      emissive: 0xb49cff, emissiveIntensity: 0.35,
    });
    for (const [cx, cz] of [[-4.35, -4.35], [4.35, -4.35], [-4.35, 4.35], [4.35, 4.35]]) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), cornerMat);
      gem.position.set(cx, 0.12, cz);
      gem.rotation.y = Math.PI / 4;
      this.boardGroup.add(gem);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.2, 0.025, 6, 16),
        new THREE.MeshStandardMaterial({ color: 0x8fe3ff, metalness: 0.7, roughness: 0.3, emissive: 0x4aa0c0, emissiveIntensity: 0.3 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, 0.06, cz);
      this.boardGroup.add(ring);
    }

    this.squares = {};
    const lightMat = new THREE.MeshPhysicalMaterial({
      color: 0xd8dff0, roughness: 0.45, metalness: 0.15,
      clearcoat: 0.35, clearcoatRoughness: 0.4,
      emissive: 0x8890b0, emissiveIntensity: 0.03,
    });
    const darkMat = new THREE.MeshPhysicalMaterial({
      color: 0x343c62, roughness: 0.55, metalness: 0.2,
      clearcoat: 0.25, clearcoatRoughness: 0.5,
      emissive: 0x1a2040, emissiveIntensity: 0.05,
    });
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + (r + 1);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(SQ * 0.97, 0.1, SQ * 0.97),
          (f + r) % 2 === 0 ? darkMat.clone() : lightMat.clone()
        );
        const [x, z] = this._sqToXZ(sq, false);
        mesh.position.set(x, 0.04, z);
        mesh.receiveShadow = true;
        mesh.userData.sq = sq;
        this.boardGroup.add(mesh);
        this.squares[sq] = mesh;
      }
    }
    this._addCoordLabels();
  }

  _addCoordLabels() {
    this.coordGroup = new THREE.Group();
    this.boardGroup.add(this.coordGroup);
    const makeLabel = (text, x, z) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#a8e8ff';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 32);
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75 }));
      spr.scale.set(0.32, 0.32, 1);
      spr.position.set(x, 0.18, z);
      this.coordGroup.add(spr);
    };
    for (let f = 0; f < 8; f++) {
      const [x] = this._sqToXZ(FILES[f] + '1', false);
      makeLabel(FILES[f], x, 4.4);
    }
    for (let r = 1; r <= 8; r++) {
      const [, z] = this._sqToXZ('a' + r, false);
      makeLabel(String(r), -4.4, z);
    }
  }

  _sqToXZ(sq) {
    const f = sq.charCodeAt(0) - 97;
    const r = +sq[1] - 1;
    return [(f - 3.5) * SQ, (3.5 - r) * SQ];
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    const rot = flipped ? Math.PI : 0;
    this.boardGroup.rotation.y = rot;
    this.pieceRoot.rotation.y = rot;
    this.markerRoot.rotation.y = rot;
    this.arrowRoot.rotation.y = rot;
    this.trailRoot.rotation.y = rot;
    this.fxRoot.rotation.y = rot;
    const dist = this.camera.position.length();
    const elev = Math.max(6, this.camera.position.y);
    const zSign = flipped ? -1 : 1;
    this.camera.position.set(0, elev, zSign * Math.sqrt(Math.max(1, dist * dist - elev * elev)));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  syncPosition(board, { animateFrom } = {}) {
    if (this.animating && animateFrom) {
      this._pendingSync = board;
      return;
    }
    const want = new Map();
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const p = board[rank][file];
        if (!p) continue;
        want.set(FILES[file] + (8 - rank), { color: p.color, type: p.type });
      }
    }
    for (const [sq, obj] of [...this.pieces]) {
      const w = want.get(sq);
      if (!w || w.color !== obj.color || w.type !== obj.type) {
        this.pieceRoot.remove(obj.mesh);
        this._disposeMesh(obj.mesh);
        this.pieces.delete(sq);
      }
    }
    for (const [sq, w] of want) {
      const cur = this.pieces.get(sq);
      if (cur && cur.color === w.color && cur.type === w.type) continue;
      const mesh = this._makePiece(w.color, w.type);
      const [x, z] = this._sqToXZ(sq);
      mesh.position.set(x, 0, z);
      this.pieceRoot.add(mesh);
      this.pieces.set(sq, { mesh, color: w.color, type: w.type });
    }
    this._updateMarkers();
  }

  animateMove(mv, boardAfter) {
    const fromObj = this.pieces.get(mv.from);
    if (!fromObj) {
      this.syncPosition(boardAfter);
      return Promise.resolve();
    }
    // 吃子 + 开启特写 → 交战电影镜头
    if (mv.captured && this.cinematicCaptures) {
      return this._animateCombatCapture(mv, boardAfter, fromObj);
    }
    return this._animateNormalMove(mv, boardAfter, fromObj);
  }

  _finishMovePlacement(mv, boardAfter, fromObj, end, rookAnim, isPromo) {
    fromObj.mesh.position.copy(end);
    fromObj.mesh.position.y = 0;
    fromObj.mesh.rotation.set(0, 0, 0);
    fromObj.mesh.scale.setScalar(1);
    if (isPromo) {
      this.pieceRoot.remove(fromObj.mesh);
      this._disposeMesh(fromObj.mesh);
      const neu = this._makePiece(mv.color, mv.promotion);
      neu.position.copy(end);
      this.pieceRoot.add(neu);
      this.pieces.set(mv.to, { mesh: neu, color: mv.color, type: mv.promotion });
      this.bursts.burst(end.x, 0.7, end.z, { count: 18, color: 0xffe08a, speed: 2.0, life: 0.65 });
    } else {
      this.pieces.set(mv.to, fromObj);
    }
    if (rookAnim) {
      rookAnim.mesh.position.copy(rookAnim.end);
      rookAnim.mesh.rotation.set(0, 0, 0);
      this.pieces.set(rookAnim.to, rookAnim.piece);
    }
    this.animating = false;
    this.inputLocked = false;
    this.controls.enabled = true;
    this.syncPosition(boardAfter);
    if (this._pendingSync) {
      const b = this._pendingSync;
      this._pendingSync = null;
      this.syncPosition(b);
    }
    this._updateMarkers();
  }

  _resolveCapTarget(mv) {
    let capSq = mv.to;
    if (mv.flags && mv.flags.includes('e')) {
      capSq = mv.to[0] + (mv.color === 'w' ? '5' : '4');
    }
    const capObj = this.pieces.get(capSq);
    return { capSq, capObj, capPos: capObj ? capObj.mesh.position.clone() : null };
  }

  _resolveRookAnim(mv) {
    const isCastle = mv.flags && (mv.flags.includes('k') || mv.flags.includes('q'));
    if (!isCastle) return null;
    const rookFrom = mv.flags.includes('k') ? (mv.color === 'w' ? 'h1' : 'h8') : (mv.color === 'w' ? 'a1' : 'a8');
    const rookTo = mv.flags.includes('k') ? (mv.color === 'w' ? 'f1' : 'f8') : (mv.color === 'w' ? 'd1' : 'd8');
    const rook = this.pieces.get(rookFrom);
    if (!rook) return null;
    this.pieces.delete(rookFrom);
    const [rx, rz] = this._sqToXZ(rookTo);
    return { mesh: rook.mesh, start: rook.mesh.position.clone(), end: new THREE.Vector3(rx, 0, rz), to: rookTo, piece: rook };
  }

  _animateNormalMove(mv, boardAfter, fromObj) {
    return new Promise(resolve => {
      this.animating = true;
      const [tx, tz] = this._sqToXZ(mv.to);
      const start = fromObj.mesh.position.clone();
      const end = new THREE.Vector3(tx, 0, tz);
      const isPromo = !!mv.promotion;
      const trailColor = mv.color === 'w' ? 0xc8b6ff : 0x8fe3ff;
      const { capSq, capObj, capPos } = this._resolveCapTarget(mv);
      if (capObj) this.pieces.delete(capSq);
      const rookAnim = this._resolveRookAnim(mv);
      this.pieces.delete(mv.from);
      this._clearTrails();
      const duration = 0.36;
      let t = 0, lastGhost = 0, burstDone = false;
      const tick = (dt) => {
        t += dt;
        const u = Math.min(1, t / duration);
        const e = 1 - Math.pow(1 - u, 3);
        fromObj.mesh.position.lerpVectors(start, end, e);
        fromObj.mesh.position.y = Math.sin(e * Math.PI) * (mv.captured ? 0.55 : 0.32);
        if (t - lastGhost > 0.045 && u < 0.92) {
          lastGhost = t;
          this._spawnTrailGhost(fromObj.mesh.position, trailColor);
        }
        if (rookAnim) rookAnim.mesh.position.lerpVectors(rookAnim.start, rookAnim.end, e);
        if (capObj && capPos) {
          const cu = Math.min(1, u * 1.15);
          capObj.mesh.position.y = capPos.y - cu * 0.5;
          capObj.mesh.scale.setScalar(Math.max(0.05, 1 - cu * 1.1));
          capObj.mesh.rotation.z = cu * 1.2;
          if (!burstDone && u > 0.35) {
            burstDone = true;
            this.bursts.burst(capPos.x, 0.45, capPos.z, { count: 24, color: mv.color === 'w' ? 0xff9ec8 : 0x8fe3ff, speed: 2.6, life: 0.55 });
          }
        }
        if (u >= 1) {
          if (capObj) { this.pieceRoot.remove(capObj.mesh); this._disposeMesh(capObj.mesh); }
          this.bursts.burst(end.x, 0.2, end.z, { count: 8, color: trailColor, speed: 1.0, life: 0.3 });
          this._finishMovePlacement(mv, boardAfter, fromObj, end, rookAnim, isPromo);
          resolve();
          return false;
        }
        return true;
      };
      this._anims.push(tick);
    });
  }

  /**
   * 哈利波特·魔法石棋局风格吃子交战特写
   * 阶段：推镜(0.35) → 冲刺对撞(0.45) → 击飞碎裂(0.55) → 回镜(0.45) ≈ 1.8s
   */
  _animateCombatCapture(mv, boardAfter, fromObj) {
    return new Promise(resolve => {
      this.animating = true;
      this.inputLocked = true;
      this.controls.enabled = false;
      this.sel = null;
      this._updateMarkers();

      const [tx, tz] = this._sqToXZ(mv.to);
      const start = fromObj.mesh.position.clone();
      const end = new THREE.Vector3(tx, 0, tz);
      const isPromo = !!mv.promotion;
      const trailColor = mv.color === 'w' ? 0xc8b6ff : 0x8fe3ff;
      const atkType = fromObj.type;

      let capSq = mv.to;
      if (mv.flags && mv.flags.includes('e')) capSq = mv.to[0] + (mv.color === 'w' ? '5' : '4');
      const capObj = this.pieces.get(capSq);
      if (!capObj) {
        // 兜底：无被吃网格则普通走
        this.inputLocked = false;
        this.controls.enabled = true;
        this._animateNormalMove(mv, boardAfter, fromObj).then(resolve);
        return;
      }
      const capPos = capObj.mesh.position.clone();
      const defType = capObj.type;
      this.pieces.delete(capSq);
      this.pieces.delete(mv.from);
      this._clearTrails();

      // 保存镜头
      this._camSave = {
        pos: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };

      // 交战点与史诗机位（侧仰拍）
      const mid = new THREE.Vector3().addVectors(start, capPos).multiplyScalar(0.5);
      mid.y = 0.35;
      const dir = new THREE.Vector3().subVectors(capPos, start);
      dir.y = 0;
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      const heroCam = mid.clone()
        .addScaledVector(side, 2.35)
        .add(new THREE.Vector3(0, 1.55, 0))
        .addScaledVector(dir, -0.55);
      const heroTarget = mid.clone().add(new THREE.Vector3(0, 0.45, 0));

      // 时间轴（秒）
      const T_PUSH = 0.32;
      const T_CHARGE = 0.48;
      const T_IMPACT = 0.55;
      const T_RETURN = 0.42;
      const TOTAL = T_PUSH + T_CHARGE + T_IMPACT + T_RETURN;

      let t = 0;
      let impactBurst = false;
      let lastGhost = 0;
      // 击飞方向：侧向+略向后
      const fling = side.clone().multiplyScalar(1.2 + Math.random() * 0.4)
        .addScaledVector(dir, 0.35)
        .add(new THREE.Vector3(0, 1.8, 0));

      const easeInOut = u => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const easeOut = u => 1 - Math.pow(1 - u, 3);
      const easeIn = u => u * u;

      // 轻微点光打在交战点
      if (!this._combatFlash) {
        this._combatFlash = new THREE.PointLight(0xffe0a0, 0, 8);
        this.scene.add(this._combatFlash);
      }
      this._combatFlash.position.copy(mid).setY(1.0);
      this._combatFlash.intensity = 0;

      const tick = (dt) => {
        t += dt;
        const tt = Math.min(t, TOTAL);

        // ---- 镜头 ----
        if (tt <= T_PUSH) {
          const u = easeInOut(tt / T_PUSH);
          this.camera.position.lerpVectors(this._camSave.pos, heroCam, u);
          this.controls.target.lerpVectors(this._camSave.target, heroTarget, u);
        } else if (tt <= T_PUSH + T_CHARGE + T_IMPACT) {
          // 特写期间微距缓缓绕移，增加动感
          const local = tt - T_PUSH;
          const wobble = Math.sin(local * 6) * 0.04;
          this.camera.position.copy(heroCam).addScaledVector(side, wobble);
          this.controls.target.copy(heroTarget);
          this._combatFlash.intensity = 0.8 + Math.sin(local * 10) * 0.4;
        } else {
          const u = easeInOut((tt - T_PUSH - T_CHARGE - T_IMPACT) / T_RETURN);
          this.camera.position.lerpVectors(heroCam, this._camSave.pos, u);
          this.controls.target.lerpVectors(heroTarget, this._camSave.target, u);
          this._combatFlash.intensity = (1 - u) * 0.5;
        }
        this.controls.update();

        // ---- 棋子动作 ----
        if (tt <= T_PUSH) {
          // 对峙：进攻方微微下蹲蓄力，防守方警戒晃动
          const u = tt / T_PUSH;
          fromObj.mesh.position.copy(start);
          fromObj.mesh.position.y = Math.sin(u * Math.PI) * 0.08;
          fromObj.mesh.rotation.z = -u * 0.12;
          capObj.mesh.position.copy(capPos);
          capObj.mesh.rotation.y = Math.sin(u * Math.PI * 2) * 0.15;
        } else if (tt <= T_PUSH + T_CHARGE) {
          // 冲刺撞击
          const u = easeIn((tt - T_PUSH) / T_CHARGE);
          fromObj.mesh.position.lerpVectors(start, capPos, u);
          fromObj.mesh.position.y = Math.sin(u * Math.PI) * (atkType === 'n' ? 0.85 : 0.45);
          // 骑士更夸张的前倾；车/兵顶撞；王后挥击感
          const lean = atkType === 'n' ? 0.7 : atkType === 'k' || atkType === 'q' ? 0.45 : 0.25;
          fromObj.mesh.rotation.z = -lean * Math.sin(u * Math.PI);
          fromObj.mesh.rotation.x = (atkType === 'b' ? 0.3 : 0.1) * u;
          capObj.mesh.position.copy(capPos);
          if (u > 0.7) {
            const w = (u - 0.7) / 0.3;
            capObj.mesh.position.x += Math.sin(w * 40) * 0.04;
            capObj.mesh.rotation.z = w * 0.25;
          }
          if (t - lastGhost > 0.04) {
            lastGhost = t;
            this._spawnTrailGhost(fromObj.mesh.position, trailColor);
          }
        } else if (tt <= T_PUSH + T_CHARGE + T_IMPACT) {
          // 击飞 / 碎裂
          const u = easeOut((tt - T_PUSH - T_CHARGE) / T_IMPACT);
          fromObj.mesh.position.lerpVectors(capPos, end, Math.min(1, u * 1.15));
          fromObj.mesh.position.y = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.25;
          fromObj.mesh.rotation.z *= 0.85;
          fromObj.mesh.rotation.x *= 0.85;

          // 被吃：倒下或击飞
          const flyY = fling.y * u - 2.5 * u * u; // 抛物
          capObj.mesh.position.set(
            capPos.x + fling.x * u,
            Math.max(-0.2, capPos.y + flyY),
            capPos.z + fling.z * u
          );
          // 按子力差异：兵碎得快，王后翻滚更剧
          const spin = defType === 'k' || defType === 'q' ? 4.5 : defType === 'n' ? 3.5 : 2.8;
          capObj.mesh.rotation.x = u * spin;
          capObj.mesh.rotation.z = u * (spin * 0.7);
          capObj.mesh.scale.setScalar(Math.max(0.08, 1 - u * 1.05));

          if (!impactBurst) {
            impactBurst = true;
            this.bursts.burst(capPos.x, 0.55, capPos.z, { count: 32, color: 0xffe08a, speed: 3.2, life: 0.7 });
            this.bursts.burst(capPos.x, 0.5, capPos.z, {
              count: 22, color: mv.color === 'w' ? 0xff9ec8 : 0x8fe3ff, speed: 2.6, life: 0.6,
            });
            this._combatFlash.intensity = 3.5;
          }
        } else {
          // 回镜阶段：进攻方已落位，被吃子淡出
          fromObj.mesh.position.copy(end);
          fromObj.mesh.position.y = 0;
          fromObj.mesh.rotation.set(0, 0, 0);
          const u = (tt - T_PUSH - T_CHARGE - T_IMPACT) / T_RETURN;
          if (capObj.mesh.parent) {
            capObj.mesh.material && null;
            capObj.mesh.scale.setScalar(Math.max(0.01, 0.15 * (1 - u)));
            capObj.mesh.traverse?.(c => {
              if (c.material && c.material.opacity !== undefined) {
                c.material.transparent = true;
                c.material.opacity = Math.max(0, 0.5 * (1 - u));
              }
            });
          }
        }

        if (tt >= TOTAL) {
          if (capObj) {
            this.pieceRoot.remove(capObj.mesh);
            this._disposeMesh(capObj.mesh);
          }
          if (this._combatFlash) this._combatFlash.intensity = 0;
          this.camera.position.copy(this._camSave.pos);
          this.controls.target.copy(this._camSave.target);
          this.controls.update();
          this._finishMovePlacement(mv, boardAfter, fromObj, end, null, isPromo);
          resolve();
          return false;
        }
        return true;
      };
      this._anims.push(tick);
    });
  }

  _spawnTrailGhost(pos, color) {
    // 限量：最多 8 个
    while (this._trailGhosts.length >= 8) {
      const old = this._trailGhosts.shift();
      this.trailRoot.remove(old.mesh);
      old.mesh.material.dispose();
      old.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false })
    );
    mesh.position.copy(pos);
    this.trailRoot.add(mesh);
    this._trailGhosts.push({ mesh, life: 0.28 });
  }

  _clearTrails() {
    for (const g of this._trailGhosts) {
      this.trailRoot.remove(g.mesh);
      g.mesh.material.dispose();
      g.mesh.geometry.dispose();
    }
    this._trailGhosts.length = 0;
  }

  setSelection(sel, targets = [], lastMove = null, checkSq = null, arrow = null) {
    const wasCheck = this.checkSq;
    this.sel = sel;
    this.targets = targets;
    this.lastMove = lastMove;
    this.checkSq = checkSq;
    this.arrow = arrow;
    if (checkSq && checkSq !== wasCheck) this._checkPulse = 1.2;
    this._updateMarkers();
  }

  _updateMarkers() {
    while (this.markerRoot.children.length) {
      const c = this.markerRoot.children[0];
      this.markerRoot.remove(c);
      this._disposeMesh(c);
    }
    while (this.arrowRoot.children.length) {
      const c = this.arrowRoot.children[0];
      this.arrowRoot.remove(c);
      this._disposeMesh(c);
    }

    const addGlow = (sq, color, opacity, y = 0.1, scale = 0.94) => {
      const [x, z] = this._sqToXZ(sq);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(SQ * scale, 0.035, SQ * scale),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      );
      m.position.set(x, y, z);
      m.userData.pulse = false;
      this.markerRoot.add(m);
      return m;
    };

    if (this.lastMove) {
      addGlow(this.lastMove.from, 0xb49cff, 0.28);
      addGlow(this.lastMove.to, 0xb49cff, 0.38);
    }

    // 选中：脚下双环 + 上升粒子
    if (this.sel) {
      const [x, z] = this._sqToXZ(this.sel);
      addGlow(this.sel, 0x8fe3ff, 0.4, 0.11);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.035, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.85, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.14, z);
      ring.userData.spin = true;
      ring.userData.pulse = true;
      this.markerRoot.add(ring);
      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.018, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0xb49cff, transparent: true, opacity: 0.55, depthWrite: false })
      );
      ring2.rotation.x = -Math.PI / 2;
      ring2.position.set(x, 0.13, z);
      ring2.userData.spin = -1;
      this.markerRoot.add(ring2);
      this.sparks.setAnchor(x, z, 0xa8e8ff);
    } else {
      this.sparks.clear();
    }

    // 将军警示
    if (this.checkSq) {
      const [x, z] = this._sqToXZ(this.checkSq);
      const warn = addGlow(this.checkSq, 0xff6b8a, 0.5, 0.12, 0.96);
      warn.userData.pulse = true;
      warn.userData.checkWarn = true;
      const wr = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.04, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xffc080, transparent: true, opacity: 0.7, depthWrite: false })
      );
      wr.rotation.x = -Math.PI / 2;
      wr.position.set(x, 0.16, z);
      wr.userData.pulse = true;
      wr.userData.spin = 1.5;
      this.markerRoot.add(wr);
      this._checkLight.position.set(x, 1.2, z);
    } else {
      this._checkLight.intensity = 0;
    }

    // 合法格：脉动柔光
    for (const t of this.targets) {
      const [x, z] = this._sqToXZ(t.to);
      if (t.captured) {
        const disc = new THREE.Mesh(
          new THREE.RingGeometry(0.22, 0.4, 40),
          new THREE.MeshBasicMaterial({
            color: 0xff7aa0, transparent: true, opacity: 0.7,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, 0.13, z);
        disc.userData.pulse = true;
        this.markerRoot.add(disc);
        const inner = new THREE.Mesh(
          new THREE.CircleGeometry(0.12, 24),
          new THREE.MeshBasicMaterial({
            color: 0xffb0c8, transparent: true, opacity: 0.45,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(x, 0.125, z);
        inner.userData.pulse = true;
        this.markerRoot.add(inner);
      } else {
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(0.22, 28),
          new THREE.MeshBasicMaterial({
            color: 0x7c5cff, transparent: true, opacity: 0.55,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, 0.12, z);
        glow.userData.pulse = true;
        this.markerRoot.add(glow);
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(0.1, 20),
          new THREE.MeshBasicMaterial({
            color: 0xcfe0ff, transparent: true, opacity: 0.7,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        core.rotation.x = -Math.PI / 2;
        core.position.set(x, 0.125, z);
        this.markerRoot.add(core);
      }
    }

    if (this.arrow && this.arrow.length >= 4) {
      this._drawArrow(this.arrow.slice(0, 2), this.arrow.slice(2, 4));
    }
  }

  _drawArrow(from, to) {
    const [x1, z1] = this._sqToXZ(from);
    const [x2, z2] = this._sqToXZ(to);
    const start = new THREE.Vector3(x1, 0.4, z1);
    const end = new THREE.Vector3(x2, 0.4, z2);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 0.1) return;
    dir.normalize();
    const shaftLen = Math.max(0.1, len - 0.38);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, shaftLen, 10),
      new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.88 })
    );
    shaft.position.copy(start).addScaledVector(dir, shaftLen / 2);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.arrowRoot.add(shaft);
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.36, 14),
      new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.95 })
    );
    head.position.copy(end).addScaledVector(dir, -0.12);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.arrowRoot.add(head);
  }

  /* ========== 华丽棋子 ========== */
  _mats(isWhite) {
    const body = new THREE.MeshPhysicalMaterial({
      color: isWhite ? 0xf4f6ff : 0x1e2438,
      metalness: isWhite ? 0.55 : 0.65,
      roughness: isWhite ? 0.28 : 0.32,
      clearcoat: 0.45,
      clearcoatRoughness: 0.25,
      emissive: isWhite ? 0xb0a0e0 : 0x204060,
      emissiveIntensity: isWhite ? 0.08 : 0.12,
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: isWhite ? 0xc8b6ff : 0x6ec8e8,
      metalness: 0.7,
      roughness: 0.22,
      emissive: isWhite ? 0x8a6cff : 0x3ab0d0,
      emissiveIntensity: 0.35,
      clearcoat: 0.5,
    });
    const gem = new THREE.MeshPhysicalMaterial({
      color: isWhite ? 0xe8d0ff : 0xa0f0ff,
      metalness: 0.4,
      roughness: 0.15,
      emissive: isWhite ? 0xb49cff : 0x8fe3ff,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.92,
    });
    const rim = new THREE.MeshStandardMaterial({
      color: isWhite ? 0xd8dff0 : 0x2a3558,
      metalness: 0.75,
      roughness: 0.25,
      emissive: isWhite ? 0x8890c0 : 0x1a4060,
      emissiveIntensity: 0.15,
    });
    return { body, accent, gem, rim };
  }

  _addMesh(g, geo, mat, y, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.y = y;
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  }

  /** 华丽分层基座（所有棋子共用） */
  _ornateBase(g, { body, accent, rim }, scale = 1) {
    this._addMesh(g, new THREE.CylinderGeometry(0.34 * scale, 0.38 * scale, 0.07, 24), body, 0.05);
    this._addMesh(g, new THREE.CylinderGeometry(0.30 * scale, 0.32 * scale, 0.05, 24), rim, 0.11);
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.28 * scale, 0.028, 8, 28),
      accent
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.145;
    torus.castShadow = true;
    g.add(torus);
    this._addMesh(g, new THREE.CylinderGeometry(0.22 * scale, 0.28 * scale, 0.08, 20), body, 0.18);
  }

  _makePiece(color, type) {
    const isWhite = color === 'w';
    const mats = this._mats(isWhite);
    const g = new THREE.Group();
    g.userData = { color, type };

    this._ornateBase(g, mats, type === 'p' ? 0.88 : 1);

    switch (type) {
      case 'p': {
        this._addMesh(g, new THREE.CylinderGeometry(0.11, 0.18, 0.28, 16), mats.body, 0.38);
        this._addMesh(g, new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16), mats.rim, 0.54);
        const neck = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 20), mats.accent);
        neck.rotation.x = Math.PI / 2;
        neck.position.y = 0.58;
        g.add(neck);
        this._addMesh(g, new THREE.SphereGeometry(0.155, 18, 14), mats.body, 0.72);
        this._addMesh(g, new THREE.SphereGeometry(0.045, 10, 8), mats.gem, 0.88);
        break;
      }
      case 'r': {
        this._addMesh(g, new THREE.CylinderGeometry(0.16, 0.2, 0.22, 8), mats.body, 0.38);
        this._addMesh(g, new THREE.CylinderGeometry(0.18, 0.18, 0.38, 8), mats.body, 0.65);
        // 腰环
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 24), mats.accent);
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.55;
        g.add(band);
        // 城垛台
        this._addMesh(g, new THREE.BoxGeometry(0.42, 0.1, 0.42), mats.rim, 0.88);
        // 四角垛口 + 中心宝石
        for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
          const batt = this._addMesh(g, new THREE.BoxGeometry(0.11, 0.16, 0.11), mats.body, 1.0);
          batt.position.x = dx;
          batt.position.z = dz;
          const tip = this._addMesh(g, new THREE.SphereGeometry(0.03, 8, 6), mats.gem, 1.1);
          tip.position.x = dx;
          tip.position.z = dz;
        }
        this._addMesh(g, new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), mats.accent, 0.95);
        this._addMesh(g, new THREE.SphereGeometry(0.05, 10, 8), mats.gem, 1.02);
        break;
      }
      case 'n': {
        this._addMesh(g, new THREE.CylinderGeometry(0.14, 0.2, 0.18, 16), mats.body, 0.36);
        // 躯干（前倾）
        const torso = this._addMesh(g, new THREE.BoxGeometry(0.2, 0.42, 0.28), mats.body, 0.58);
        torso.position.x = 0.04;
        torso.rotation.z = -0.28;
        // 胸甲光带
        const chest = this._addMesh(g, new THREE.BoxGeometry(0.06, 0.3, 0.22), mats.accent, 0.58);
        chest.position.x = 0.12;
        chest.rotation.z = -0.28;
        // 头
        const head = this._addMesh(g, new THREE.BoxGeometry(0.26, 0.2, 0.18), mats.body, 0.82);
        head.position.x = 0.16;
        head.rotation.z = -0.55;
        // 吻部
        const snout = this._addMesh(g, new THREE.BoxGeometry(0.16, 0.1, 0.12), mats.rim, 0.78);
        snout.position.x = 0.32;
        snout.rotation.z = -0.35;
        // 鬃毛尖刺
        for (let i = 0; i < 4; i++) {
          const mane = this._addMesh(g, new THREE.ConeGeometry(0.04, 0.14, 5), mats.accent, 0.95 + i * 0.02);
          mane.position.x = -0.02 - i * 0.02;
          mane.position.z = (i - 1.5) * 0.04;
          mane.rotation.z = 0.6;
        }
        // 耳
        const ear = this._addMesh(g, new THREE.ConeGeometry(0.05, 0.14, 6), mats.gem, 0.98);
        ear.position.set(0.1, 0, 0.06);
        // 眼
        const eye = this._addMesh(g, new THREE.SphereGeometry(0.035, 8, 6), mats.gem, 0.84);
        eye.position.set(0.22, 0, 0.08);
        break;
      }
      case 'b': {
        this._addMesh(g, new THREE.CylinderGeometry(0.12, 0.18, 0.2, 16), mats.body, 0.38);
        this._addMesh(g, new THREE.CylinderGeometry(0.1, 0.14, 0.35, 16), mats.body, 0.62);
        const waist = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 20), mats.accent);
        waist.rotation.x = Math.PI / 2;
        waist.position.y = 0.72;
        g.add(waist);
        // 僧帽
        this._addMesh(g, new THREE.ConeGeometry(0.2, 0.42, 18), mats.body, 0.95);
        // 斜切缝
        const slit = this._addMesh(g, new THREE.BoxGeometry(0.035, 0.28, 0.2), mats.rim, 0.92);
        slit.rotation.z = 0.45;
        // 顶珠
        this._addMesh(g, new THREE.SphereGeometry(0.07, 12, 10), mats.gem, 1.2);
        this._addMesh(g, new THREE.SphereGeometry(0.03, 8, 6), mats.accent, 1.3);
        break;
      }
      case 'q': {
        this._addMesh(g, new THREE.CylinderGeometry(0.14, 0.2, 0.22, 18), mats.body, 0.4);
        this._addMesh(g, new THREE.CylinderGeometry(0.12, 0.16, 0.42, 18), mats.body, 0.68);
        const qband = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 24), mats.accent);
        qband.rotation.x = Math.PI / 2;
        qband.position.y = 0.55;
        g.add(qband);
        this._addMesh(g, new THREE.SphereGeometry(0.2, 18, 14), mats.body, 0.98);
        // 冠状花托
        this._addMesh(g, new THREE.CylinderGeometry(0.22, 0.16, 0.08, 16), mats.rim, 1.12);
        // 8 尖冠
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const spike = this._addMesh(g, new THREE.ConeGeometry(0.035, 0.18, 6), mats.accent, 1.28);
          spike.position.x = Math.cos(a) * 0.17;
          spike.position.z = Math.sin(a) * 0.17;
          const tip = this._addMesh(g, new THREE.SphereGeometry(0.035, 8, 6), mats.gem, 1.4);
          tip.position.x = Math.cos(a) * 0.17;
          tip.position.z = Math.sin(a) * 0.17;
        }
        this._addMesh(g, new THREE.SphereGeometry(0.08, 12, 10), mats.gem, 1.42);
        break;
      }
      case 'k': {
        this._addMesh(g, new THREE.CylinderGeometry(0.15, 0.22, 0.24, 18), mats.body, 0.42);
        this._addMesh(g, new THREE.CylinderGeometry(0.13, 0.17, 0.5, 18), mats.body, 0.74);
        const kband = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.028, 8, 24), mats.accent);
        kband.rotation.x = Math.PI / 2;
        kband.position.y = 0.58;
        g.add(kband);
        const kband2 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 24), mats.gem);
        kband2.rotation.x = Math.PI / 2;
        kband2.position.y = 0.92;
        g.add(kband2);
        this._addMesh(g, new THREE.BoxGeometry(0.38, 0.1, 0.38), mats.rim, 1.05);
        // 拉丁十字
        const crossV = this._addMesh(g, new THREE.BoxGeometry(0.08, 0.36, 0.08), mats.accent, 1.3);
        const crossH = this._addMesh(g, new THREE.BoxGeometry(0.26, 0.08, 0.08), mats.accent, 1.34);
        this._addMesh(g, new THREE.SphereGeometry(0.05, 10, 8), mats.gem, 1.52);
        // 微光核心
        const core = this._addMesh(g, new THREE.SphereGeometry(0.04, 8, 6), mats.gem, 1.34);
        core.material = mats.gem.clone();
        core.material.emissiveIntensity = 0.9;
        break;
      }
    }
    return g;
  }

  _disposeMesh(obj) {
    obj.traverse?.(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    this._pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  _onPointerUp(e) {
    if (this.inputLocked || this.animating) { this._pointerDown = null; return; }
    if (e.button !== 0 || !this._pointerDown) return;
    const dx = e.clientX - this._pointerDown.x;
    const dy = e.clientY - this._pointerDown.y;
    const dt = performance.now() - this._pointerDown.t;
    this._pointerDown = null;
    if (dt > 400 || dx * dx + dy * dy > 100) return;
    this._pickSquare(e);
  }

  _pickSquare(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;
    const local = hit.clone();
    this.boardGroup.worldToLocal(local);
    const f = Math.floor(local.x / SQ + 4);
    const r = Math.floor(4 - local.z / SQ);
    if (f < 0 || f > 7 || r < 0 || r > 7) return;
    this.onSquareClick(FILES[f] + (r + 1));
  }

  _resize() {
    const w = this.container.clientWidth || 560;
    const h = this.container.clientHeight || 560;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _updateFx(dt) {
    this._fxTime += dt;
    this.bursts.update(dt);
    this.sparks.update(dt);

    // 标记脉动 / 旋转
    const pulse = 0.75 + 0.25 * Math.sin(this._fxTime * 4.5);
    for (const c of this.markerRoot.children) {
      if (c.userData.spin) c.rotation.z += dt * 1.8 * (c.userData.spin === true ? 1 : c.userData.spin);
      if (c.userData.pulse && c.material) {
        const base = c.userData.checkWarn ? 0.55 : 0.5;
        c.material.opacity = base * pulse + 0.15;
      }
    }

    // 将军灯光脉冲
    if (this.checkSq) {
      this._checkPulse = Math.max(0, this._checkPulse - dt);
      this._checkLight.intensity = 1.2 + 1.4 * Math.sin(this._fxTime * 8) * 0.5 + this._checkPulse;
    }

    // 拖尾衰减
    for (let i = this._trailGhosts.length - 1; i >= 0; i--) {
      const g = this._trailGhosts[i];
      g.life -= dt;
      if (g.life <= 0) {
        this.trailRoot.remove(g.mesh);
        g.mesh.material.dispose();
        g.mesh.geometry.dispose();
        this._trailGhosts.splice(i, 1);
      } else {
        g.mesh.material.opacity = (g.life / 0.28) * 0.45;
        g.mesh.scale.setScalar(0.6 + g.life);
      }
    }

    // 星尘飘落
    if (this._dust) {
      const pos = this._dust.geometry.attributes.position.array;
      for (let i = 0; i < this._dustVel.length; i++) {
        pos[i * 3 + 1] -= this._dustVel[i] * dt;
        pos[i * 3] += Math.sin(this._fxTime + i) * 0.05 * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 6 + Math.random() * 3;
          pos[i * 3] = (Math.random() - 0.5) * 14;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
        }
      }
      this._dust.geometry.attributes.position.needsUpdate = true;
    }

    // 月光柱轻摇
    if (this._moonShaft) {
      this._moonShaft.material.opacity = 0.04 + 0.015 * Math.sin(this._fxTime * 0.7);
    }
  }

  _loop() {
    const dt = Math.min(0.05, this._clock.getDelta());
    this.controls.update();
    this._anims = this._anims.filter(fn => fn(dt));
    this._updateFx(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  dispose() {
    this._ro.disconnect();
    this._clearTrails();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
