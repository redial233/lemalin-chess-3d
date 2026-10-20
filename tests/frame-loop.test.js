import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Board3D } from '../board3d.js';
import { makeActor } from './helpers/character-rig.js';

// Run the production loop and real Three Clock; only browser/GPU endpoints are
// substituted. Earlier tests called update(dt) directly and missed scheduling.
function runtime(t) {
  const actor = makeActor(), board = actor.board;
  let now = 1000, nextFrame;
  const warnings = [], samples = [];
  t.mock.method(performance, 'now', () => now);
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const oldRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { nextFrame = callback; return 1; };
  t.after(() => { actor.dispose(); globalThis.requestAnimationFrame = oldRAF; });
  Object.assign(board, {
    _clock: new THREE.Clock(), _anims: [], controls: { update() {} },
    _updateFx() {}, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    _loop: Board3D.prototype._loop,
  });
  board.scene.add(board.actorRoot);
  board.renderer.render = () => {
    board.scene.updateMatrixWorld(true);
    samples.push({ time: actor.t, arm: actor.bones['右腕'].quaternion.clone(), head: actor.bones['頭'].quaternion.clone(), gesture: actor.gest?.name });
  };
  board._loop();
  return { actor, board, samples, warnings, advance(seconds, fps = 60) {
    for (let i = 0; i < seconds * fps; i++) { assert.equal(typeof nextFrame, 'function'); now += 1000 / fps; nextFrame(); }
  } };
}

test('production frame loop advances idle gestures and thinking with the real clock', t => {
  const { actor, samples, warnings, advance } = runtime(t);
  actor.nextIdle = 0.1;
  actor._pickIdle = () => 'chin';
  advance(2);
  assert.ok(actor.t > 1.9);
  assert.ok(samples.some(s => s.gesture === 'chin'));
  assert.ok(samples.some(s => s.arm.angleTo(samples[0].arm) > 0.1));
  actor.react('think'); advance(1);
  assert.equal(actor.mode, 'think');
  assert.ok(actor.gest?.t > 0.9);
  assert.ok(samples.some(s => s.head.angleTo(samples[0].head) > 0.03));
  assert.deepEqual(warnings, []);
});

test('clock-driven motion resumes after hidden actor and long frame gap', t => {
  const { actor, samples, warnings, advance } = runtime(t);
  actor.setVisible(false); advance(2);
  assert.equal(actor.t, 0);
  actor.setVisible(true); actor.nextIdle = 0.1; actor._pickIdle = () => 'chin';
  advance(2, 30);
  assert.ok(actor.t > 1.9);
  assert.ok(samples.some(s => s.gesture === 'chin'));
  const beforeGap = actor.t;
  advance(1, 1); // Simulate a one-second browser frame suspension.
  assert.ok(Math.abs(actor.t - beforeGap - 0.05) < 1e-10);
  advance(1);
  assert.ok(actor.t > beforeGap + 1);
  assert.deepEqual(warnings, []);
});

test('production loop initializes added animation state on an already loaded actor', t => {
  const { actor, samples, warnings, advance } = runtime(t);
  // Reproduce a base-created instance retained during an in-memory module swap.
  // No model, texture, password or decryption is involved in this fixture.
  delete actor.smoothPose; delete actor.mouthWeights;
  actor.nextIdle = 0.1; actor._pickIdle = () => 'chin';
  advance(2);
  assert.deepEqual(warnings, [], 'missing new state must not freeze every rendered frame');
  assert.ok(samples.some(s => s.arm.angleTo(samples[0].arm) > 0.1));
  actor.react('think'); advance(1);
  assert.ok(actor.gest?.t > 0.9);
  assert.ok(Object.values(actor.mouthWeights).every(Number.isFinite));
});
