# 恶毒的月夜棋盘 · 3D

基于 [恶毒的月夜棋盘](https://redial233.github.io/lemalin-chess/)（2D）的立体网页版：Three.js 棋盘 + Stockfish 16 本地对战。

## 本地打开

Stockfish Worker 需要 HTTP，不能用 `file://`。

```bash
cd /workspace/lemalin-chess-3d
python3 -m http.server 8765
```

浏览器打开：http://127.0.0.1:8765/

## 操作

- **选子 / 走子**：左键（或触控轻点）点棋子，再点合法格
- **镜头**：右键拖动旋转 · 滚轮缩放 · 中键平移
- **触控**：单指拖转 · 双指缩放 · 轻点选子
- 升变出现遮罩选后 / 车 / 象 / 马

## 功能

- 立体棋盘与几何体棋子（王车象马后兵可辨）
- 合法格高亮、走子平滑动画、吃子落下消失
- 本地 Stockfish 对战（时制 / 执子 / 棋力 0–20 / Elo）
- 提示箭头、评估条、开局库、逐步评价、悔棋 / 认输 / 翻转视角
- 复盘分析、PGN 导入导出
- 恶毒秘书气泡（像素 / 矢量画风）

## 与 2D 版差异

| | 2D | 3D |
|---|---|---|
| 棋盘 | DOM 格子 + SVG 棋子 | Three.js 立体几何体 |
| 镜头 | 无 | 可旋转缩放 |
| 走子 | 瞬移 | 平滑移动 + 吃子动画 |
| 依赖 | 无 CDN | three.js（jsDelivr CDN） |
| 原项目 | `lemalin-chess` | 本目录独立，不覆盖 2D |

## 文件

- `index.html` / `style.css` / `app.js` — 界面与对战逻辑
- `board3d.js` — Three.js 棋盘与棋子
- `pixel.js` / `chibi.js` / `openings.json` — 秘书与开局库（自 2D 复制）
- `vendor/` — chess.js + Stockfish 16 单线程（含 wasm / nnue）

## 许可说明

引擎 Stockfish 16 为 GPLv3；规则库 chess.js；美术与对战 UI 为同人练习作品。
