import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LemalinMMD } from '../lemalin-mmd.js';

const makeActor = () => new LemalinMMD({
  renderer: { capabilities: { getMaxAnisotropy: () => 4 } },
  actorRoot: new THREE.Group(), onFrame: [], setEngineColor() {},
});
function makeMesh() {
  const geometry = new THREE.BoxGeometry();
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, ['Body', 'Face', 'eye_L', 'Hair'].map(name => new THREE.MeshPhongMaterial({ name })));
  const root = new THREE.Bone(); root.name = 'センター'; mesh.add(root);
  const bones = [root];
  for (const name of ['上半身', '上半身2', '頭', '首', ...['左', '右'].flatMap(side => ['肩', '腕', 'ひじ', '手首', '足', 'ひざ', '足首'].map(n => side + n))]) {
    const b = new THREE.Bone(); b.name = name; root.add(b); bones.push(b);
  }
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}

test('face, body and eye programs have independent cache keys', () => {
  const actor = makeActor(); const mesh = makeMesh(); actor._toonify(mesh);
  assert.equal(new Set(mesh.material.slice(0, 3).map(m => m.customProgramCacheKey())).size, 3);
  for (const [index, strength] of [[0, '0.22'], [1, '0.10']]) {
    const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
    mesh.material[index].onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes(`lmRim * ${strength}`));
  }
});

test('outline follows shared skeleton, preserves alpha and updates for each renderer', () => {
  const actor = makeActor(); const mesh = makeMesh();
  const map = new THREE.Texture(); mesh.material[0].map = map;
  actor._toonify(mesh);
  assert.equal(actor.outline.skeleton, mesh.skeleton);
  const material = actor.outline.material[0];
  assert.equal(material.map, map);
  assert.equal(material.depthWrite, false);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.indexOf('vec2 lmNormal') > shader.vertexShader.indexOf('#include <skinning_vertex>'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.a *= texture2D'));
  actor.outline.onBeforeRender({ getRenderTarget: () => ({ width: 1000, height: 800 }), getPixelRatio: () => 2 });
  assert.deepEqual(shader.uniforms.uOutlineViewport.value.toArray(), [1000, 800]);
  actor.outline.onBeforeRender({ getRenderTarget: () => null, getDrawingBufferSize: v => v.set(192, 192), getPixelRatio: () => 1 });
  assert.deepEqual(shader.uniforms.uOutlineViewport.value.toArray(), [192, 192]);
  assert.equal(shader.uniforms.uOutlinePixelRatio.value, 1);
  actor.setQuality('low'); assert.equal(actor.outline.visible, false);
  actor.setQuality('std'); assert.equal(actor.outline.visible, true);
});

test('gesture interruption blends continuously and settles to rest', () => {
  const actor = makeActor(); actor.poseOff.armR[0] = 1;
  actor._smoothPoseOff(1 / 60);
  assert.ok(actor.smoothPose.armR[0] > 0 && actor.smoothPose.armR[0] < 0.25);
  const previous = actor.smoothPose.armR[0]; actor.poseOff.armR[0] = -1;
  actor._smoothPoseOff(1 / 60);
  assert.ok(Math.abs(actor.smoothPose.armR[0] - previous) < 0.3);
  actor.poseOff.armR[0] = 0;
  for (let i = 0; i < 120; i++) actor._smoothPoseOff(1 / 60);
  assert.ok(Math.abs(actor.smoothPose.armR[0]) < 1e-8);
});

test('gesture blend is independent of 30/60/120 Hz frame rate', () => {
  const samples = [30, 60, 120].map(fps => {
    const actor = makeActor(); actor.poseOff.headP = 0.4;
    for (let i = 0; i < fps; i++) actor._smoothPoseOff(1 / fps);
    return actor.smoothPose.headP;
  });
  assert.ok(Math.max(...samples) - Math.min(...samples) < 1e-12);
});

test('mouth crossfades vowels and fresh audio silence does not fall back to text', () => {
  const actor = makeActor(); actor.mesh = {};
  actor.audioMouth = { amp: 0.8, viseme: 'あ', ts: performance.now() };
  actor._updateMouth(1 / 60); const first = actor.weights['あ'];
  assert.ok(first > 0 && first < 0.8);
  actor.audioMouth.viseme = 'い'; actor._updateMouth(1 / 60);
  assert.ok(actor.weights['あ'] > 0 && actor.weights['あ'] < first);
  assert.ok(actor.weights['い'] > 0);
  actor.speak('あああ'); actor.audioMouth.amp = 0;
  actor._updateMouth(1 / 60);
  assert.equal(actor.talk.open, 0);
  actor.stopSpeak();
  assert.equal(Object.values(actor.mouthWeights).reduce((a, b) => a + b, 0), 0);
});

test('full synthetic rig survives reactions, interruptions and invalid frame deltas', () => {
  const actor = makeActor(); actor._setup(makeMesh());
  actor.nextIdle = Infinity;
  for (const reaction of ['start', 'think', 'capture', 'captured', 'check', 'win', 'lose', 'advHips', 'disPout']) {
    actor.react(reaction);
    for (let i = 0; i < 20; i++) actor.update(1 / 60);
  }
  actor.touch('head'); actor.update(NaN); actor.update(-1); actor.update(2);
  for (const bone of actor.mesh.skeleton.bones) {
    assert.ok(bone.quaternion.toArray().every(Number.isFinite));
    assert.ok(Math.abs(bone.quaternion.length() - 1) < 1e-10);
  }
  actor.dispose(); assert.equal(actor.board.onFrame.length, 0);
});
