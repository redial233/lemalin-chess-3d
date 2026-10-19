#!/usr/bin/env python3
"""
把恶毒 MMD 模型（pmx + 贴图）打包并加密成 models/lemalin.enc。
- 密码：环境变量 CHESS_MODEL_PASSWORD（绝不打印）
- 源目录：环境变量 MODEL_SRC（默认 /tmp/lm/x/碧蓝航线_恶毒），明文永远不进仓库
- KDF：PBKDF2-HMAC-SHA256，250000 次，16 字节随机盐
- 加密：AES-256-GCM，12 字节随机 IV
文件格式：b"LMENC1" | salt(16) | iter(u32 BE) | iv(12) | ciphertext+tag
明文容器：b"LMPK" | u32 BE 头长度 | JSON 头 {files:[{name,off,len,type}]} | 数据
"""
import io, json, os, struct, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 250_000
SRC = os.environ.get('MODEL_SRC', '/tmp/lm/x/碧蓝航线_恶毒')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'models', 'lemalin.enc')
MAX_TEX = int(os.environ.get('MODEL_MAX_TEX', '1024'))  # 手机友好：贴图降到 ≤1024

pw = os.environ.get('CHESS_MODEL_PASSWORD')
if not pw:
    sys.exit('CHESS_MODEL_PASSWORD 未设置')

def tex_bytes(path):
    try:
        from PIL import Image
        im = Image.open(path)
        if max(im.size) > MAX_TEX:
            im = im.resize((MAX_TEX, MAX_TEX) if im.size[0] == im.size[1]
                           else tuple(int(s * MAX_TEX / max(im.size)) for s in im.size), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
        return buf.getvalue()
    except ImportError:
        return open(path, 'rb').read()

pmx_name = '碧蓝航线_恶毒.pmx'
entries = [('model.pmx', open(os.path.join(SRC, pmx_name), 'rb').read(), 'pmx')]
# 只打包主模型引用的贴图（不含舰装）
for t in ['_bodyC.png', '_faceC.png', '_hairC.png']:
    entries.append(('Texture/' + t, tex_bytes(os.path.join(SRC, 'Texture', t)), 'image/png'))

files, off = [], 0
for name, data, typ in entries:
    files.append({'name': name, 'off': off, 'len': len(data), 'type': typ}); off += len(data)
hdr = json.dumps({'v': 1, 'files': files}, ensure_ascii=False).encode()
plain = b'LMPK' + struct.pack('>I', len(hdr)) + hdr + b''.join(d for _, d, _ in entries)

salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode('utf-8'))
ct = AESGCM(key).encrypt(iv, plain, b'LMENC1')
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, 'wb') as f:
    f.write(b'LMENC1' + salt + struct.pack('>I', ITER) + iv + ct)
print(f'ok: {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB, {len(files)} files)')
