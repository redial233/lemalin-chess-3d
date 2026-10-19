import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Board3D } from '../board3d.js';

function fixture(move) {
  const board = Object.create(Board3D.prototype);
  Object.assign(board, {
    engineColor: 'b', pieces: new Map(), pieceRoot: new THREE.Group(), actorRoot: new THREE.Group(),
    _anims: [], controls: { enabled: true }, bursts: { burst() {} },
    _updateMarkers() {}, _clearTrails() {}, _spawnTrailGhost() {}, syncPosition() {},
    _disposeMesh() {}, _makePiece: () => new THREE.Mesh(new THREE.BoxGeometry()),
  });
  const add = (sq, color = 'b', type = 'p') => {
    const mesh = board._makePiece(); const [x, z] = board._sqToXZ(sq);
    mesh.position.set(x, 0, z); mesh.userData.gripH = 0.7;
    const piece = { mesh, color, type }; board.pieces.set(sq, piece); board.pieceRoot.add(mesh);
    return piece;
  };
  const from = add(move.from, move.color);
  if (move.captured) add(move.flags === 'e' ? move.to[0] + (move.color === 'w' ? '5' : '4') : move.to, 'w');
  if (move.flags === 'k') add(move.color === 'w' ? 'h1' : 'h8', move.color, 'r');
  const actor = {
    mesh: {}, visible: true, reachGap: 0, beginGrab() {}, endGrab() { this.ended = true; },
    setGrab(pt, weight, grip) {
      assert.ok(pt.toArray().every(Number.isFinite));
      assert.ok(weight >= -1e-10 && weight <= 1 + 1e-10);
      assert.ok(grip >= -1e-10 && grip <= 1 + 1e-10);
    },
  };
  return { board, from, actor };
}

for (const [name, move] of [
  ['ordinary', { from: 'e7', to: 'e5', color: 'b', flags: 'b' }],
  ['capture', { from: 'e5', to: 'd4', color: 'b', flags: 'c', captured: 'p' }],
  ['en passant', { from: 'e5', to: 'd6', color: 'w', flags: 'e', captured: 'p' }],
  ['castling', { from: 'e8', to: 'g8', color: 'b', flags: 'k' }],
  ['promotion', { from: 'e2', to: 'e1', color: 'b', flags: 'p', promotion: 'q' }],
]) {
  test(`${name}: placement, release timing and input unlock stay intact`, async () => {
    const { board, from, actor } = fixture(move);
    const done = board._animateGrabMove(move, [], from, actor);
    assert.equal(board.inputLocked, true);
    let releaseTime;
    for (let i = 1; i <= 500; i++) {
      board._anims = board._anims.filter(fn => fn(0.01));
      if (!board.inputLocked && releaseTime === undefined) releaseTime = i * 0.01;
    }
    await done;
    assert.ok(Math.abs(releaseTime - (move.captured ? 3.37 : 1.84)) < 0.02);
    assert.equal(board.animating, false); assert.equal(board.inputLocked, false);
    assert.equal(actor.ended, true); assert.equal(board.grabPhase, null);
    assert.ok(board.pieces.has(move.to)); assert.ok(!board.pieces.has(move.from));
    if (move.promotion) assert.equal(board.pieces.get(move.to).type, 'q');
    if (move.flags === 'k') assert.ok(board.pieces.has('f8'));
    if (move.flags === 'e') assert.ok(!board.pieces.has('d5'));
  });
}

test('hiding the actor during pickup completes placement and unlocks input', async () => {
  const move = { from: 'e7', to: 'e5', color: 'b', flags: 'b' };
  const { board, from, actor } = fixture(move);
  const done = board._animateGrabMove(move, [], from, actor);
  board._anims = board._anims.filter(fn => fn(0.1));
  actor.visible = false;
  board._anims = board._anims.filter(fn => fn(0.1));
  await done;
  assert.equal(board.inputLocked, false); assert.equal(actor.ended, true);
  assert.equal(board.pieces.get('e5'), from);
});
