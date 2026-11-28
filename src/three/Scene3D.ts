import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pitchFor, type PitchSpec } from '../model/pitch';
import type { TeamSide, Vec } from '../model/types';
import { apronFor, drawPitch } from './pitchTexture';
import {
  ANKLE, applyAction, BALL_SPOT, cycleRate, facingFor, gaitPose, headPitch, HIP_HEIGHT, lookAngles, newPose, SHIN, smoothstep, THIGH, wrapAngle,
  type PlayerAction,
} from './body';
import {
  cameraView, eyePoint, figureScale, gazeFor, goalHeight, POV_FOV, POV_RATES, povCamera, smoothPov, stadiumLayout, toWorld, turnTowards,
  type CameraPreset, type PovMode, type PovState, type V3,
} from './views';

export interface Actor3D {
  id: string;
  team: TeamSide;
  gk: boolean;
  number: string;
  label: string;
  x: number;
  y: number;
  /** A ball action in progress (kick, controlling touch, dribble). */
  action?: PlayerAction;
  /** Pitch point to turn towards during the action (where the ball goes / comes from). */
  face?: Vec;
}

export interface Arrow3D {
  points: Vec[];
  kind: 'run' | 'pass' | 'cross' | 'dribble' | 'shot' | 'clearance';
  team?: TeamSide;
  /** Lofted balls: the highest point of the flight (m). */
  peak?: number;
}

export interface Snapshot3D {
  players: Actor3D[];
  ball?: {
    x: number;
    y: number;
    height: number;
    /** Player with the ball at their feet; it's drawn at their foot rather than their centre. */
    owner?: string;
    /** 0..1: how far the ball is drawn at the owner's foot (eases in and out round a kick). */
    attach?: number;
    /** Whose ball it is for the "ball carrier" player view (the receiver once a pass is on its way). */
    carrier?: string;
  };
  /** During playback positions are shown exactly; otherwise players move smoothly to new spots. */
  playing: boolean;
  arrows: Arrow3D[];
}

/** The player view: whose eyes to see through, and how. */
export interface Pov3D {
  player?: string;
  mode: PovMode;
}

export interface Look3D {
  format: number;
  homeColor: string;
  awayColor: string;
  names: boolean;
  arrows: boolean;
}

const GK_COLORS = { home: '#3fb950', away: '#a371f7' };
const SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#ffdbac', '#a8714a'];
const HAIR = ['#2b1d12', '#14100c', '#5a3b1f', '#3a2a1a', '#7a5230'];

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function inkFor(hex: string): string {
  const c = new THREE.Color(hex);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.6 ? '#111111' : '#ffffff';
}

/** Shared meshes' building blocks. */
interface Parts {
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  shortsLeg: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry;
  forearm: THREE.BufferGeometry;
  nose: THREE.BufferGeometry;
  sleeve: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  shorts: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  boot: THREE.BufferGeometry;
}

interface Kit {
  shirt: THREE.Material;
  shorts: THREE.Material;
  socks: THREE.Material;
}

/** A footballer built from simple shapes: jointed legs and arms, a turning head. */
class Figure {
  readonly root = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly headG = new THREE.Group();
  private readonly hips: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly torso: THREE.Mesh;
  private readonly socks: THREE.Mesh[] = [];
  private readonly shorts: THREE.Mesh[] = [];
  private readonly shirt: THREE.Mesh[] = [];
  private readonly pose = newPose();
  private readonly scale: number;
  readonly label: THREE.Sprite;
  labelKey = '';
  pos = new THREE.Vector2();
  speed = 0;
  heading = 0;
  private moveDir = 0;
  private accel = 0;
  private fwd = 1;
  private lat = 0;
  private chest = 0;
  private neck = 0;
  private tilt = 0;
  private time = Math.random() * 100;
  private ballAhead = 0;
  phase = Math.random() * Math.PI * 2;
  placed = false;

  constructor(parts: Parts, kit: Kit, skin: THREE.Material, hair: THREE.Material, boots: THREE.Material, scale: number) {
    const s = scale;
    this.scale = s;
    this.root.scale.setScalar(s);
    this.upper.position.y = HIP_HEIGHT;
    this.root.add(this.upper);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z = 0, list?: THREE.Mesh[]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      list?.push(m);
      return m;
    };
    const group = (parent: THREE.Object3D, x: number, y: number, order: THREE.EulerOrder = 'XYZ') => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      g.rotation.order = order;
      parent.add(g);
      return g;
    };
    // Legs: thigh from the hip, shin from the knee, boot at the ankle.
    for (const side of [-1, 1]) {
      const hip = group(this.root, side * 0.1, HIP_HEIGHT, 'ZXY');
      add(parts.shortsLeg, kit.shorts, hip, 0, -0.08, 0, this.shorts);
      add(parts.thigh, skin, hip, 0, -THIGH / 2);
      const knee = group(hip, 0, -THIGH);
      add(parts.shin, kit.socks, knee, 0, -SHIN / 2 + 0.01, 0, this.socks);
      add(parts.boot, boots, knee, 0, -SHIN - ANKLE + 0.04, 0.05);
      this.hips.push(hip);
      this.knees.push(knee);
    }
    add(parts.shorts, kit.shorts, this.upper, 0, 0.01, 0, this.shorts);
    this.torso = add(parts.torso, kit.shirt, this.upper, 0, 0.36, 0, this.shirt);
    this.torso.scale.z = 0.72;
    // Head on a neck pivot so it can turn and nod.
    this.headG.position.set(0, 0.72, 0);
    this.headG.rotation.order = 'YXZ';
    this.upper.add(this.headG);
    add(parts.head, skin, this.headG, 0, 0.12);
    const h = add(parts.hair, hair, this.headG, 0, 0.13, -0.018);
    h.rotation.x = -0.45;
    add(parts.nose, skin, this.headG, 0, 0.105, 0.11);
    // Arms: upper arm from the shoulder, forearm from the elbow.
    for (const side of [-1, 1]) {
      const sh = group(this.upper, side * 0.235, 0.6, 'ZXY');
      add(parts.upperArm, skin, sh, 0, -0.14);
      add(parts.sleeve, kit.shirt, sh, 0, -0.05, 0, this.shirt);
      const el = group(sh, 0, -0.28);
      add(parts.forearm, skin, el, 0, -0.13);
      this.shoulders.push(sh);
      this.elbows.push(el);
    }
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, sizeAttenuation: false }));
    this.label.renderOrder = 10;
    this.label.center.set(0.5, 0);
  }

  setKit(kit: Kit) {
    for (const m of this.socks) m.material = kit.socks;
    for (const m of this.shorts) m.material = kit.shorts;
    for (const m of this.shirt) m.material = kit.shirt;
  }

  /**
   * Move towards `to` (world X/Z; exact during playback, smoothly otherwise) and pose the
   * body: gait from the real speed and direction, any ball action on top, head on the ball.
   */
  update(to: { x: number; z: number }, dt: number, exact: boolean, ball: V3, actor: Actor3D, owner: boolean, faceAt?: { x: number; z: number }) {
    if (!this.placed) {
      this.pos.set(to.x, to.z);
      this.placed = true;
    }
    const step = Math.max(1e-3, dt);
    const px = this.pos.x;
    const pz = this.pos.y;
    if (exact) this.pos.set(to.x, to.z);
    else {
      const k = 1 - Math.exp(-dt * 6);
      this.pos.set(px + (to.x - px) * k, pz + (to.z - pz) * k);
    }
    const vx = (this.pos.x - px) / step;
    const vz = (this.pos.y - pz) / step;
    const sp = Math.hypot(vx, vz);
    const before = this.speed;
    // Smooth the speed so the animation doesn't flicker between frames.
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt * 10));
    this.accel += ((this.speed - before) / step - this.accel) * (1 - Math.exp(-dt * 4));
    if (sp > 0.2) this.moveDir = turnTowards(this.moveDir, Math.atan2(vx, vz), dt * 14);
    this.time += dt;

    const act = actor.action;
    const striking = !!act && act.kind !== 'dribble';
    const bx = ball.x - this.pos.x;
    const bz = ball.z - this.pos.y;
    const ballDist = Math.hypot(bx, bz);
    const toBall = Math.atan2(bx, bz);
    const near = owner || ballDist < 1.2;
    let wanted: number;
    let rate: number;
    if (striking && faceAt) {
      wanted = Math.atan2(faceAt.x - this.pos.x, faceAt.z - this.pos.y);
      rate = 10;
    } else if (this.speed > 0.5) {
      wanted = near ? this.moveDir : facingFor(this.moveDir, toBall, this.speed, this.heading);
      rate = 8;
    } else {
      wanted = near ? this.heading : toBall;
      rate = 3;
    }
    this.heading = turnTowards(this.heading, wanted, dt * rate);
    // Direction of travel relative to the way the body faces (forwards, sideways, back).
    const rel = this.moveDir - this.heading;
    const kd = 1 - Math.exp(-dt * 8);
    this.fwd += (Math.cos(rel) - this.fwd) * kd;
    this.lat += (Math.sin(rel) - this.lat) * kd;
    this.phase += cycleRate(this.speed, this.fwd, this.lat) * dt;

    const pose = this.pose;
    gaitPose(pose, {
      speed: this.speed, phase: this.phase, fwd: this.fwd, lat: this.lat, accel: this.accel,
      scale: this.scale, time: this.time, dribble: owner && act?.kind === 'dribble',
    });
    const busy = applyAction(pose, act);
    this.ballAhead += (pose.ballAhead - this.ballAhead) * (1 - Math.exp(-dt * 12));

    // Head and (standing) chest towards the ball; a player on the ball looks ahead.
    const kl = 1 - Math.exp(-dt * 5);
    let neckT: number;
    let chestT: number;
    let tiltT: number;
    if (owner && !striking) {
      neckT = 0;
      chestT = 0;
      tiltT = 0.22 + 0.12 * Math.sin(this.time * 1.3);
    } else {
      const still = (1 - smoothstep(0.3, 2.5, this.speed)) * (1 - busy);
      const look = lookAngles(wrapAngle(toBall - this.heading - pose.twist), still);
      neckT = look.neck * (striking ? 0.3 : 1);
      chestT = look.chest;
      tiltT = headPitch(1.7 * this.scale, ballDist, ball.y);
    }
    this.neck += (neckT - this.neck) * kl;
    this.chest += (chestT - this.chest) * kl;
    this.tilt += (tiltT - this.tilt) * kl;

    // Joints.
    for (let i = 0; i < 2; i++) {
      this.hips[i].rotation.set(pose.hip[i], 0, pose.hipSide[i]);
      this.hips[i].position.set((i === 0 ? -0.1 : 0.1) + pose.sway, pose.pelvis, 0);
      this.knees[i].rotation.x = pose.knee[i];
      this.shoulders[i].rotation.set(pose.shoulder[i], 0, pose.shoulderSide[i]);
      this.elbows[i].rotation.x = -pose.elbow[i];
    }
    this.upper.position.set(pose.sway, pose.pelvis, 0);
    this.upper.rotation.set(pose.lean, pose.twist + this.chest, pose.roll);
    this.torso.scale.set(1 + pose.breath * 0.012, 1, 0.72 + pose.breath * 0.02);
    this.headG.rotation.set(this.tilt - pose.lean * 0.6, this.neck, 0);
    this.root.position.set(this.pos.x, 0, this.pos.y);
    this.root.rotation.y = this.heading;
  }

  /** Centre of the head (world) and the way it faces (yaw, as a heading). */
  headWorld(out: THREE.Vector3): { centre: THREE.Vector3; yaw: number } {
    this.root.updateMatrixWorld(true);
    this.headG.localToWorld(out.set(0, 0.12, 0));
    const e = this.headG.matrixWorld.elements;
    // The head group's local +Z axis in world space.
    return { centre: out, yaw: Math.atan2(e[8], e[10]) };
  }

  /**
   * Hide the head, arms and chest (for a camera at this player's eyes), so it never sees
   * the inside of its own head or a swinging arm; the legs stay, so a kick comes into view.
   */
  setHeadless(on: boolean) {
    this.upper.visible = !on;
  }

  get figureScale() {
    return this.scale;
  }

  /** Where the ball sits when it's at this player's feet (world), given its radius. */
  ballSpot(out: THREE.Vector3, radius: number): THREE.Vector3 {
    const lx = BALL_SPOT.x * this.scale;
    const lz = BALL_SPOT.z * this.scale + radius * 0.8 + this.ballAhead;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return out.set(this.pos.x + lx * c + lz * s, radius, this.pos.y - lx * s + lz * c);
  }
}

function labelTexture(number: string, label: string, color: string, names: boolean): THREE.CanvasTexture {
  const w = names ? 320 : 96;
  const h = names ? 132 : 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = 40;
  const cx = w / 2;
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, r + 6, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = inkFor(color);
  g.font = `bold ${number.length > 2 ? 34 : 44}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(number, cx, r + 8);
  if (names && label) {
    g.font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(label, cx, h - 20);
    g.fillStyle = '#ffffff';
    g.fillText(label, cx, h - 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1a1a1a';
  // A loose panel pattern: enough to see the ball spin.
  for (const [x, y] of [[32, 24], [96, 64], [160, 24], [224, 64], [32, 104], [160, 104], [96, 0], [224, 128]]) {
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      const px = x + Math.cos(a) * 15;
      const py = y + Math.sin(a) * 15;
      if (k) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Rows of fans: mostly the two teams' colours, some white and dark, on grey seats. */
function crowdTexture(home: string, away: string, small: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26313d';
  g.fillRect(0, 0, 512, 256);
  const palette = [home, home, home, away, '#ffffff', '#d9d9d9', '#1a1a1a', '#3d4b5a', shade(home, 0.7)];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rowH = small ? 16 : 10;
  for (let y = 2; y < 256; y += rowH) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, y + rowH - 2, 512, 1);
    for (let x = 1; x < 512; x += 4 + Math.floor(rnd() * 3)) {
      if (rnd() < 0.12) continue; // empty seat
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.fillRect(x, y + Math.floor(rnd() * 2), 3, rowH - 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1b2a';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#3ddc84';
  g.font = 'bold 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  g.textBaseline = 'middle';
  for (let x = 20; x < 1024; x += 512) g.fillText('TACTICAL MANAGER', x, 34);
  g.fillStyle = '#ffffff';
  for (let x = 400; x < 1024; x += 512) g.fillText('⚽', x, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A flat strip along a path on the grass, optionally dashed. */
function ribbon(points: V3[], width: number, dash?: [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (a: V3, b: V3) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    pos.push(a.x + nx, a.y, a.z + nz, a.x - nx, a.y, a.z - nz, b.x + nx, b.y, b.z + nz);
    pos.push(b.x + nx, b.y, b.z + nz, a.x - nx, a.y, a.z - nz, b.x - nx, b.y, b.z - nz);
  };
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (!dash) {
      quad(a, b);
      continue;
    }
    // Split the segment into dashes, continuing the pattern from the previous one.
    let s = 0;
    while (s < len) {
      const cycle = dash[0] + dash[1];
      const inCycle = (travelled + s) % cycle;
      const step = inCycle < dash[0] ? Math.min(dash[0] - inCycle, len - s) : Math.min(cycle - inCycle, len - s);
      if (inCycle < dash[0]) {
        const f0 = s / len;
        const f1 = (s + step) / len;
        quad(
          { x: a.x + (b.x - a.x) * f0, y: a.y, z: a.z + (b.z - a.z) * f0 },
          { x: a.x + (b.x - a.x) * f1, y: a.y, z: a.z + (b.z - a.z) * f1 },
        );
      }
      s += Math.max(step, 1e-3);
    }
    travelled += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function arrowHead(tip: V3, from: V3, size: number): THREE.BufferGeometry {
  const dx = tip.x - from.x;
  const dz = tip.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const bx = tip.x - ux * size;
  const bz = tip.z - uz * size;
  const w = size * 0.55;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([tip.x, tip.y, tip.z, bx - uz * w, tip.y, bz + ux * w, bx + uz * w, tip.y, bz - ux * w], 3));
  return g;
}

/** The 3D match view: one instance per canvas. */
export class Scene3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly sun: THREE.DirectionalLight;
  private readonly pitchGroup = new THREE.Group();
  private readonly arrowGroup = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private readonly parts: Parts;
  private readonly skins: THREE.Material[];
  private readonly hairs: THREE.Material[];
  private readonly boots = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.55 });
  private kits: Record<string, Kit> = {};
  private ball?: THREE.Mesh;
  private ballShadow?: THREE.Mesh;
  private ballPos = new THREE.Vector3();
  private readonly ballTarget = new THREE.Vector3();
  private readonly ballSpot = new THREE.Vector3();
  private readonly ballPrev = new THREE.Vector3();
  private readonly ballAxis = new THREE.Vector3();
  private ballPlaced = false;
  private pitch: PitchSpec = pitchFor(11);
  private look: Look3D = { format: 11, homeColor: '#f5c518', awayColor: '#e5484d', names: true, arrows: true };
  private snapshot: Snapshot3D = { players: [], playing: false, arrows: [] };
  private arrowKey = '';
  private preset: CameraPreset = 'broadcast';
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camPlaced = false;
  private focus = new THREE.Vector3();
  private pov: Pov3D = { mode: 'eyes' };
  private povState?: PovState;
  /** Whose eyes the camera was at last frame, and how far (0..1) it has glided to a new player. */
  private povWho?: string;
  private povSwap = 1;
  private headless?: Figure;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private down?: { x: number; y: number; id: number };
  /** Called when a player is clicked / tapped in the player view. */
  onPickPlayer?: (id: string) => void;
  private raf = 0;
  private last = 0;
  private readonly resize: ResizeObserver;
  /** Called when the user takes over the camera (drag / zoom). */
  onUserCamera?: () => void;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    host.appendChild(this.renderer.domElement);

    const sky = new THREE.Color('#0b1520');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 140, 420);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.3, 1200);
    this.scene.add(new THREE.HemisphereLight('#dce9ff', '#24401f', 1.15));
    this.sun = new THREE.DirectionalLight('#fff6e8', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.pitchGroup, this.arrowGroup);

    this.parts = {
      thigh: new THREE.CapsuleGeometry(0.082, THIGH - 0.15, 4, 10),
      shin: new THREE.CapsuleGeometry(0.066, SHIN - 0.12, 4, 10),
      shortsLeg: new THREE.CylinderGeometry(0.108, 0.1, 0.2, 12),
      upperArm: new THREE.CapsuleGeometry(0.052, 0.2, 4, 8),
      forearm: new THREE.CapsuleGeometry(0.045, 0.18, 4, 8),
      nose: new THREE.SphereGeometry(0.024, 8, 6),
      sleeve: new THREE.CylinderGeometry(0.074, 0.068, 0.16, 10),
      torso: new THREE.CapsuleGeometry(0.19, 0.3, 6, 14),
      shorts: new THREE.CylinderGeometry(0.205, 0.215, 0.2, 14),
      head: new THREE.SphereGeometry(0.115, 16, 12),
      hair: new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1),
      boot: new THREE.BoxGeometry(0.12, 0.08, 0.26),
    };
    this.skins = SKIN.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 }));
    this.hairs = HAIR.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 4;
    // Dragging or zooming hands the camera to the user (Free); a click or tap without a
    // drag picks a player in the player view.
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.takeOver, { passive: true });

    this.buildPitch();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.raf = requestAnimationFrame(this.tick);
  }

  private takeOver = () => {
    if (this.preset !== 'free') {
      this.preset = 'free';
      this.onUserCamera?.();
    }
  };

  private onDown = (e: PointerEvent) => {
    if (this.down && this.down.id !== e.pointerId) this.takeOver(); // second finger: pinch
    this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  private onMove = (e: PointerEvent) => {
    if (this.down) {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) {
        this.down = undefined;
        this.takeOver();
      }
    } else if (this.preset === 'player' && e.pointerType === 'mouse') {
      this.renderer.domElement.style.cursor = this.pick(e) ? 'pointer' : '';
    }
  };

  private onCancel = () => {
    this.down = undefined;
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = undefined;
    if (!d || this.preset !== 'player') return;
    const id = this.pick(e);
    if (id) this.onPickPlayer?.(id);
  };

  /** The player under a screen point (their body or their number label). */
  private pick(e: PointerEvent): string | undefined {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const owner = new Map<THREE.Object3D, string>();
    for (const [id, f] of this.figures) {
      owner.set(f.root, id);
      owner.set(f.label, id);
    }
    const hits = this.raycaster.intersectObjects([...owner.keys()], true);
    for (const h of hits) {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        const id = owner.get(o);
        if (id && o.visible && h.object.visible) return id;
      }
    }
    return undefined;
  }

  private fit() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private kitFor(team: TeamSide, gk: boolean): Kit {
    const key = `${team}-${gk ? 'gk' : 'out'}`;
    if (!this.kits[key]) {
      const color = gk ? GK_COLORS[team] : team === 'home' ? this.look.homeColor : this.look.awayColor;
      this.kits[key] = {
        shirt: new THREE.MeshStandardMaterial({ color, roughness: 0.62 }),
        shorts: new THREE.MeshStandardMaterial({ color: shade(color, gk ? 0.35 : 0.42), roughness: 0.7 }),
        socks: new THREE.MeshStandardMaterial({ color: shade(color, 0.9), roughness: 0.7 }),
      };
    }
    return this.kits[key];
  }

  private buildPitch() {
    const p = this.pitch;
    const small = this.look.format <= 5;
    for (const child of [...this.pitchGroup.children]) {
      this.pitchGroup.remove(child);
      disposeTree(child);
    }
    const M = apronFor(p);
    const tex = new THREE.CanvasTexture(drawPitch(p, small));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(p.length + 2 * M, p.width + 2 * M),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.pitchGroup.add(grass);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(p.length * 6, p.width * 8),
      new THREE.MeshStandardMaterial({ color: small ? '#16324d' : '#1c3a22', roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.pitchGroup.add(outer);

    // Goals: posts, crossbar and a net.
    const H = goalHeight(p);
    const post = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
    const netMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32 });
    const r = Math.max(0.05, p.goalWidth * 0.008);
    const depth = stadiumLayout(p).goalDepth;
    for (const side of [-1, 1]) {
      const gx = (side * p.length) / 2;
      const g = new THREE.Group();
      for (const z of [-p.goalWidth / 2, p.goalWidth / 2]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 12), post);
        m.position.set(gx, H / 2, z);
        m.castShadow = true;
        g.add(m);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, p.goalWidth + r * 2, 12), post);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(gx, H, 0);
      bar.castShadow = true;
      g.add(bar);
      const pts: number[] = [];
      const back = gx + side * depth;
      const step = 0.25;
      const seg = (a: number[], b: number[]) => pts.push(...a, ...b);
      for (let z = -p.goalWidth / 2; z <= p.goalWidth / 2 + 1e-6; z += step) {
        seg([back, 0, z], [back, H * 0.75, z]); // back
        seg([gx, H, z], [back, H * 0.75, z]); // roof
      }
      for (let y = 0; y <= H * 0.75 + 1e-6; y += step) seg([back, y, -p.goalWidth / 2], [back, y, p.goalWidth / 2]);
      for (const z of [-p.goalWidth / 2, p.goalWidth / 2]) {
        for (let k = 0; k <= 1 + 1e-6; k += step / depth) {
          const x = gx + side * depth * k;
          seg([x, 0, z], [x, H - (H * 0.25) * k, z]); // sides
        }
        for (let y = 0; y <= H; y += step) seg([gx, y, z], [back, Math.min(y, H * 0.75), z]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, netMat));
      this.pitchGroup.add(g);
    }

    // Advertising boards round the pitch.
    const boardTex = boardTexture();
    const off = stadiumLayout(p).off;
    const boardH = small ? 0.6 : 0.9;
    const mkBoard = (len: number, x: number, z: number, rotY: number) => {
      const t = boardTex.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, len / 22), 1);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, boardH, 0.12),
        new THREE.MeshStandardMaterial({ color: '#ffffff', map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.6 }),
      );
      m.position.set(x, boardH / 2, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      this.pitchGroup.add(m);
    };
    mkBoard(p.length + off * 2, 0, -p.width / 2 - off, 0);
    mkBoard(p.length + off * 2, 0, p.width / 2 + off, Math.PI);
    for (const side of [-1, 1]) mkBoard(p.width + off * 2, side * (p.length / 2 + depth + off), 0, side * (Math.PI / 2));

    // Stands with a crowd behind the boards, and floodlight masts in the corners.
    this.buildStadium(small);

    // Ball and its shadow.
    if (!this.ball) {
      const br = 0.11 * (small ? 1.35 : 1.7);
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(br, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }));
      this.ball.castShadow = true;
      this.ballShadow = new THREE.Mesh(
        new THREE.CircleGeometry(br * 1.3, 24),
        new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
      );
      this.ballShadow.rotation.x = -Math.PI / 2;
      this.scene.add(this.ball, this.ballShadow);
    }

    // Light and shadows sized to the pitch; fog far enough not to wash it out.
    const L = p.length;
    this.sun.position.set(-L * 0.35, L * 0.75, L * 0.3);
    const cam = this.sun.shadow.camera;
    cam.left = -(L / 2 + 14);
    cam.right = L / 2 + 14;
    cam.top = p.width / 2 + 14;
    cam.bottom = -(p.width / 2 + 14);
    cam.near = 1;
    cam.far = L * 2.5;
    cam.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = L * 1.4;
    fog.far = L * 4;
    this.controls.maxDistance = L * 2.4;
    this.camera.far = L * 8;
    this.camera.updateProjectionMatrix();
  }

  private buildStadium(small: boolean) {
    const p = this.pitch;
    const L = p.length;
    const crowd = crowdTexture(this.look.homeColor, this.look.awayColor, small);
    const { off, gap, rise, deep, goalDepth } = stadiumLayout(p);
    const seatMat = (len: number) => {
      const t = crowd.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, len / 30), 1);
      return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.18, roughness: 1 });
    };
    const wallMat = new THREE.MeshStandardMaterial({ color: '#141d27', roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#0f161e', roughness: 0.8, metalness: 0.2 });
    // One stand: a sloped bank of seats rising away from the pitch, with a roof.
    const stand = (len: number, cx: number, cz: number, rotY: number) => {
      const g = new THREE.Group();
      const slope = Math.hypot(rise, deep);
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), seatMat(len));
      seats.rotation.x = -Math.atan2(deep, rise);
      seats.position.set(0, rise / 2 + 0.4, deep / 2);
      g.add(seats);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, rise + 2, 0.6), wallMat);
      back.position.set(0, (rise + 2) / 2, deep + 0.3);
      g.add(back);
      const front = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.4), wallMat);
      front.position.set(0, 0.6, 0);
      g.add(front);
      if (!small) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, deep * 0.75), roofMat);
        roof.position.set(0, rise + 4.5, deep * 0.62);
        roof.rotation.x = -0.06;
        g.add(roof);
      }
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;
      this.pitchGroup.add(g);
    };
    const sideLen = L + off * 2;
    const endLen = p.width + off * 2;
    stand(sideLen, 0, -(p.width / 2 + off + gap), Math.PI);
    stand(sideLen, 0, p.width / 2 + off + gap, 0);
    for (const side of [-1, 1]) stand(endLen, side * (L / 2 + goalDepth + off + gap), 0, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    // Floodlight masts at the corners.
    if (!small) {
      const mastMat = new THREE.MeshStandardMaterial({ color: '#3a4654', roughness: 0.6, metalness: 0.4 });
      const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6dd', emissiveIntensity: 2.2 });
      const hMast = rise + L * 0.18;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx * (L / 2 + goalDepth + off + deep * 0.6);
          const z = sz * (p.width / 2 + off + deep * 0.6);
          const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, hMast, 8), mastMat);
          mast.position.set(x, hMast / 2, z);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.6), lampMat);
          lamp.position.set(x, hMast + 1.5, z);
          lamp.lookAt(0, 0, 0);
          this.pitchGroup.add(mast, lamp);
        }
      }
    }
  }

  setLook(look: Look3D) {
    const formatChanged = look.format !== this.look.format;
    const colorsChanged = look.homeColor !== this.look.homeColor || look.awayColor !== this.look.awayColor;
    this.look = look;
    if (formatChanged) {
      this.pitch = pitchFor(look.format);
      if (this.ball) {
        this.scene.remove(this.ball, this.ballShadow!);
        disposeTree(this.ball);
        disposeTree(this.ballShadow!);
        this.ball = undefined;
        this.ballPlaced = false;
      }
      for (const f of this.figures.values()) this.removeFigure(f);
      this.figures.clear();
      this.buildPitch();
      this.camPlaced = false;
    }
    if (colorsChanged) {
      for (const k of Object.values(this.kits)) for (const m of Object.values(k)) m.dispose();
      this.kits = {};
      for (const f of this.figures.values()) f.labelKey = '';
    }
    this.arrowKey = '';
    this.syncFigures();
  }

  setSnapshot(s: Snapshot3D) {
    this.snapshot = s;
    this.syncFigures();
  }

  setCamera(preset: CameraPreset) {
    if (preset === 'player' && this.preset !== 'player') this.startPov();
    this.preset = preset;
  }

  setPov(pov: Pov3D) {
    this.pov = pov;
  }

  /** Begin the player view from wherever the camera is now, so it glides in. */
  private startPov() {
    const dir = this.camera.getWorldDirection(this.tmp);
    const p = this.camera.position;
    this.povState = { eye: { x: p.x, y: p.y, z: p.z }, yaw: Math.atan2(dir.x, dir.z), pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))) };
    this.povWho = undefined;
  }

  private removeFigure(f: Figure) {
    this.scene.remove(f.root, f.label);
    (f.label.material as THREE.SpriteMaterial).map?.dispose();
    f.label.material.dispose();
  }

  /** Add / remove / recolour figures to match the snapshot. */
  private syncFigures() {
    const scale = figureScale(this.pitch);
    const seen = new Set<string>();
    for (const a of this.snapshot.players) {
      seen.add(a.id);
      const kit = this.kitFor(a.team, a.gk);
      let f = this.figures.get(a.id);
      if (!f) {
        const h = hashOf(a.id);
        f = new Figure(this.parts, kit, this.skins[h % this.skins.length], this.hairs[h % this.hairs.length], this.boots, scale);
        this.figures.set(a.id, f);
        this.scene.add(f.root, f.label);
      } else f.setKit(kit);
      const color = a.gk ? GK_COLORS[a.team] : a.team === 'home' ? this.look.homeColor : this.look.awayColor;
      const key = `${a.number}|${a.label}|${color}|${this.look.names}`;
      if (f.labelKey !== key) {
        const mat = f.label.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = labelTexture(a.number, a.label, color, this.look.names);
        mat.needsUpdate = true;
        f.labelKey = key;
      }
    }
    for (const [id, f] of this.figures) {
      if (!seen.has(id)) {
        this.removeFigure(f);
        this.figures.delete(id);
      }
    }
  }

  private buildArrows() {
    const key = this.look.arrows ? `${this.snapshot.playing}|${JSON.stringify(this.snapshot.arrows)}` : 'off';
    if (key === this.arrowKey) return;
    this.arrowKey = key;
    for (const child of [...this.arrowGroup.children]) {
      this.arrowGroup.remove(child);
      disposeTree(child);
    }
    if (!this.look.arrows) return;
    const p = this.pitch;
    const w = Math.max(0.2, p.length / 300);
    for (const a of this.snapshot.arrows) {
      if (a.points.length < 2) continue;
      const color = a.kind === 'shot' ? '#ff6b6b' : a.kind === 'run' ? (a.team === 'away' ? this.look.awayColor : this.look.homeColor) : '#ffffff';
      const mat = new THREE.MeshBasicMaterial({
        // Faint while the move plays (they'd clutter the picture), clear when paused.
        color, transparent: true, opacity: (a.kind === 'run' ? 0.72 : 0.85) * (this.snapshot.playing ? 0.4 : 1), depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const ground = a.points.map((v) => toWorld(p, v, 0.03));
      if (a.kind === 'cross' && a.peak) {
        // Lofted ball: draw the flight through the air.
        const from = ground[0];
        const to = ground[ground.length - 1];
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(from.x, 0.2, from.z),
          new THREE.Vector3((from.x + to.x) / 2, a.peak * 2, (from.z + to.z) / 2),
          new THREE.Vector3(to.x, 0.2, to.z),
        );
        this.arrowGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, w * 0.28, 6, false), mat));
        this.arrowGroup.add(new THREE.Mesh(arrowHead(to, curve.getPoint(0.9), w * 3.2), mat));
        continue;
      }
      const dash: [number, number] | undefined = a.kind === 'run' ? [w * 4, w * 2.6] : a.kind === 'dribble' ? [w * 1.2, w * 1.6] : undefined;
      // Stop short of the end so the arrowhead sits clear of the player.
      const last = ground[ground.length - 1];
      const prev = ground[ground.length - 2];
      const d = Math.hypot(last.x - prev.x, last.z - prev.z);
      const head = w * 3.4;
      const trimmed = ground.slice(0, -1).concat(d > head ? [{ x: last.x - ((last.x - prev.x) / d) * head * 0.8, y: last.y, z: last.z - ((last.z - prev.z) / d) * head * 0.8 }] : [last]);
      this.arrowGroup.add(new THREE.Mesh(ribbon(trimmed, w, dash), mat));
      this.arrowGroup.add(new THREE.Mesh(arrowHead(last, prev, head), mat));
    }
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    const p = this.pitch;
    const s = this.snapshot;
    const ballW = s.ball ? toWorld(p, s.ball, s.ball.height) : { x: 0, y: 0, z: 0 };
    // Labels: a steady size on screen, smaller on small screens so they don't crowd.
    const screen = Math.min(this.host.clientWidth, this.host.clientHeight);
    const labelPx = (this.look.names ? 52 : 30) * Math.max(0.55, Math.min(1, screen / 720));
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    // Players.
    for (const a of s.players) {
      const f = this.figures.get(a.id);
      if (!f) continue;
      const to = toWorld(p, a);
      f.update(to, dt, s.playing, ballW, a, s.ball?.owner === a.id, a.face ? toWorld(p, a.face) : undefined);
      const top = 2.2 * figureScale(p);
      f.label.position.set(f.root.position.x, top, f.root.position.z);
      const px = labelPx / Math.max(1, this.host.clientHeight);
      const map = (f.label.material as THREE.SpriteMaterial).map;
      const aspect = map ? (map.image as HTMLCanvasElement).width / (map.image as HTMLCanvasElement).height : 1;
      f.label.scale.set(px * k * aspect, px * k, 1);
    }
    // Ball: rolls along the ground, flies when it's lofted.
    if (this.ball && s.ball) {
      const br = (this.ball.geometry as THREE.SphereGeometry).parameters.radius;
      const target = this.ballTarget.set(ballW.x, br + ballW.y, ballW.z);
      // At a player's feet the ball sits in front of their foot, not under their centre.
      const owner = s.ball.owner ? this.figures.get(s.ball.owner) : undefined;
      const attach = s.ball.attach ?? 1;
      if (owner && attach > 0) target.lerp(owner.ballSpot(this.ballSpot, br), attach);
      if (!this.ballPlaced) {
        this.ballPos.copy(target);
        this.ballPlaced = true;
      }
      const prev = this.ballPrev.copy(this.ballPos);
      if (s.playing) this.ballPos.copy(target);
      else this.ballPos.lerp(target, 1 - Math.exp(-dt * 7));
      const move = prev.subVectors(this.ballPos, prev);
      const ground = Math.hypot(move.x, move.z);
      if (ground > 1e-4) this.ball.rotateOnWorldAxis(this.ballAxis.set(move.z, 0, -move.x).normalize(), ground / br);
      this.ball.position.copy(this.ballPos);
      this.ball.visible = true;
      const hgt = this.ballPos.y - br;
      this.ballShadow!.position.set(this.ballPos.x, 0.025, this.ballPos.z);
      const sc = 1 + hgt * 0.12;
      this.ballShadow!.scale.set(sc, sc, sc);
      (this.ballShadow!.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.38 - hgt * 0.05);
    } else if (this.ball) this.ball.visible = false;
    this.buildArrows();
    // Camera: glide to the chosen view; in Free the user drives it.
    this.focus.lerp(new THREE.Vector3(ballW.x, 0, ballW.z), 1 - Math.exp(-dt * 2.2));
    const subject = this.preset === 'player' && this.pov.player ? this.figures.get(this.pov.player) : undefined;
    const hide = subject && this.pov.mode === 'eyes' ? subject : undefined;
    if (hide !== this.headless) {
      this.headless?.setHeadless(false);
      hide?.setHeadless(true);
      this.headless = hide;
    }
    for (const [id, f] of this.figures) f.label.visible = !(subject && id === this.pov.player);
    if (subject) {
      this.playerCamera(subject, ballW, dt);
    } else if (this.preset !== 'free') {
      const preset = this.preset === 'player' ? 'follow' : this.preset;
      const v = cameraView(preset, p, { x: this.focus.x, y: 0, z: this.focus.z }, this.camera.aspect);
      const pos = new THREE.Vector3(v.position.x, v.position.y, v.position.z);
      const tgt = new THREE.Vector3(v.target.x, v.target.y, v.target.z);
      if (!this.camPlaced) {
        this.camPos.copy(pos);
        this.camTarget.copy(tgt);
        this.camPlaced = true;
      }
      const k = 1 - Math.exp(-dt * 3.2);
      this.camPos.lerp(pos, k);
      this.camTarget.lerp(tgt, k);
      this.camera.fov += (v.fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.camPos);
      this.controls.target.copy(this.camTarget);
      this.camera.lookAt(this.camTarget);
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Through the chosen player's eyes (or over their shoulder), smoothed. */
  private playerCamera(f: Figure, ball: V3, dt: number) {
    const id = this.pov.player!;
    if (id !== this.povWho) {
      // A new player (or the ball carrier changed): glide across rather than cut.
      if (this.povWho !== undefined || this.povState) this.povSwap = 0;
      this.povWho = id;
    }
    this.povSwap = Math.min(1, this.povSwap + dt / 0.9);
    const scale = f.figureScale;
    const head = f.headWorld(this.tmp);
    const eye = eyePoint(head.centre, head.yaw, scale);
    const owner = this.snapshot.ball?.owner === id;
    const ballPt = this.ball?.visible ? { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z } : this.snapshot.ball ? ball : undefined;
    const mode = this.pov.mode;
    const gaze = gazeFor(eye, head.yaw, ballPt, owner, POV_FOV[mode], this.camera.aspect);
    const glide = this.povSwap * this.povSwap * (3 - 2 * this.povSwap);
    const rates = {
      move: 3 + (POV_RATES.move - 3) * glide,
      rise: Math.min(POV_RATES.move, POV_RATES.rise + 3 * (1 - glide)),
      turn: POV_RATES.turn * (0.6 + 0.4 * glide),
    };
    this.povState = smoothPov(this.povState, { eye, ...gaze }, dt, rates);
    const v = povCamera(this.povState, mode, scale);
    this.camPos.set(v.position.x, v.position.y, v.position.z);
    this.camTarget.set(v.target.x, v.target.y, v.target.z);
    this.camPlaced = true;
    this.camera.fov += (v.fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.camPos);
    this.controls.target.copy(this.camTarget);
    this.camera.lookAt(this.camTarget);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('wheel', this.takeOver);
    this.resize.disconnect();
    this.controls.dispose();
    for (const f of this.figures.values()) this.removeFigure(f);
    this.figures.clear();
    disposeTree(this.scene);
    for (const g of Object.values(this.parts)) g.dispose();
    for (const m of [...this.skins, ...this.hairs, this.boots]) m.dispose();
    for (const k of Object.values(this.kits)) for (const m of Object.values(k)) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      const mm = mat as THREE.MeshStandardMaterial;
      mm.map?.dispose();
      mm.emissiveMap?.dispose();
      mat.dispose();
    }
  });
}
