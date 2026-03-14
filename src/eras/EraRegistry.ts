import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { BigBang } from './01-BigBang';
import { ParticleSoup } from './02-ParticleSoup';
import { CosmicMicrowave } from './03-CosmicMicrowave';
import { DarkAges } from './04-DarkAges';
import { FirstStars } from './05-FirstStars';
import { GalaxyFormation } from './06-GalaxyFormation';
import { SolarSystemBirth } from './07-SolarSystemBirth';
import { EarthFormation } from './08-EarthFormation';
import { OceansFirstLife } from './09-OceansFirstLife';
import { ComplexLife } from './10-ComplexLife';
import { getEraColor } from '../utils/color';
import { lerp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// EraDefinition — static metadata + factory
// ---------------------------------------------------------------------------

export interface EraDefinition {
  id: string;
  name: string;
  index: number;
  scrollStart: number;
  scrollEnd: number;
  time: string;
  fact: string;
  create: () => BaseEra;
}

// ---------------------------------------------------------------------------
// PlaceholderEra — simple coloured background + star field for eras 2-10
// ---------------------------------------------------------------------------

class PlaceholderEra extends BaseEra {
  private eraIndex: number;
  private eraName: string;
  private stars: THREE.Points | null = null;

  constructor(eraIndex: number, eraName: string) {
    super();
    this.eraIndex = eraIndex;
    this.eraName = eraName;
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Simple star field background
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 80 + Math.random() * 120;
      const theta = Math.random() * Math.PI;
      const phi = Math.random() * Math.PI * 2;

      positions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.cos(theta);
      positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

      const col = getEraColor(this.eraIndex, Math.random());
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);

    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    this.isInitialized = true;
  }

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    if (this.stars) {
      this.stars.rotation.y = globalTime * 0.01;
      this.stars.rotation.x = Math.sin(globalTime * 0.005) * 0.1;
    }

    const bg = this.getBackgroundColor(progress);
    this.scene.background = bg;

    this.camera.position.y = Math.sin(globalTime * 0.08) * 0.5;
    this.camera.position.x = Math.cos(globalTime * 0.05) * 0.5;
    this.camera.lookAt(0, 0, 0);
  }

  getPostConfig(progress: number): PostConfig {
    return {
      ...this.defaultPostConfig(),
      bloomStrength: lerp(0.6, 1.0, smoothstep(0.0, 1.0, progress)),
      bloomRadius: 0.4,
      bloomThreshold: 0.3,
    };
  }

  getBackgroundColor(progress: number): THREE.Color {
    return getEraColor(this.eraIndex, progress);
  }

  override dispose(): void {
    if (this.stars) {
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
    }
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Era definitions — 10 cosmic epochs
// ---------------------------------------------------------------------------

const ERA_METADATA: Omit<EraDefinition, 'create'>[] = [
  {
    id: 'big-bang',
    name: 'The Big Bang',
    index: 0,
    scrollStart: 0.0,
    scrollEnd: 0.08,
    time: '13.8 billion years ago',
    fact: 'All matter, energy, space and time erupted from an infinitely dense singularity.',
  },
  {
    id: 'particle-soup',
    name: 'Quark–Gluon Plasma',
    index: 1,
    scrollStart: 0.08,
    scrollEnd: 0.16,
    time: '13.8 billion years ago — microseconds later',
    fact:
      'The universe was a superhot soup of quarks, gluons, and leptons at trillions of degrees.',
  },
  {
    id: 'cmb',
    name: 'Cosmic Microwave Background',
    index: 2,
    scrollStart: 0.16,
    scrollEnd: 0.23,
    time: '380,000 years after the Big Bang',
    fact:
      'As the universe cooled to ~3,000 K, electrons combined with protons — the universe became transparent.',
  },
  {
    id: 'dark-ages',
    name: 'The Cosmic Dark Ages',
    index: 3,
    scrollStart: 0.23,
    scrollEnd: 0.33,
    time: '380,000 – 150 million years',
    fact:
      'No stars existed. The universe was filled only with neutral hydrogen drifting in darkness.',
  },
  {
    id: 'first-stars',
    name: 'First Stars & Reionisation',
    index: 4,
    scrollStart: 0.33,
    scrollEnd: 0.43,
    time: '150 – 800 million years',
    fact:
      'Population III stars — hundreds of solar masses, blazing blue-white — reionised the cosmos.',
  },
  {
    id: 'galaxies',
    name: 'Galaxy Formation',
    index: 5,
    scrollStart: 0.43,
    scrollEnd: 0.55,
    time: '1 – 5 billion years',
    fact:
      'Dark matter halos merged; gas clouds collapsed into the first spiral and elliptical galaxies.',
  },
  {
    id: 'solar-system',
    name: 'Our Solar System',
    index: 6,
    scrollStart: 0.55,
    scrollEnd: 0.67,
    time: '4.6 billion years ago',
    fact:
      'A molecular cloud collapsed; the Sun ignited while rocky planets accreted from the protoplanetary disk.',
  },
  {
    id: 'earth',
    name: 'Formation of Earth',
    index: 7,
    scrollStart: 0.67,
    scrollEnd: 0.77,
    time: '4.5 billion years ago',
    fact:
      'A Mars-sized body (Theia) struck proto-Earth, ejecting material that coalesced into the Moon.',
  },
  {
    id: 'oceans',
    name: 'Oceans & Hydrothermal Vents',
    index: 8,
    scrollStart: 0.77,
    scrollEnd: 0.89,
    time: '3.8 billion years ago',
    fact:
      'Liquid water oceans formed. Deep-sea vents provided the chemistry for the first self-replicating molecules.',
  },
  {
    id: 'life',
    name: 'Life & Human Civilisation',
    index: 9,
    scrollStart: 0.89,
    scrollEnd: 1.0,
    time: '3.5 billion years ago → now',
    fact:
      'From LUCA to Homo sapiens in ~3.5 billion years; the last 10,000 years gave us cities, science, and you.',
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getEraDefinitions(): EraDefinition[] {
  return ERA_METADATA.map((meta) => {
    let factory: () => BaseEra;

    switch (meta.index) {
      case 0:  factory = (): BaseEra => new BigBang();            break;
      case 1:  factory = (): BaseEra => new ParticleSoup();       break;
      case 2:  factory = (): BaseEra => new CosmicMicrowave();    break;
      case 3:  factory = (): BaseEra => new DarkAges();           break;
      case 4:  factory = (): BaseEra => new FirstStars();         break;
      case 5:  factory = (): BaseEra => new GalaxyFormation();    break;
      case 6:  factory = (): BaseEra => new SolarSystemBirth();   break;
      case 7:  factory = (): BaseEra => new EarthFormation();     break;
      case 8:  factory = (): BaseEra => new OceansFirstLife();    break;
      case 9:  factory = (): BaseEra => new ComplexLife();        break;
      default: factory = (): BaseEra => new PlaceholderEra(meta.index, meta.name);
    }

    return { ...meta, create: factory };
  });
}
