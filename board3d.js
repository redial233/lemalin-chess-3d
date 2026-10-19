/**
 * Three.js 立体棋盘：几何体棋子、点击走子、走子/吃子动画、右键旋转镜头
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SQ = 1;
const HALF = 4 * SQ;
const FILES = 'abcdefgh';

export class Board3D {
  /**
   * @param {HTMLElement} container
   * @param {{ onSquareClick?: (sq: string) => void }} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.onSquareClick = opts.onSquareClick || (() => {});
    this.flipped = false;
    this.sel = null;
    this.targets = []; // { to, captured }
    this.lastMove = null; // { from, to }
    this.checkSq = null;
    this.arrow = null; // "e2e4"
    this.pieces = new Map(); // sq -> { mesh, color, type }
    this.animating = false;
    this._pendingSync = null;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0f1f, 0.018);

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
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0, 0);
    // 左键留给点选棋子；右键旋转；中键平移；滚轮缩放
    this.controls.mouseButtons = {
      LEFT: -1, // 禁用左键轨道，避免误触
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    // 触控：单指旋转会和点选冲突——短按点选，拖动旋转。用 pointer 时长区分。
    this._pointerDown = null;

    this._buildLights();
    this._buildBoard();
    this._buildMoon();
    this.pieceRoot = new THREE.Group();
    this.scene.add(this.pieceRoot);
    this.markerRoot = new THREE.Group();
    this.scene.add(this.markerRoot);
    this.arrowRoot = new THREE.Group();
    this.scene.add(this.arrowRoot);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointerdown', e => this._onPointerDown(e));
    this.renderer.domElement.addEventListener('pointerup', e => this._onPointerUp(e));
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);

    this._clock = new THREE.Clock();
    this._anims = [];
    this._loop();
  }

  _buildLights() {
    const amb = new THREE.AmbientLight(0xb8c4e8, 0.55);
    this.scene.add(amb);
    const moon = new THREE.DirectionalLight(0xcfe8ff, 1.15);
    moon.position.set(-6, 14, 4);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 40;
    moon.shadow.camera.left = -10;
    moon.shadow.camera.right = 10;
    moon.shadow.camera.top = 10;
    moon.shadow.camera.bottom = -10;
    this.scene.add(moon);
    const fill = new THREE.DirectionalLight(0xb49cff, 0.35);
    fill.position.set(8, 6, -4);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0x8fe3ff, 0.6, 30);
    rim.position.set(0, 4, 8);
    this.scene.add(rim);
  }

  _buildMoon() {
    const geo = new THREE.SphereGeometry(1.4, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8eef7,
      emissive: 0x8fa8d0,
      emissiveIntensity: 0.45,
      roughness: 0.7,
    });
    const moon = new THREE.Mesh(geo, mat);
    moon.position.set(-9, 8, -6);
    this.scene.add(moon);
    // 星点
    const starGeo = new THREE.BufferGeometry();
    const n = 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = 4 + Math.random() * 16;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.75 })
    );
    this.scene.add(stars);
  }

  _buildBoard() {
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    // 木框底座
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.35, 8.6),
      new THREE.MeshStandardMaterial({ color: 0x1a2048, roughness: 0.55, metalness: 0.15 })
    );
    base.position.y = -0.2;
    base.receiveShadow = true;
    base.castShadow = true;
    this.boardGroup.add(base);

    // 镶边
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(8.95, 0.18, 8.95),
      new THREE.MeshStandardMaterial({ color: 0xb49cff, roughness: 0.4, metalness: 0.5, emissive: 0x3a2a6a, emissiveIntensity: 0.2 })
    );
    rim.position.y = -0.42;
    this.boardGroup.add(rim);

    this.squares = {};
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xd0d8ec, roughness: 0.65 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4468, roughness: 0.7 });
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + (r + 1);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(SQ * 0.98, 0.12, SQ * 0.98),
          (f + r) % 2 === 0 ? darkMat.clone() : lightMat.clone()
        );
        const [x, z] = this._sqToXZ(sq, false);
        mesh.position.set(x, 0, z);
        mesh.receiveShadow = true;
        mesh.userData.sq = sq;
        this.boardGroup.add(mesh);
        this.squares[sq] = mesh;
      }
    }

    // 坐标标签（简单精灵）
    this._addCoordLabels();
  }

  _addCoordLabels() {
    this.coordGroup = new THREE.Group();
    this.boardGroup.add(this.coordGroup);
    const makeLabel = (text, x, z) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#8fe3ff';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 32);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7 });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(0.35, 0.35, 1);
      spr.position.set(x, 0.15, z);
      this.coordGroup.add(spr);
    };
    for (let f = 0; f < 8; f++) {
      const [x] = this._sqToXZ(FILES[f] + '1', false);
      makeLabel(FILES[f], x, 4.35);
    }
    for (let r = 1; r <= 8; r++) {
      const [, z] = this._sqToXZ('a' + r, false);
      makeLabel(String(r), -4.35, z);
    }
  }

  /** 棋盘坐标 → 世界 XZ（始终 a1 左近、h8 右远，翻转靠旋转 boardGroup） */
  _sqToXZ(sq, useFlip = true) {
    let f = sq.charCodeAt(0) - 97;
    let r = +sq[1] - 1;
    // a 左(-), h 右(+); rank1 近(+z), rank8 远(-z)
    const x = (f - 3.5) * SQ;
    const z = (3.5 - r) * SQ;
    return [x, z];
  }

  setFlipped(flipped) {
    this.flipped = flipped;
    // 绕 Y 转 180°，并缓动相机到对面视角
    this.boardGroup.rotation.y = flipped ? Math.PI : 0;
    this.pieceRoot.rotation.y = flipped ? Math.PI : 0;
    this.markerRoot.rotation.y = flipped ? Math.PI : 0;
    this.arrowRoot.rotation.y = flipped ? Math.PI : 0;
    const dist = this.camera.position.length();
    const elev = Math.max(6, this.camera.position.y);
    const zSign = flipped ? -1 : 1;
    this.camera.position.set(0, elev, zSign * Math.sqrt(Math.max(1, dist * dist - elev * elev)));
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** 根据 chess.js 局面同步棋子（无动画） */
  syncPosition(board /* 8x8 from chess.board() */, { animateFrom } = {}) {
    if (this.animating && animateFrom) {
      this._pendingSync = board;
      return;
    }
    // board[rank][file] from chess.js: rank 0 = rank 8
    const want = new Map();
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const p = board[rank][file];
        if (!p) continue;
        const sq = FILES[file] + (8 - rank);
        want.set(sq, { color: p.color, type: p.type });
      }
    }

    // 移除多余
    for (const [sq, obj] of [...this.pieces]) {
      const w = want.get(sq);
      if (!w || w.color !== obj.color || w.type !== obj.type) {
        this.pieceRoot.remove(obj.mesh);
        this._disposeMesh(obj.mesh);
        this.pieces.delete(sq);
      }
    }
    // 添加缺失
    for (const [sq, w] of want) {
      const cur = this.pieces.get(sq);
      if (cur && cur.color === w.color && cur.type === w.type) continue;
      const mesh = this._makePiece(w.color, w.type);
      const [x, z] = this._sqToXZ(sq, false);
      mesh.position.set(x, 0, z);
      this.pieceRoot.add(mesh);
      this.pieces.set(sq, { mesh, color: w.color, type: w.type });
    }
    this._updateMarkers();
  }

  /**
   * 带动画走子
   * @param {{ from, to, captured?, promotion?, color, flags }} mv chess.js verbose move
   * @param {Array} boardAfter 走子后的 board()
   */
  animateMove(mv, boardAfter) {
    return new Promise(resolve => {
      const fromObj = this.pieces.get(mv.from);
      if (!fromObj) {
        this.syncPosition(boardAfter);
        resolve();
        return;
      }
      this.animating = true;
      const [tx, tz] = this._sqToXZ(mv.to, false);
      const start = fromObj.mesh.position.clone();
      const end = new THREE.Vector3(tx, 0, tz);
      const isCastle = mv.flags && (mv.flags.includes('k') || mv.flags.includes('q'));
      const isPromo = !!mv.promotion;

      // 吃子动画
      let capObj = null;
      if (mv.captured) {
        // en passant: 被吃子不在 to
        let capSq = mv.to;
        if (mv.flags && mv.flags.includes('e')) {
          capSq = mv.to[0] + (mv.color === 'w' ? '5' : '4');
        }
        capObj = this.pieces.get(capSq);
        if (capObj) this.pieces.delete(capSq);
      }

      // 易位：车也要动
      let rookAnim = null;
      if (isCastle) {
        const rookFrom = mv.flags.includes('k') ? (mv.color === 'w' ? 'h1' : 'h8') : (mv.color === 'w' ? 'a1' : 'a8');
        const rookTo = mv.flags.includes('k') ? (mv.color === 'w' ? 'f1' : 'f8') : (mv.color === 'w' ? 'd1' : 'd8');
        const rook = this.pieces.get(rookFrom);
        if (rook) {
          this.pieces.delete(rookFrom);
          const [rx, rz] = this._sqToXZ(rookTo, false);
          rookAnim = { mesh: rook.mesh, start: rook.mesh.position.clone(), end: new THREE.Vector3(rx, 0, rz), to: rookTo, piece: rook };
        }
      }

      this.pieces.delete(mv.from);
      const duration = 0.32;
      let t = 0;

      const tick = (dt) => {
        t += dt;
        const u = Math.min(1, t / duration);
        const e = 1 - Math.pow(1 - u, 3); // easeOutCubic
        fromObj.mesh.position.lerpVectors(start, end, e);
        // 轻微跳起
        fromObj.mesh.position.y = Math.sin(e * Math.PI) * (mv.captured ? 0.55 : 0.28);

        if (rookAnim) {
          rookAnim.mesh.position.lerpVectors(rookAnim.start, rookAnim.end, e);
        }
        if (capObj) {
          capObj.mesh.position.y = -u * 0.8;
          capObj.mesh.scale.setScalar(1 - u * 0.85);
          capObj.mesh.rotation.z = u * 1.2;
        }

        if (u >= 1) {
          fromObj.mesh.position.copy(end);
          fromObj.mesh.position.y = 0;
          if (capObj) {
            this.pieceRoot.remove(capObj.mesh);
            this._disposeMesh(capObj.mesh);
          }
          if (isPromo) {
            this.pieceRoot.remove(fromObj.mesh);
            this._disposeMesh(fromObj.mesh);
            const neu = this._makePiece(mv.color, mv.promotion);
            neu.position.copy(end);
            this.pieceRoot.add(neu);
            this.pieces.set(mv.to, { mesh: neu, color: mv.color, type: mv.promotion });
          } else {
            this.pieces.set(mv.to, fromObj);
          }
          if (rookAnim) {
            rookAnim.mesh.position.copy(rookAnim.end);
            this.pieces.set(rookAnim.to, rookAnim.piece);
          }
          this.animating = false;
          this.syncPosition(boardAfter); // 校正
          if (this._pendingSync) {
            const b = this._pendingSync;
            this._pendingSync = null;
            this.syncPosition(b);
          }
          this._updateMarkers();
          resolve();
          return false;
        }
        return true;
      };
      this._anims.push(tick);
    });
  }

  setSelection(sel, targets = [], lastMove = null, checkSq = null, arrow = null) {
    this.sel = sel;
    this.targets = targets;
    this.lastMove = lastMove;
    this.checkSq = checkSq;
    this.arrow = arrow;
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

    const addOverlay = (sq, color, opacity, y = 0.08, scale = 0.92) => {
      const [x, z] = this._sqToXZ(sq, false);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(SQ * scale, 0.04, SQ * scale),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
      );
      m.position.set(x, y, z);
      this.markerRoot.add(m);
    };

    if (this.lastMove) {
      addOverlay(this.lastMove.from, 0xb49cff, 0.35);
      addOverlay(this.lastMove.to, 0xb49cff, 0.4);
    }
    if (this.sel) addOverlay(this.sel, 0x8fe3ff, 0.45, 0.09);
    if (this.checkSq) addOverlay(this.checkSq, 0xff7aa0, 0.55, 0.1);

    for (const t of this.targets) {
      const [x, z] = this._sqToXZ(t.to, false);
      if (t.captured) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.28, 0.42, 32),
          new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.12, z);
        this.markerRoot.add(ring);
      } else {
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.15, 24),
          new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(x, 0.12, z);
        this.markerRoot.add(dot);
      }
    }

    if (this.arrow && this.arrow.length >= 4) {
      this._drawArrow(this.arrow.slice(0, 2), this.arrow.slice(2, 4));
    }
  }

  _drawArrow(from, to) {
    const [x1, z1] = this._sqToXZ(from, false);
    const [x2, z2] = this._sqToXZ(to, false);
    const start = new THREE.Vector3(x1, 0.35, z1);
    const end = new THREE.Vector3(x2, 0.35, z2);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 0.1) return;
    dir.normalize();

    const shaftLen = Math.max(0.1, len - 0.35);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, shaftLen, 8),
      new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.85 })
    );
    const mid = start.clone().addScaledVector(dir, shaftLen / 2);
    shaft.position.copy(mid);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.arrowRoot.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.35, 12),
      new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.9 })
    );
    head.position.copy(end).addScaledVector(dir, -0.1);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.arrowRoot.add(head);
  }

  _makePiece(color, type) {
    const isWhite = color === 'w';
    const body = isWhite ? 0xf2f5ff : 0x2a2f45;
    const accent = isWhite ? 0xb49cff : 0x8fe3ff;
    const rim = isWhite ? 0xd0d8ec : 0x1a1f38;
    const mat = () => new THREE.MeshStandardMaterial({
      color: body,
      roughness: isWhite ? 0.35 : 0.45,
      metalness: isWhite ? 0.25 : 0.35,
    });
    const matA = () => new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.4,
      metalness: 0.4,
      emissive: accent,
      emissiveIntensity: 0.08,
    });
    const g = new THREE.Group();
    g.userData = { color, type };

    const add = (mesh, y = 0) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.y = y;
      g.add(mesh);
    };

    const baseY = 0.06;
    // 底座
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 20), mat()), baseY);

    switch (type) {
      case 'p': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.35, 16), mat()), 0.28);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat()), 0.55);
        break;
      }
      case 'r': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.45, 8), mat()), 0.32);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.42), mat()), 0.58);
        for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
          const batt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), matA());
          batt.position.set(dx, 0.72, dz);
          batt.castShadow = true;
          g.add(batt);
        }
        break;
      }
      case 'n': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.25, 12), mat()), 0.22);
        const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.32), mat());
        bodyM.position.set(0.02, 0.48, 0);
        bodyM.rotation.z = -0.25;
        bodyM.castShadow = true;
        g.add(bodyM);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.2), mat());
        head.position.set(0.12, 0.72, 0);
        head.rotation.z = -0.5;
        head.castShadow = true;
        g.add(head);
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), matA());
        ear.position.set(0.08, 0.88, 0.06);
        g.add(ear);
        break;
      }
      case 'b': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 16), mat()), 0.3);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 16), mat()), 0.65);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), matA()), 0.92);
        // 斜缝
        const slit = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.25, 0.22),
          new THREE.MeshStandardMaterial({ color: rim, roughness: 0.5 })
        );
        slit.position.set(0, 0.62, 0);
        slit.rotation.z = 0.4;
        g.add(slit);
        break;
      }
      case 'q': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.5, 16), mat()), 0.35);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat()), 0.7);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), matA());
          tip.position.set(Math.cos(a) * 0.16, 0.88, Math.sin(a) * 0.16);
          g.add(tip);
        }
        add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), matA()), 0.98);
        break;
      }
      case 'k': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.55, 16), mat()), 0.38);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), mat()), 0.7);
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.08), matA());
        crossV.position.y = 0.92;
        g.add(crossV);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), matA());
        crossH.position.y = 0.95;
        g.add(crossH);
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
    if (e.button !== 0) return; // 仅左键点选
    this._pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  _onPointerUp(e) {
    if (e.button !== 0 || !this._pointerDown) return;
    const dx = e.clientX - this._pointerDown.x;
    const dy = e.clientY - this._pointerDown.y;
    const dt = performance.now() - this._pointerDown.t;
    this._pointerDown = null;
    // 短按且几乎未移动 → 点选；否则视为旋转/拖动手势
    if (dt > 400 || dx * dx + dy * dy > 100) return;
    this._pickSquare(e);
  }

  _pickSquare(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 与隐形平面 y=0 相交
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;

    // 若 boardGroup 旋转了，把世界坐标转回本地
    const local = hit.clone();
    this.boardGroup.worldToLocal(local);

    const f = Math.floor(local.x / SQ + 4);
    const r = Math.floor(4 - local.z / SQ);
    if (f < 0 || f > 7 || r < 0 || r > 7) return;
    const sq = FILES[f] + (r + 1);
    this.onSquareClick(sq);
  }

  _resize() {
    const w = this.container.clientWidth || 560;
    const h = this.container.clientHeight || 560;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _loop() {
    const dt = this._clock.getDelta();
    this.controls.update();
    // 动画队列
    this._anims = this._anims.filter(fn => fn(dt));
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  dispose() {
    this._ro.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
