#!/usr/bin/env python3
"""
把恶毒配音（GPT-SoVITS 合成的日语台词，挑选结果见 VOICE_PICK）打包加密成 models/voice.enc。
- 密码：环境变量 CHESS_MODEL_PASSWORD（绝不打印），与 lemalin.enc 相同
- 输入：VOICE_LINES（lines.json：id/text/ja/event）、VOICE_PICK（pick.json：best{id: wav路径}）、VOICE_REWRITE（可选）
- 明文 wav/ogg 永远不进仓库；每句 ogg/opus 32k（主）+ mp3 40k（Safari 回退），单声道
格式同 build_model.py：b"LMENC1"|salt16|iter u32BE|iv12|AES-GCM(AAD="LMENC1")；明文 b"LMPK"|u32BE hdrlen|JSON{v,kind,files}|data
"""
import json, os, struct, subprocess, sys, tempfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 250_000
W = '/workspace/lemalin-voice'
LINES = os.environ.get('VOICE_LINES', W + '/out/lines_all.json')
PICK = os.environ.get('VOICE_PICK', W + '/gsv/pick_all.json')
RW = os.environ.get('VOICE_REWRITE', W + '/gsv/rewrite.json')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'models', 'voice.enc')
pw = os.environ.get('CHESS_MODEL_PASSWORD') or sys.exit('CHESS_MODEL_PASSWORD 未设置')
AF = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,'
      'areverse,loudnorm=I=-17:TP=-2,afade=t=in:d=0.01,apad=pad_dur=0.08')

lines = json.load(open(LINES)); best = json.load(open(PICK))['best']
rw = json.load(open(RW)) if os.path.exists(RW) else {}
tmp = tempfile.mkdtemp()
files, blobs, off = [], [], 0
for l in lines:
    src = best.get(l['id'])
    if not src: print('skip', l['id']); continue
    ja = rw.get(l['id'], l['ja']) if src.endswith('_rw.wav') else l['ja']
    for ext, args, typ in [('ogg', ['-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-ar', '48000'], 'audio/ogg; codecs=opus'),
                           ('mp3', ['-c:a', 'libmp3lame', '-b:a', '40k', '-ar', '24000'], 'audio/mpeg')]:
        o = f'{tmp}/{l["id"]}.{ext}'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-af', AF, '-ac', '1', *args, o], check=True)
        d = open(o, 'rb').read()
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', o]))
        files.append({'name': f'{l["id"]}.{ext}', 'off': off, 'len': len(d), 'type': typ, 'id': l['id'], 'text': l['text'],
                      'ja': ja, 'event': l['event'], 'dur': round(dur, 3)})
        blobs.append(d); off += len(d)
hdr = json.dumps({'v': 1, 'kind': 'voice', 'files': files}, ensure_ascii=False).encode()
plain = b'LMPK' + struct.pack('>I', len(hdr)) + hdr + b''.join(blobs)
salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode('utf-8'))
with open(OUT, 'wb') as f:
    f.write(b'LMENC1' + salt + struct.pack('>I', ITER) + iv + AESGCM(key).encrypt(iv, plain, b'LMENC1'))
print(f'ok: {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB, {len(files)//2} lines, {sum(x["dur"] for x in files if x["name"].endswith(".ogg")):.0f}s)')
