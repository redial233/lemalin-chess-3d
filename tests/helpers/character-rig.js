import * as THREE from 'three';
import { LemalinMMD } from '../../lemalin-mmd.js';

// Exercise the real analytic solver: the arm, elbow, wrist and fingers are
// parented chains with nonzero lengths, rather than sibling placeholder bones.
export function makeActor() {
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
