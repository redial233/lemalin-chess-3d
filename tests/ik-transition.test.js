import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LemalinMMD } from '../lemalin-mmd.js';

// Exercise the real analytic solver: the arm, elbow, wrist and fingers are
// parented chains with nonzero lengths, rather than sibling placeholder bones.
function makeActor() {
  const board = {
    renderer: { capabilities: { getMaxAnisotropy: () => 4 } },
    actorRoot: new THREE.Group(), onFrame: [], setEngineColor() {},
  };
  const actor = new LemalinMMD(board);
  const geometry = new THREE.BoxGeometry();
  const count = geometry.attributes.position.count;
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshPhongMaterial({ name: 'Body' }));
  const bones = [];
  const add = (name, parent, position = [0, 0, 0]) => {
    const bone = new THREE.Bone();
    bone.name = name; bone.position.fromArray(position);
    parent.add(bone); bones.push(bone);
    return bone;
  };
  const root = add('センター', mesh);
  const torso = add('上半身', root, [0, 12, 0]);
  const chest = add('上半身2', torso, [0, 1, 0]);
  const neck = add('首', chest, [0, 1, 0]);
  add('頭', neck, [0, 1, 0]);
  for (const [side, sign] of [['左', 1], ['右', -1]]) {
    const shoulder = add(side + '肩', chest, [sign, 0, 0]);
    const arm = add(side + '腕', shoulder, [sign, 0, 0]);
    const elbow = add(side + 'ひじ', arm, [sign * 2, 0, 0]);
    const wrist = add(side + '手首', elbow, [sign * 2, 0, 0]);
    for (const [finger, z] of [['人指', -0.15], ['中指', 0], ['薬指', 0.15], ['小指', 0.3]]) {
      const first = add(side + finger + '１', wrist, [sign * 0.5, 0, z]);
      const second = add(side + finger + '２', first, [sign * 0.25, 0, 0]);
      add(side + finger + '３', second, [sign * 0.2, 0, 0]);
    }
    const thumb = add(side + '親指１', wrist, [sign * 0.2, -0.15, -0.3]);
    add(side + '親指２', thumb, [sign * 0.25, 0, 0]);
    const thigh = add(side + '足', root, [sign * 0.6, 5, 0]);
    const knee = add(side + 'ひざ', thigh, [0, -2, 0]);
    add(side + '足首', knee, [0, -2, 0]);
  }
  mesh.bind(new THREE.Skeleton(bones));
  actor._setup(mesh);
  actor.nextIdle = Infinity; actor.nextBlink = Infinity;
  board.actorRoot.updateMatrixWorld(true);
  return actor;
}

function target(actor, x = -1, z = 3) {
  actor.board.actorRoot.updateMatrixWorld(true);
  return actor.anchor.localToWorld(new THREE.Vector3(x, 0, z));
}

function assertFiniteRig(actor) {
  actor.board.actorRoot.updateMatrixWorld(true);
  for (const bone of actor.mesh.skeleton.bones) {
    assert.ok(bone.quaternion.toArray().every(Number.isFinite), bone.name);
    assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-10, bone.name);
    assert.ok(bone.matrixWorld.elements.every(Number.isFinite), bone.name);
  }
  assert.ok(Number.isFinite(actor.reachGap));
}

test('gesture to zero-weight IK preserves the displayed pose and relaxes gradually', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  actor.poseOff.armR[0] = 1;
  for (let i = 0; i < 60; i++) actor.update(1 / 60);
  const arm = actor.bones['右腕'];
  const displayed = arm.quaternion.clone();
  assert.ok(displayed.angleTo(actor.rest.get(arm)) > 0.99);
  const point = target(actor);
  actor.beginGrab(point); actor.setGrab(point, 0, 0); actor.update(0);
  assert.ok(displayed.angleTo(arm.quaternion) < 1e-7);
  actor.update(1 / 60);
  const firstFrameChange = displayed.angleTo(arm.quaternion);
  assert.ok(firstFrameChange > 0 && firstFrameChange < 0.2);
  for (let i = 0; i < 180; i++) actor.update(1 / 60);
  assert.ok(arm.quaternion.angleTo(actor.rest.get(arm)) < 1e-6);
  assertFiniteRig(actor);
});

test('both nonzero-length arm chains solve finite full-weight reachable and distant targets', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  for (const side of ['左', '右']) {
    const arm = actor.bones[side + '腕'];
    const elbow = actor.bones[side + 'ひじ'];
    const wrist = actor.bones[side + '手首'];
    assert.equal(elbow.parent, arm); assert.equal(wrist.parent, elbow);
    assert.ok(elbow.position.length() > 0); assert.ok(wrist.position.length() > 0);
    for (const z of [2, 10]) {
      const point = target(actor, side === '左' ? 1 : -1, z);
      actor.beginGrab(point); actor.setGrab(point, 1, 1);
      for (let i = 0; i < 60; i++) actor.update(1 / 60);
      assertFiniteRig(actor);
      if (z === 2) assert.equal(actor.reachGap, 0, 'near target should exercise reachable IK');
      else assert.ok(actor.reachGap > 0, 'far target should exercise extension clamping');
      assert.ok(arm.quaternion.angleTo(actor.rest.get(arm)) > 0.1);
      assert.ok(actor.bones[side + '中指１'].quaternion.angleTo(new THREE.Quaternion()) > 0.5);
      actor.endGrab();
    }
  }
});

test('retraction reaches seated rest and endGrab clears the transition state', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  actor.poseOff.armR[0] = 0.8;
  for (let i = 0; i < 60; i++) actor.update(1 / 60);
  const point = target(actor);
  actor.beginGrab(point);
  // A real interrupted gesture expires while the piece is being moved.
  actor.poseOff.armR[0] = 0;
  actor.setGrab(point, 1, 1);
  for (let i = 0; i < 180; i++) actor.update(1 / 60);
  for (let i = 1; i <= 60; i++) {
    actor.setGrab(point, 1 - i / 60, 1 - i / 60); actor.update(1 / 60);
    assertFiniteRig(actor);
  }
  for (const [bone, rest] of actor.rest) assert.ok(bone.quaternion.angleTo(rest) < 1e-6, bone.name);
  actor.endGrab();
  assert.equal(actor.grab.active, false); assert.equal(actor.grab.w, 0);
  assert.equal(actor.grab.grip, 0); assert.equal(actor.grab.entryPose, null);
  assert.equal(actor.reachGap, 0);
  const arm = actor.bones['右腕']; const released = arm.quaternion.clone();
  actor.update(1 / 60);
  assert.ok(arm.quaternion.angleTo(released) < 1e-6);
});

test('restarting a grab preserves the solved arm, fingers and torso yaw', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  const firstPoint = target(actor);
  actor.beginGrab(firstPoint); actor.setGrab(firstPoint, 1, 1);
  for (let i = 0; i < 30; i++) actor.update(1 / 60);
  const joints = ['右腕', '右ひじ', '右手首', '右中指１', '右中指２', '右親指１'].map(name => actor.bones[name]);
  const before = joints.map(bone => bone.quaternion.clone());
  const torsoYaw = actor.bones['上半身'].rotation.y;
  const oldEntry = actor.grab.entryPose;
  const secondPoint = target(actor, -2, 2);
  actor.beginGrab(secondPoint); actor.setGrab(secondPoint, 0, 0);
  assert.notEqual(actor.grab.entryPose, oldEntry);
  assert.equal(actor.grab.entryTime, 0);
  actor.update(0);
  joints.forEach((bone, i) => assert.ok(bone.quaternion.angleTo(before[i]) < 1e-7, bone.name));
  assert.ok(Math.abs(actor.bones['上半身'].rotation.y - torsoYaw) < 1e-10);
  actor.update(1 / 60);
  joints.forEach((bone, i) => assert.ok(bone.quaternion.angleTo(before[i]) < 0.5, bone.name));
  assertFiniteRig(actor);
});

test('a canceled long gesture cannot reappear or leave its head-tilt target behind', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  actor._playGest('chin', 30);
  for (let i = 0; i < 360; i++) actor.update(1 / 60);
  assert.ok(actor.gest);
  assert.ok(actor.smoothPose.armR[0] > 0.3);
  assert.ok(actor.tiltTarget > 0.1);
  const arm = actor.bones['右腕']; const displayed = arm.quaternion.clone();
  const point = target(actor);
  actor.beginGrab(point);
  assert.equal(actor.gest, null);
  assert.equal(actor.tiltTarget, 0);
  for (const value of Object.values(actor.poseOff)) {
    assert.ok((Array.isArray(value) ? value : [value]).every(v => v === 0));
  }
  assert.ok(actor.smoothPose.armR[0] > 0.3, 'displayed pose must not be zeroed abruptly');
  actor.setGrab(point, 0, 0); actor.update(0);
  assert.ok(arm.quaternion.angleTo(displayed) < 1e-7);
  actor.setGrab(point, 1, 1);
  for (let i = 0; i < 180; i++) actor.update(1 / 60);
  actor.setGrab(point, 0, 0); actor.update(1 / 60); actor.endGrab();
  for (let i = 0; i < 60; i++) actor.update(1 / 60);
  assert.equal(actor.gest, null);
  assert.ok(arm.quaternion.angleTo(actor.rest.get(arm)) < 1e-6);
  assert.ok(Math.abs(actor.tilt) < 1e-6);
});

test('canceling a wink clears its morph while retaining the thinking-mode head baseline', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  actor.mode = 'think'; actor._playGest('wink', 2);
  for (let i = 0; i < 30; i++) actor.update(1 / 60);
  assert.ok(actor.weights['ウィンク'] > 0.5);
  actor.beginGrab(target(actor));
  assert.equal(actor.gest, null);
  assert.equal(actor.weights['ウィンク'], 0);
  assert.equal(actor.tiltTarget, 0.14);
});

test('restarting at full extension preserves torso pitch without double-counting breathing', t => {
  const actor = makeActor(); t.after(() => actor.dispose());
  actor.update(1 / 60);
  const distant = target(actor, -7, 10);
  actor.beginGrab(distant); actor.setGrab(distant, 1, 1);
  for (let i = 0; i < 60; i++) actor.update(1 / 60);
  const torso = actor.bones['上半身'], chest = actor.bones['上半身2'];
  const before = [torso.rotation.x, chest.rotation.x];
  const breath = Math.sin(actor.t * 1.7);
  assert.ok(Math.abs(before[0] - actor.baseLean - breath * 0.012 - 0.3) < 1e-10);
  assert.ok(Math.abs(before[1] - breath * 0.01 - 0.2) < 1e-10);
  const near = target(actor, -1, 2);
  actor.beginGrab(near); actor.setGrab(near, 0, 0); actor.update(0);
  assert.ok(Math.abs(torso.rotation.x - before[0]) < 1e-10);
  assert.ok(Math.abs(chest.rotation.x - before[1]) < 1e-10);
  actor.update(1 / 60);
  assert.ok(Math.abs(torso.rotation.x - before[0]) < 0.06);
  assert.ok(Math.abs(chest.rotation.x - before[1]) < 0.04);
  for (let i = 0; i < 180; i++) actor.update(1 / 60);
  const settledBreath = Math.sin(actor.t * 1.7);
  assert.ok(Math.abs(torso.rotation.x - actor.baseLean - settledBreath * 0.012) < 1e-10);
  assert.ok(Math.abs(chest.rotation.x - settledBreath * 0.01) < 1e-10);
  actor.endGrab();
  actor.beginGrab(near);
  assert.ok(Math.abs(actor.grab.entryLean) < 1e-10);
  assert.ok(Math.abs(actor.grab.entryLean2) < 1e-10);
  assertFiniteRig(actor);
});
