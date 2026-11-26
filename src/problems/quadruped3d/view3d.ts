// Rendu three.js du robot : caméra qui suit, lumières avec ombres douces, sol à damier gradué.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ThemeColors } from '../../shared/ui';
import {
  LOWER_HALF_LEN,
  LOWER_RADIUS,
  NUM_LEGS,
  TORSO_HALF,
  UPPER_HALF_LEN,
  UPPER_RADIUS,
  type PartPose,
  type WorldParams,
} from './env';

/** Longueur de piste graduée (m). */
const TRACK_LEN = 60;
const TRACK_BACK = 10;

export interface RobotPoses {
  torso: PartPose;
  upper: PartPose[];
  lower: (PartPose | null)[];
}

/** Teste si WebGL est disponible (sans créer de rendu). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class RobotView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private disposables: Array<{ dispose: () => void }> = [];
  private groundTex: THREE.CanvasTexture;
  private groundMat: THREE.MeshStandardMaterial;
  private markers = new THREE.Group();
  private torso: THREE.Mesh;
  private upper: THREE.Mesh[] = [];
  private lower: THREE.Mesh[] = [];
  private stumpCaps: THREE.Mesh[] = [];
  private lockRing: THREE.Mesh;
  private mats: {
    torso: THREE.MeshStandardMaterial;
    leg: THREE.MeshStandardMaterial;
    legAlt: THREE.MeshStandardMaterial;
    bad: THREE.MeshStandardMaterial;
    front: THREE.MeshStandardMaterial;
  };
  private target = new THREE.Vector3(0, 0.45, 0);
  private theme: ThemeColors;
  private width = 1;
  private height = 1;

  constructor(private container: HTMLElement, theme: ThemeColors) {
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'quadruped3d-gl';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.camera.position.set(-0.9, 1.1, 2.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.target);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0005;
    const sc = this.sun.shadow.camera;
    sc.left = -2.5;
    sc.right = 2.5;
    sc.top = 2.5;
    sc.bottom = -2.5;
    sc.near = 0.5;
    sc.far = 12;
    this.scene.add(this.sun, this.sun.target);

    // Sol : damier de 1 m (texture répétée), avec un trait et une étiquette à chaque mètre.
    this.groundTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    const gw = TRACK_LEN + TRACK_BACK + 20;
    const gd = 24;
    this.groundTex.repeat.set(gw / 2, gd / 2); // un motif de 2 × 2 cases de 1 m
    this.groundMat = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 });
    const groundGeo = new THREE.PlaneGeometry(gw, gd);
    const ground = new THREE.Mesh(groundGeo, this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(TRACK_LEN / 2 - TRACK_BACK / 2, 0, 0);
    // Aligne le damier sur les mètres entiers.
    this.groundTex.offset.set(((ground.position.x - gw / 2) % 2) / 2, 0);
    ground.receiveShadow = true;
    this.scene.add(ground, this.markers);
    this.disposables.push(groundGeo, this.groundMat, this.groundTex);

    // Robot
    const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 });
    this.mats = { torso: mat('#888'), leg: mat('#888'), legAlt: mat('#888'), bad: mat('#888'), front: mat('#888') };
    Object.values(this.mats).forEach((m) => this.disposables.push(m));
    const torsoGeo = new THREE.BoxGeometry(TORSO_HALF.x * 2, TORSO_HALF.y * 2, TORSO_HALF.z * 2);
    this.torso = new THREE.Mesh(torsoGeo, this.mats.torso);
    this.torso.castShadow = true;
    // Repère « avant » : une bande colorée sur le nez du tronc.
    const noseGeo = new THREE.BoxGeometry(0.04, TORSO_HALF.y * 2.02, TORSO_HALF.z * 2.02);
    const nose = new THREE.Mesh(noseGeo, this.mats.front);
    nose.position.x = TORSO_HALF.x - 0.02;
    this.torso.add(nose);
    this.scene.add(this.torso);
    const upperGeo = new THREE.CapsuleGeometry(UPPER_RADIUS, 2 * (UPPER_HALF_LEN - UPPER_RADIUS * 0.5), 6, 12);
    const lowerGeo = new THREE.CapsuleGeometry(LOWER_RADIUS, 2 * LOWER_HALF_LEN, 6, 12);
    const capGeo = new THREE.SphereGeometry(UPPER_RADIUS * 1.15, 12, 8);
    const ringGeo = new THREE.TorusGeometry(UPPER_RADIUS * 1.25, 0.012, 8, 20);
    this.disposables.push(torsoGeo, noseGeo, upperGeo, lowerGeo, capGeo, ringGeo);
    for (let leg = 0; leg < NUM_LEGS; leg++) {
      const m = leg % 2 === 0 ? this.mats.leg : this.mats.legAlt;
      const u = new THREE.Mesh(upperGeo, m);
      const l = new THREE.Mesh(lowerGeo, m);
      u.castShadow = l.castShadow = true;
      const cap = new THREE.Mesh(capGeo, this.mats.bad);
      cap.position.y = -UPPER_HALF_LEN;
      cap.visible = false;
      u.add(cap);
      this.stumpCaps.push(cap);
      this.upper.push(u);
      this.lower.push(l);
      this.scene.add(u, l);
    }
    // Anneau rouge autour du genou arrière droit quand il est bloqué.
    this.lockRing = new THREE.Mesh(ringGeo, this.mats.bad);
    this.lockRing.position.y = -UPPER_HALF_LEN;
    this.lockRing.visible = false;
    this.upper[3].add(this.lockRing);

    this.applyTheme(theme);
  }

  /** Recolore la scène selon le thème clair/sombre. */
  applyTheme(t: ThemeColors): void {
    this.theme = t;
    const bg = new THREE.Color(t.bg || '#f6f7f9');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 8, 26);
    const dark = bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    this.hemi.color.set(dark ? '#c9d4ff' : '#ffffff');
    this.hemi.groundColor.set(dark ? '#20242c' : '#8a8f99');
    this.hemi.intensity = dark ? 1.1 : 1.6;
    this.sun.intensity = dark ? 1.6 : 2.2;
    this.mats.torso.color.set(t.accent || '#2f6fdf');
    this.mats.leg.color.set(t.series[1] || '#e07b2a');
    this.mats.legAlt.color.set(t.series[3] || '#9b51c9');
    this.mats.bad.color.set(t.trap || '#d64545');
    this.mats.front.color.set(t.goal || '#2e9e5b');
    this.paintGround();
    this.buildMarkers();
  }

  private paintGround(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const a = this.theme.cell || '#eef0f4';
    const b = this.theme.panel || '#ffffff';
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillRect(128, 128, 128, 128);
    this.groundTex.image = c;
    this.groundTex.needsUpdate = true;
  }

  private clearMarkers(): void {
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      const m = child as THREE.Mesh | THREE.Sprite;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
  }

  private buildMarkers(): void {
    this.clearMarkers();
    const lineGeo = new THREE.PlaneGeometry(0.02, 3);
    const lineMat = new THREE.MeshBasicMaterial({ color: this.theme.muted || '#5b6475', transparent: true, opacity: 0.55 });
    const startMat = new THREE.MeshBasicMaterial({ color: this.theme.goal || '#2e9e5b' });
    for (let m = -TRACK_BACK; m <= TRACK_LEN; m++) {
      const line = new THREE.Mesh(lineGeo, m === 0 ? startMat : lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(m, 0.002, 0);
      this.markers.add(line);
      if (m >= 0) {
        const s = this.label(m === 0 ? 'départ' : `${m} m`);
        s.position.set(m, 0.004, 1.05);
        this.markers.add(s);
      }
    }
  }

  /** Étiquette posée à plat sur le sol. */
  private label(text: string): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.font = '600 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.theme.text || '#1d2330';
    ctx.fillText(text, 128, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1, 0.375);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /** Affiche les pièces amputées ou bloquées selon le monde. */
  setWorld(w: WorldParams): void {
    this.lower[0].visible = !w.brokenFrontLeft;
    this.stumpCaps[0].visible = w.brokenFrontLeft;
    this.lockRing.visible = w.lockedRearRightKnee;
  }

  /** Recentre la caméra derrière le robot (après une remise à zéro). */
  snapCamera(x: number): void {
    const dx = x - this.target.x;
    this.target.x += dx;
    this.controls.target.copy(this.target);
    this.camera.position.x += dx;
    this.controls.update();
  }

  update(p: RobotPoses): void {
    const set = (m: THREE.Object3D, pose: PartPose) => {
      m.position.set(pose.p.x, pose.p.y, pose.p.z);
      m.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    };
    set(this.torso, p.torso);
    for (let i = 0; i < NUM_LEGS; i++) {
      set(this.upper[i], p.upper[i]);
      const lp = p.lower[i];
      if (lp) set(this.lower[i], lp);
    }
    // Caméra : suit doucement le robot (on déplace la cible et la caméra du même vecteur).
    const t = p.torso.p;
    const nx = this.target.x + (t.x - this.target.x) * 0.06;
    const nz = this.target.z + (t.z - this.target.z) * 0.06;
    const dx = nx - this.target.x;
    const dz = nz - this.target.z;
    this.target.set(nx, 0.4, nz);
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    this.controls.target.copy(this.target);
    this.sun.position.set(nx + 2, 5, nz + 3);
    this.sun.target.position.set(nx, 0, nz);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Écran étroit (téléphone) : on élargit le champ pour garder le robot entier.
    this.camera.fov = w / h < 0.9 ? 60 : 45;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.clearMarkers();
    const seen = new Set<{ dispose: () => void }>();
    for (const d of this.disposables) {
      if (seen.has(d)) continue;
      seen.add(d);
      d.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
