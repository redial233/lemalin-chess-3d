/**
 * 恶毒配音（GPT-SoVITS 照游戏原声音色合成的日语台词）—— 仅私人使用
 * models/voice.enc：与 lemalin.enc 同一方案（PBKDF2-SHA256 + AES-256-GCM, AAD "LMENC1"），同一密码
 * 明文容器 LMPK：头 files[{name,off,len,type,id,text,ja,dur,alt}]，ogg/opus 为主，mp3 为 Safari 回退
 */
const MAGIC = 'LMENC1';
const norm = s => (s || '').replace(/\s+/g, '').trim();

async function decryptPack(url, password) {
  if (!crypto?.subtle) throw new Error('NO_WEBCRYPTO');
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error('NO_VOICE_FILE');
  const b = new Uint8Array(await r.arrayBuffer());
  if (new TextDecoder().decode(b.subarray(0, 6)) !== MAGIC) throw new Error('BAD_FILE');
  const salt = b.subarray(6, 22), iv = b.subarray(26, 38), ct = b.subarray(38);
  const iter = new DataView(b.buffer, b.byteOffset + 22, 4).getUint32(0, false);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(MAGIC) }, key, ct));
  } catch (e) { throw new Error('BAD_PASSWORD'); }
  if (new TextDecoder().decode(plain.subarray(0, 4)) !== 'LMPK') throw new Error('BAD_FILE');
  const hlen = new DataView(plain.buffer, 4, 4).getUint32(0, false);
  const hdr = JSON.parse(new TextDecoder().decode(plain.subarray(8, 8 + hlen)));
  const ds = 8 + hlen;
  return hdr.files.map(f => ({ ...f, bytes: plain.slice(ds + f.off, ds + f.off + f.len) }));
}

export class LemalinVoice {
  constructor() {
    this.byText = new Map(); this.loaded = false; this.enabled = true; this.volume = 0.8;
    this.ctx = null; this.gain = null; this.analyser = null; this.cur = null; this.buf = new Map();
    this.onAmp = null;   // (amp 0..1) => void
    this._unlock = this._unlock.bind(this);
    for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, this._unlock, { capture: true, passive: true });
  }
  async load(password, url = 'models/voice.enc') {
    const files = await decryptPack(url, password);
    for (const f of files) {
      const k = norm(f.text); const e = this.byText.get(k) || { id: f.id, text: f.text, ja: f.ja, dur: f.dur, src: [] };
      e.src.push(f); this.byText.set(k, e);
    }
    this.loaded = true; return this.byText.size;
  }
  _ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    this.ctx = new AC();
    this.gain = this.ctx.createGain(); this.gain.gain.value = this.volume;
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.gain.connect(this.analyser); this.analyser.connect(this.ctx.destination);
    return this.ctx;
  }
  /** 移动端：首次用户交互里创建/恢复 AudioContext 并播一帧静音 */
  _unlock() {
    const ctx = this._ensureCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch (e) { }
    if (ctx.state === 'running') for (const ev of ['pointerdown', 'touchend', 'keydown']) removeEventListener(ev, this._unlock, { capture: true });
  }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; }
  setEnabled(on) { this.enabled = on; if (!on) this.stop(); }
  has(text) { return this.loaded && this.byText.has(norm(text)); }
  durOf(text) { return this.byText.get(norm(text))?.dur || 0; }
  async _decode(e) {
    if (this.buf.has(e.id)) return this.buf.get(e.id);
    for (const f of e.src) {
      try { const ab = await this.ctx.decodeAudioData(f.bytes.slice().buffer); this.buf.set(e.id, ab); return ab; } catch (err) { /* 试下一个格式 */ }
    }
    throw new Error('DECODE_FAIL');
  }
  stop() {
    if (this.cur) { try { this.cur.src.onended = null; this.cur.src.stop(); } catch (e) { } cancelAnimationFrame(this.cur.raf); this.cur = null; }
    this.onAmp?.(0);
  }
  /** 播放与气泡文字对应的语音；新句打断旧句。返回时长（秒），无音频/未解锁返回 0 */
  play(text) {
    this.stop();
    if (!this.loaded || !this.enabled) return 0;
    const e = this.byText.get(norm(text)); if (!e) return 0;
    const ctx = this._ensureCtx(); if (!ctx || ctx.state !== 'running') return 0;
    const token = {}; this.cur = token;
    this._decode(e).then(ab => {
      if (this.cur !== token) return;
      const src = ctx.createBufferSource(); src.buffer = ab; src.connect(this.gain);
      const data = new Float32Array(this.analyser.fftSize);
      const tick = () => {
        if (this.cur !== token) return;
        this.analyser.getFloatTimeDomainData(data);
        let s = 0; for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        const rms = Math.sqrt(s / data.length) / Math.max(0.05, this.volume);
        this.onAmp?.(Math.min(1, Math.max(0, (rms - 0.012) * 7)));
        token.raf = requestAnimationFrame(tick);
      };
      src.onended = () => { if (this.cur === token) { cancelAnimationFrame(token.raf); this.cur = null; this.onAmp?.(0); } };
      token.src = src; src.start(); tick();
    }).catch(err => { console.warn('[voice]', err); if (this.cur === token) this.cur = null; });
    return e.dur;
  }
}
