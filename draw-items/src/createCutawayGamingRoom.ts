import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Cutaway Gaming Room
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCutawayGamingRoomModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cutaway Gaming Room";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 28.0, "aspect": 1.525, "orientation": {"yaw": 0.65, "pitch": -0.62, "roll": 0.0}, "positionHint": [4.2, 4.4, 5.6], "note": "Manual isometric match to 4.png. Not a solved pose. Projection was skipped because the surfaces are flat paint."}, "approximationNotes": ["Single isometric view. Back faces are mirrored inferences.", "Generator does not bevel boxes. Edge bevels are specified and will read sharper than 4.png until a later pass.", "TV glyphs are a wordmark card. Exact letterforms are a canvas decal, not extracted pixels.", "Dimensions follow core.coordinate-relative-units and are not manufacturing measurements."]};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wood-floor"] = createSculptMaterial(
    "wood-floor",
    {"id": "wood-floor", "name": "Floor wood", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d7a56a", "color": "#d7a56a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#d7a56a", "secondary": ["#b08756"]}, "colorVariation": {"palette": ["#d7a56a", "#b08756"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wood-floor-contact", "region": "contact edges", "roughness": 0.7000000000000001, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["wood-seam"] = createSculptMaterial(
    "wood-seam",
    {"id": "wood-seam", "name": "Floor seam", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#c49262", "color": "#c49262", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#c49262", "secondary": ["#a07750"]}, "colorVariation": {"palette": ["#c49262", "#a07750"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.62, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wood-seam-contact", "region": "contact edges", "roughness": 0.77, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["wood"] = createSculptMaterial(
    "wood",
    {"id": "wood", "name": "Furniture wood", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#c4925a", "color": "#c4925a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#c4925a", "secondary": ["#a07749"]}, "colorVariation": {"palette": ["#c4925a", "#a07749"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.5, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wood-contact", "region": "contact edges", "roughness": 0.65, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["plinth"] = createSculptMaterial(
    "plinth",
    {"id": "plinth", "name": "Exterior plinth", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#2c3444", "color": "#2c3444", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#2c3444", "secondary": ["#242a37"]}, "colorVariation": {"palette": ["#2c3444", "#242a37"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.7, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "plinth-contact", "region": "contact edges", "roughness": 0.85, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["wall-white"] = createSculptMaterial(
    "wall-white",
    {"id": "wall-white", "name": "Left wall", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f3f0ec", "color": "#f3f0ec", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f3f0ec", "secondary": ["#c7c4c1"]}, "colorVariation": {"palette": ["#f3f0ec", "#c7c4c1"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.72, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wall-white-contact", "region": "contact edges", "roughness": 0.87, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["wall-salmon"] = createSculptMaterial(
    "wall-salmon",
    {"id": "wall-salmon", "name": "Salmon wall", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e7a394", "color": "#e7a394", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#e7a394", "secondary": ["#bd8579"]}, "colorVariation": {"palette": ["#e7a394", "#bd8579"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.7, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wall-salmon-contact", "region": "contact edges", "roughness": 0.85, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["plastic-white"] = createSculptMaterial(
    "plastic-white",
    {"id": "plastic-white", "name": "White plastic", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f7f4f0", "color": "#f7f4f0", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f7f4f0", "secondary": ["#cac8c4"]}, "colorVariation": {"palette": ["#f7f4f0", "#cac8c4"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.42, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "plastic-white-contact", "region": "contact edges", "roughness": 0.57, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["plastic-black"] = createSculptMaterial(
    "plastic-black",
    {"id": "plastic-black", "name": "Black plastic", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#1a1a1a", "color": "#1a1a1a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#1a1a1a", "secondary": ["#151515"]}, "colorVariation": {"palette": ["#1a1a1a", "#151515"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "plastic-black-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["plastic-grey"] = createSculptMaterial(
    "plastic-grey",
    {"id": "plastic-grey", "name": "Grey plastic", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#8d8f97", "color": "#8d8f97", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#8d8f97", "secondary": ["#73757b"]}, "colorVariation": {"palette": ["#8d8f97", "#73757b"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.48, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "plastic-grey-contact", "region": "contact edges", "roughness": 0.63, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fabric-sofa"] = createSculptMaterial(
    "fabric-sofa",
    {"id": "fabric-sofa", "name": "Sofa fabric", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#6a6578", "color": "#6a6578", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#6a6578", "secondary": ["#565262"]}, "colorVariation": {"palette": ["#6a6578", "#565262"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.82, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fabric-sofa-contact", "region": "contact edges", "roughness": 0.97, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["chair"] = createSculptMaterial(
    "chair",
    {"id": "chair", "name": "Chair shell", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#2a2a2e", "color": "#2a2a2e", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#2a2a2e", "secondary": ["#222225"]}, "colorVariation": {"palette": ["#2a2a2e", "#222225"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.55, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "chair-contact", "region": "contact edges", "roughness": 0.7000000000000001, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["screen-warm"] = createSculptMaterial(
    "screen-warm",
    {"id": "screen-warm", "name": "Warm screen", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#ff6a1a", "color": "#ff6a1a", "emissive": "#ff6a1a", "emissiveIntensity": {"base": 2.4}, "albedo": {"dominant": "#ff6a1a", "secondary": ["#d15615"]}, "colorVariation": {"palette": ["#ff6a1a", "#d15615"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.18, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "screen-warm-contact", "region": "contact edges", "roughness": 0.32999999999999996, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["screen-dark"] = createSculptMaterial(
    "screen-dark",
    {"id": "screen-dark", "name": "TV screen", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#161616", "color": "#161616", "emissive": "#2a2a2a", "emissiveIntensity": {"base": 0.35}, "albedo": {"dominant": "#161616", "secondary": ["#121212"]}, "colorVariation": {"palette": ["#161616", "#121212"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.22, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "screen-dark-contact", "region": "contact edges", "roughness": 0.37, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["wordmark"] = createSculptMaterial(
    "wordmark",
    {"id": "wordmark", "name": "Wordmark", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f4f4f4", "color": "#f4f4f4", "emissive": "#f4f4f4", "emissiveIntensity": {"base": 0.8}, "albedo": {"dominant": "#f4f4f4", "secondary": ["#c8c8c8"]}, "colorVariation": {"palette": ["#f4f4f4", "#c8c8c8"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.3, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "wordmark-contact", "region": "contact edges", "roughness": 0.44999999999999996, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["lamp"] = createSculptMaterial(
    "lamp",
    {"id": "lamp", "name": "Lamp shade", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#fff6e8", "color": "#fff6e8", "emissive": "#fff4d8", "emissiveIntensity": {"base": 2.2}, "albedo": {"dominant": "#fff6e8", "secondary": ["#d1c9be"]}, "colorVariation": {"palette": ["#fff6e8", "#d1c9be"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.28, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "lamp-contact", "region": "contact edges", "roughness": 0.43000000000000005, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["glow-cyan"] = createSculptMaterial(
    "glow-cyan",
    {"id": "glow-cyan", "name": "Console glow", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#7ee7e1", "color": "#7ee7e1", "emissive": "#7ee7e1", "emissiveIntensity": {"base": 1.8}, "albedo": {"dominant": "#7ee7e1", "secondary": ["#67bdb8"]}, "colorVariation": {"palette": ["#7ee7e1", "#67bdb8"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.25, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "glow-cyan-contact", "region": "contact edges", "roughness": 0.4, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["leaf"] = createSculptMaterial(
    "leaf",
    {"id": "leaf", "name": "Leaf", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#3f8f55", "color": "#3f8f55", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#3f8f55", "secondary": ["#337545"]}, "colorVariation": {"palette": ["#3f8f55", "#337545"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.58, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "leaf-contact", "region": "contact edges", "roughness": 0.73, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["guitar"] = createSculptMaterial(
    "guitar",
    {"id": "guitar", "name": "Guitar body", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#5c3a28", "color": "#5c3a28", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#5c3a28", "secondary": ["#4b2f20"]}, "colorVariation": {"palette": ["#5c3a28", "#4b2f20"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.45, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "guitar-contact", "region": "contact edges", "roughness": 0.6, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["octopus"] = createSculptMaterial(
    "octopus",
    {"id": "octopus", "name": "Octopus plush", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#c9c4d4", "color": "#c9c4d4", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#c9c4d4", "secondary": ["#a4a0ad"]}, "colorVariation": {"palette": ["#c9c4d4", "#a4a0ad"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.65, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "octopus-contact", "region": "contact edges", "roughness": 0.8, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["cushion"] = createSculptMaterial(
    "cushion",
    {"id": "cushion", "name": "Floor cushion", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#efe4d4", "color": "#efe4d4", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#efe4d4", "secondary": ["#c3baad"]}, "colorVariation": {"palette": ["#efe4d4", "#c3baad"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.75, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "cushion-contact", "region": "contact edges", "roughness": 0.9, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["void"] = createSculptMaterial(
    "void",
    {"id": "void", "name": "Window void", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#050505", "color": "#050505", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#050505", "secondary": ["#040404"]}, "colorVariation": {"palette": ["#050505", "#040404"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.9, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "void-contact", "region": "contact edges", "roughness": 1.0, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-0"] = createSculptMaterial(
    "fig-0",
    {"id": "fig-0", "name": "Figurine 0", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e85d4c", "color": "#e85d4c", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#e85d4c", "secondary": ["#be4c3e"]}, "colorVariation": {"palette": ["#e85d4c", "#be4c3e"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-0-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-1"] = createSculptMaterial(
    "fig-1",
    {"id": "fig-1", "name": "Figurine 1", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f0a202", "color": "#f0a202", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f0a202", "secondary": ["#c48401"]}, "colorVariation": {"palette": ["#f0a202", "#c48401"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-1-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-2"] = createSculptMaterial(
    "fig-2",
    {"id": "fig-2", "name": "Figurine 2", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f4d35e", "color": "#f4d35e", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f4d35e", "secondary": ["#c8ad4d"]}, "colorVariation": {"palette": ["#f4d35e", "#c8ad4d"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-2-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-3"] = createSculptMaterial(
    "fig-3",
    {"id": "fig-3", "name": "Figurine 3", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#7dce82", "color": "#7dce82", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#7dce82", "secondary": ["#66a86a"]}, "colorVariation": {"palette": ["#7dce82", "#66a86a"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-3-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-4"] = createSculptMaterial(
    "fig-4",
    {"id": "fig-4", "name": "Figurine 4", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#5eb1e8", "color": "#5eb1e8", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#5eb1e8", "secondary": ["#4d91be"]}, "colorVariation": {"palette": ["#5eb1e8", "#4d91be"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-4-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-5"] = createSculptMaterial(
    "fig-5",
    {"id": "fig-5", "name": "Figurine 5", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#7a6ff0", "color": "#7a6ff0", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#7a6ff0", "secondary": ["#645bc4"]}, "colorVariation": {"palette": ["#7a6ff0", "#645bc4"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-5-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-6"] = createSculptMaterial(
    "fig-6",
    {"id": "fig-6", "name": "Figurine 6", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e86bb0", "color": "#e86bb0", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#e86bb0", "secondary": ["#be5790"]}, "colorVariation": {"palette": ["#e86bb0", "#be5790"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-6-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["fig-7"] = createSculptMaterial(
    "fig-7",
    {"id": "fig-7", "name": "Figurine 7", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f28c6b", "color": "#f28c6b", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f28c6b", "secondary": ["#c67257"]}, "colorVariation": {"palette": ["#f28c6b", "#c67257"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.4, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "fig-7-contact", "region": "contact edges", "roughness": 0.55, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-0"] = createSculptMaterial(
    "book-0",
    {"id": "book-0", "name": "Book 0", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#355c8a", "color": "#355c8a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#355c8a", "secondary": ["#2b4b71"]}, "colorVariation": {"palette": ["#355c8a", "#2b4b71"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-0-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-1"] = createSculptMaterial(
    "book-1",
    {"id": "book-1", "name": "Book 1", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#f2f2f2", "color": "#f2f2f2", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#f2f2f2", "secondary": ["#c6c6c6"]}, "colorVariation": {"palette": ["#f2f2f2", "#c6c6c6"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-1-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-2"] = createSculptMaterial(
    "book-2",
    {"id": "book-2", "name": "Book 2", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#e07a3d", "color": "#e07a3d", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#e07a3d", "secondary": ["#b76432"]}, "colorVariation": {"palette": ["#e07a3d", "#b76432"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-2-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-3"] = createSculptMaterial(
    "book-3",
    {"id": "book-3", "name": "Book 3", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#2c2c2c", "color": "#2c2c2c", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#2c2c2c", "secondary": ["#242424"]}, "colorVariation": {"palette": ["#2c2c2c", "#242424"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-3-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-4"] = createSculptMaterial(
    "book-4",
    {"id": "book-4", "name": "Book 4", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#8d4a3a", "color": "#8d4a3a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#8d4a3a", "secondary": ["#733c2f"]}, "colorVariation": {"palette": ["#8d4a3a", "#733c2f"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-4-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-5"] = createSculptMaterial(
    "book-5",
    {"id": "book-5", "name": "Book 5", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#d7c4a3", "color": "#d7c4a3", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#d7c4a3", "secondary": ["#b0a085"]}, "colorVariation": {"palette": ["#d7c4a3", "#b0a085"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-5-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-6"] = createSculptMaterial(
    "book-6",
    {"id": "book-6", "name": "Book 6", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#4d6b4a", "color": "#4d6b4a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#4d6b4a", "secondary": ["#3f573c"]}, "colorVariation": {"palette": ["#4d6b4a", "#3f573c"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-6-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );
  materialMap["book-7"] = createSculptMaterial(
    "book-7",
    {"id": "book-7", "name": "Book 7", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#c45b6a", "color": "#c45b6a", "emissive": "#000000", "emissiveIntensity": {"base": 0.0}, "albedo": {"dominant": "#c45b6a", "secondary": ["#a04a56"]}, "colorVariation": {"palette": ["#c45b6a", "#a04a56"], "pattern": "flat", "amplitude": 0.04, "heightCorrelation": 0.0}, "roughness": {"base": 0.6, "variation": 0.06}, "metalness": {"base": 0.0, "variation": 0.0}, "localOverrides": [{"id": "book-7-contact", "region": "contact edges", "roughness": 0.75, "dirtAmount": 0.06}], "textureless": {"declared": true, "evidence": ["4.png is a flat-shaded stylized diorama. Local spec core.pbr-hand-painted-vs-pbr-texture: identity is flat color, not a photographic texture. Albedo and emissive stay sRGB (core.pbr-color-space-srgb-vs-linearnocolorspace)."]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_floor_0 = makeAttachmentEndpoint(null);
  const node_floor_0 = new THREE.Group();
  node_floor_0.name = "Floor__pivot";
  node_floor_0.scale.set(1, 1, 1);
  if (endpoint_floor_0) {
    node_floor_0.position.copy(endpoint_floor_0.start);
    node_floor_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_floor_0.position.set(0.0, -0.05, 0.0);
    node_floor_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_floor_0.userData.sculptComponent = {"id": "floor", "name": "Floor", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Floor is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.72, "height": 0.1, "depth": 3.72, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.05, 0], "rotation": [0, 0, 0], "scale": [4.72, 0.1, 3.72]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-floor"}}, "material": "wood-floor", "materialLayers": ["wood-floor"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "floor-plank-grooves", "kind": "groove", "note": "plank seams run along Z"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 165, 106, 1.0)", "secondaryAlbedo": "rgba(176, 135, 86, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_floor_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-floor"}};
  (nodes["root"] ?? root).add(node_floor_0);
  nodes["floor"] = node_floor_0;
  const mesh_floor_0Geometry = endpoint_floor_0
    ? new THREE.CylinderGeometry(endpoint_floor_0.endRadius, endpoint_floor_0.baseRadius, endpoint_floor_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_floor_0) {
    mesh_floor_0Geometry.scale(4.72, 0.1, 3.72);
  }
  const mesh_floor_0 = new THREE.Mesh(
    mesh_floor_0Geometry,
    materialMap["wood-floor"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_0.name = "Floor";
  if (endpoint_floor_0) {
    mesh_floor_0.position.copy(endpoint_floor_0.midpoint);
    mesh_floor_0.quaternion.copy(endpoint_floor_0.quaternion);
  }
  mesh_floor_0.castShadow = options.castShadow ?? true;
  mesh_floor_0.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_0.userData.sculptComponent = {"id": "floor", "name": "Floor", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Floor is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.72, "height": 0.1, "depth": 3.72, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.05, 0], "rotation": [0, 0, 0], "scale": [4.72, 0.1, 3.72]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-floor"}}, "material": "wood-floor", "materialLayers": ["wood-floor"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "floor-plank-grooves", "kind": "groove", "note": "plank seams run along Z"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 165, 106, 1.0)", "secondaryAlbedo": "rgba(176, 135, 86, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_floor_0.add(mesh_floor_0);
  meshes["floor"] = mesh_floor_0;
  colliders["floor"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["floor"] ??= [];
  destructionGroups["floor"].push(node_floor_0);

  const endpoint_plinth_1 = makeAttachmentEndpoint(null);
  const node_plinth_1 = new THREE.Group();
  node_plinth_1.name = "Exterior plinth__pivot";
  node_plinth_1.scale.set(1, 1, 1);
  if (endpoint_plinth_1) {
    node_plinth_1.position.copy(endpoint_plinth_1.start);
    node_plinth_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plinth_1.position.set(0.0, -0.16, 0.0);
    node_plinth_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_plinth_1.userData.sculptComponent = {"id": "plinth", "name": "Exterior plinth", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Exterior plinth is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.95, "height": 0.12, "depth": 3.95, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.16, 0], "rotation": [0, 0, 0], "scale": [4.95, 0.12, 3.95]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plinth"}}, "material": "plinth", "materialLayers": ["plinth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 52, 68, 1.0)", "secondaryAlbedo": "rgba(36, 42, 55, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plinth_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plinth"}};
  (nodes["root"] ?? root).add(node_plinth_1);
  nodes["plinth"] = node_plinth_1;
  const mesh_plinth_1Geometry = endpoint_plinth_1
    ? new THREE.CylinderGeometry(endpoint_plinth_1.endRadius, endpoint_plinth_1.baseRadius, endpoint_plinth_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plinth_1) {
    mesh_plinth_1Geometry.scale(4.95, 0.12, 3.95);
  }
  const mesh_plinth_1 = new THREE.Mesh(
    mesh_plinth_1Geometry,
    materialMap["plinth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_1.name = "Exterior plinth";
  if (endpoint_plinth_1) {
    mesh_plinth_1.position.copy(endpoint_plinth_1.midpoint);
    mesh_plinth_1.quaternion.copy(endpoint_plinth_1.quaternion);
  }
  mesh_plinth_1.castShadow = options.castShadow ?? true;
  mesh_plinth_1.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_1.userData.sculptComponent = {"id": "plinth", "name": "Exterior plinth", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Exterior plinth is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.95, "height": 0.12, "depth": 3.95, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, -0.16, 0], "rotation": [0, 0, 0], "scale": [4.95, 0.12, 3.95]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plinth"}}, "material": "plinth", "materialLayers": ["plinth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 52, 68, 1.0)", "secondaryAlbedo": "rgba(36, 42, 55, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plinth_1.add(mesh_plinth_1);
  meshes["plinth"] = mesh_plinth_1;
  colliders["plinth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plinth"] ??= [];
  destructionGroups["plinth"].push(node_plinth_1);

  const endpoint_left_wall_2 = makeAttachmentEndpoint(null);
  const node_left_wall_2 = new THREE.Group();
  node_left_wall_2.name = "Left wall__pivot";
  node_left_wall_2.scale.set(1, 1, 1);
  if (endpoint_left_wall_2) {
    node_left_wall_2.position.copy(endpoint_left_wall_2.start);
    node_left_wall_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_left_wall_2.position.set(-2.24, 1.25, 0.0);
    node_left_wall_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_left_wall_2.userData.sculptComponent = {"id": "left-wall", "name": "Left wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Left wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 2.5, "depth": 3.56, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.24, 1.25, 0], "rotation": [0, 0, 0], "scale": [0.08, 2.5, 3.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "left-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-white"}}, "material": "wall-white", "materialLayers": ["wall-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 240, 236, 1.0)", "secondaryAlbedo": "rgba(199, 196, 193, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_left_wall_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "left-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-white"}};
  (nodes["root"] ?? root).add(node_left_wall_2);
  nodes["left-wall"] = node_left_wall_2;
  const mesh_left_wall_2Geometry = endpoint_left_wall_2
    ? new THREE.CylinderGeometry(endpoint_left_wall_2.endRadius, endpoint_left_wall_2.baseRadius, endpoint_left_wall_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_left_wall_2) {
    mesh_left_wall_2Geometry.scale(0.08, 2.5, 3.56);
  }
  const mesh_left_wall_2 = new THREE.Mesh(
    mesh_left_wall_2Geometry,
    materialMap["wall-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_left_wall_2.name = "Left wall";
  if (endpoint_left_wall_2) {
    mesh_left_wall_2.position.copy(endpoint_left_wall_2.midpoint);
    mesh_left_wall_2.quaternion.copy(endpoint_left_wall_2.quaternion);
  }
  mesh_left_wall_2.castShadow = options.castShadow ?? true;
  mesh_left_wall_2.receiveShadow = options.receiveShadow ?? true;
  mesh_left_wall_2.userData.sculptComponent = {"id": "left-wall", "name": "Left wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Left wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 2.5, "depth": 3.56, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.24, 1.25, 0], "rotation": [0, 0, 0], "scale": [0.08, 2.5, 3.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "left-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-white"}}, "material": "wall-white", "materialLayers": ["wall-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 240, 236, 1.0)", "secondaryAlbedo": "rgba(199, 196, 193, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_left_wall_2.add(mesh_left_wall_2);
  meshes["left-wall"] = mesh_left_wall_2;
  colliders["left-wall"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["left-wall"] ??= [];
  destructionGroups["left-wall"].push(node_left_wall_2);

  const endpoint_back_wall_3 = makeAttachmentEndpoint(null);
  const node_back_wall_3 = new THREE.Group();
  node_back_wall_3.name = "Back wall__pivot";
  node_back_wall_3.scale.set(1, 1, 1);
  if (endpoint_back_wall_3) {
    node_back_wall_3.position.copy(endpoint_back_wall_3.start);
    node_back_wall_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_back_wall_3.position.set(0.0, 1.25, -1.74);
    node_back_wall_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_back_wall_3.userData.sculptComponent = {"id": "back-wall", "name": "Back wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.56, "height": 2.5, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 1.25, -1.74], "rotation": [0, 0, 0], "scale": [4.56, 2.5, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}}, "material": "wall-salmon", "materialLayers": ["wall-salmon"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "window-opening", "kind": "hole", "note": "black window opening in the back wall"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 163, 148, 1.0)", "secondaryAlbedo": "rgba(189, 133, 121, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_back_wall_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}};
  (nodes["root"] ?? root).add(node_back_wall_3);
  nodes["back-wall"] = node_back_wall_3;
  const mesh_back_wall_3Geometry = endpoint_back_wall_3
    ? new THREE.CylinderGeometry(endpoint_back_wall_3.endRadius, endpoint_back_wall_3.baseRadius, endpoint_back_wall_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_back_wall_3) {
    mesh_back_wall_3Geometry.scale(4.56, 2.5, 0.08);
  }
  const mesh_back_wall_3 = new THREE.Mesh(
    mesh_back_wall_3Geometry,
    materialMap["wall-salmon"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_back_wall_3.name = "Back wall";
  if (endpoint_back_wall_3) {
    mesh_back_wall_3.position.copy(endpoint_back_wall_3.midpoint);
    mesh_back_wall_3.quaternion.copy(endpoint_back_wall_3.quaternion);
  }
  mesh_back_wall_3.castShadow = options.castShadow ?? true;
  mesh_back_wall_3.receiveShadow = options.receiveShadow ?? true;
  mesh_back_wall_3.userData.sculptComponent = {"id": "back-wall", "name": "Back wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Back wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 4.56, "height": 2.5, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [0, 1.25, -1.74], "rotation": [0, 0, 0], "scale": [4.56, 2.5, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "back-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}}, "material": "wall-salmon", "materialLayers": ["wall-salmon"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "window-opening", "kind": "hole", "note": "black window opening in the back wall"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 163, 148, 1.0)", "secondaryAlbedo": "rgba(189, 133, 121, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_back_wall_3.add(mesh_back_wall_3);
  meshes["back-wall"] = mesh_back_wall_3;
  colliders["back-wall"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["back-wall"] ??= [];
  destructionGroups["back-wall"].push(node_back_wall_3);

  const endpoint_right_wall_4 = makeAttachmentEndpoint(null);
  const node_right_wall_4 = new THREE.Group();
  node_right_wall_4.name = "Right wall__pivot";
  node_right_wall_4.scale.set(1, 1, 1);
  if (endpoint_right_wall_4) {
    node_right_wall_4.position.copy(endpoint_right_wall_4.start);
    node_right_wall_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_right_wall_4.position.set(2.24, 1.25, 0.0);
    node_right_wall_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_right_wall_4.userData.sculptComponent = {"id": "right-wall", "name": "Right wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Right wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 2.5, "depth": 3.56, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.24, 1.25, 0], "rotation": [0, 0, 0], "scale": [0.08, 2.5, 3.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "right-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}}, "material": "wall-salmon", "materialLayers": ["wall-salmon"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 163, 148, 1.0)", "secondaryAlbedo": "rgba(189, 133, 121, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_right_wall_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "right-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}};
  (nodes["root"] ?? root).add(node_right_wall_4);
  nodes["right-wall"] = node_right_wall_4;
  const mesh_right_wall_4Geometry = endpoint_right_wall_4
    ? new THREE.CylinderGeometry(endpoint_right_wall_4.endRadius, endpoint_right_wall_4.baseRadius, endpoint_right_wall_4.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_right_wall_4) {
    mesh_right_wall_4Geometry.scale(0.08, 2.5, 3.56);
  }
  const mesh_right_wall_4 = new THREE.Mesh(
    mesh_right_wall_4Geometry,
    materialMap["wall-salmon"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_right_wall_4.name = "Right wall";
  if (endpoint_right_wall_4) {
    mesh_right_wall_4.position.copy(endpoint_right_wall_4.midpoint);
    mesh_right_wall_4.quaternion.copy(endpoint_right_wall_4.quaternion);
  }
  mesh_right_wall_4.castShadow = options.castShadow ?? true;
  mesh_right_wall_4.receiveShadow = options.receiveShadow ?? true;
  mesh_right_wall_4.userData.sculptComponent = {"id": "right-wall", "name": "Right wall", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Right wall is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 2.5, "depth": 3.56, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.24, 1.25, 0], "rotation": [0, 0, 0], "scale": [0.08, 2.5, 3.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "right-wall", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-salmon"}}, "material": "wall-salmon", "materialLayers": ["wall-salmon"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 163, 148, 1.0)", "secondaryAlbedo": "rgba(189, 133, 121, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_right_wall_4.add(mesh_right_wall_4);
  meshes["right-wall"] = mesh_right_wall_4;
  colliders["right-wall"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["right-wall"] ??= [];
  destructionGroups["right-wall"].push(node_right_wall_4);

  const endpoint_plank_seam_0_5 = makeAttachmentEndpoint(null);
  const node_plank_seam_0_5 = new THREE.Group();
  node_plank_seam_0_5.name = "Plank seam 0__pivot";
  node_plank_seam_0_5.scale.set(1, 1, 1);
  if (endpoint_plank_seam_0_5) {
    node_plank_seam_0_5.position.copy(endpoint_plank_seam_0_5.start);
    node_plank_seam_0_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plank_seam_0_5.position.set(-1.6, 0.004, 0.0);
    node_plank_seam_0_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_plank_seam_0_5.userData.sculptComponent = {"id": "plank-seam-0", "name": "Plank seam 0", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.6, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_0_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}};
  (nodes["root"] ?? root).add(node_plank_seam_0_5);
  nodes["plank-seam-0"] = node_plank_seam_0_5;
  const mesh_plank_seam_0_5Geometry = endpoint_plank_seam_0_5
    ? new THREE.CylinderGeometry(endpoint_plank_seam_0_5.endRadius, endpoint_plank_seam_0_5.baseRadius, endpoint_plank_seam_0_5.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plank_seam_0_5) {
    mesh_plank_seam_0_5Geometry.scale(0.015, 0.008, 3.35);
  }
  const mesh_plank_seam_0_5 = new THREE.Mesh(
    mesh_plank_seam_0_5Geometry,
    materialMap["wood-seam"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_seam_0_5.name = "Plank seam 0";
  if (endpoint_plank_seam_0_5) {
    mesh_plank_seam_0_5.position.copy(endpoint_plank_seam_0_5.midpoint);
    mesh_plank_seam_0_5.quaternion.copy(endpoint_plank_seam_0_5.quaternion);
  }
  mesh_plank_seam_0_5.castShadow = options.castShadow ?? true;
  mesh_plank_seam_0_5.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_seam_0_5.userData.sculptComponent = {"id": "plank-seam-0", "name": "Plank seam 0", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.6, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_0_5.add(mesh_plank_seam_0_5);
  meshes["plank-seam-0"] = mesh_plank_seam_0_5;
  colliders["plank-seam-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plank-seam-0"] ??= [];
  destructionGroups["plank-seam-0"].push(node_plank_seam_0_5);

  const endpoint_plank_seam_1_6 = makeAttachmentEndpoint(null);
  const node_plank_seam_1_6 = new THREE.Group();
  node_plank_seam_1_6.name = "Plank seam 1__pivot";
  node_plank_seam_1_6.scale.set(1, 1, 1);
  if (endpoint_plank_seam_1_6) {
    node_plank_seam_1_6.position.copy(endpoint_plank_seam_1_6.start);
    node_plank_seam_1_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plank_seam_1_6.position.set(-0.8, 0.004, 0.0);
    node_plank_seam_1_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_plank_seam_1_6.userData.sculptComponent = {"id": "plank-seam-1", "name": "Plank seam 1", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_1_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}};
  (nodes["root"] ?? root).add(node_plank_seam_1_6);
  nodes["plank-seam-1"] = node_plank_seam_1_6;
  const mesh_plank_seam_1_6Geometry = endpoint_plank_seam_1_6
    ? new THREE.CylinderGeometry(endpoint_plank_seam_1_6.endRadius, endpoint_plank_seam_1_6.baseRadius, endpoint_plank_seam_1_6.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plank_seam_1_6) {
    mesh_plank_seam_1_6Geometry.scale(0.015, 0.008, 3.35);
  }
  const mesh_plank_seam_1_6 = new THREE.Mesh(
    mesh_plank_seam_1_6Geometry,
    materialMap["wood-seam"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_seam_1_6.name = "Plank seam 1";
  if (endpoint_plank_seam_1_6) {
    mesh_plank_seam_1_6.position.copy(endpoint_plank_seam_1_6.midpoint);
    mesh_plank_seam_1_6.quaternion.copy(endpoint_plank_seam_1_6.quaternion);
  }
  mesh_plank_seam_1_6.castShadow = options.castShadow ?? true;
  mesh_plank_seam_1_6.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_seam_1_6.userData.sculptComponent = {"id": "plank-seam-1", "name": "Plank seam 1", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_1_6.add(mesh_plank_seam_1_6);
  meshes["plank-seam-1"] = mesh_plank_seam_1_6;
  colliders["plank-seam-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plank-seam-1"] ??= [];
  destructionGroups["plank-seam-1"].push(node_plank_seam_1_6);

  const endpoint_plank_seam_2_7 = makeAttachmentEndpoint(null);
  const node_plank_seam_2_7 = new THREE.Group();
  node_plank_seam_2_7.name = "Plank seam 2__pivot";
  node_plank_seam_2_7.scale.set(1, 1, 1);
  if (endpoint_plank_seam_2_7) {
    node_plank_seam_2_7.position.copy(endpoint_plank_seam_2_7.start);
    node_plank_seam_2_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plank_seam_2_7.position.set(0.0, 0.004, 0.0);
    node_plank_seam_2_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_plank_seam_2_7.userData.sculptComponent = {"id": "plank-seam-2", "name": "Plank seam 2", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.0, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_2_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}};
  (nodes["root"] ?? root).add(node_plank_seam_2_7);
  nodes["plank-seam-2"] = node_plank_seam_2_7;
  const mesh_plank_seam_2_7Geometry = endpoint_plank_seam_2_7
    ? new THREE.CylinderGeometry(endpoint_plank_seam_2_7.endRadius, endpoint_plank_seam_2_7.baseRadius, endpoint_plank_seam_2_7.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plank_seam_2_7) {
    mesh_plank_seam_2_7Geometry.scale(0.015, 0.008, 3.35);
  }
  const mesh_plank_seam_2_7 = new THREE.Mesh(
    mesh_plank_seam_2_7Geometry,
    materialMap["wood-seam"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_seam_2_7.name = "Plank seam 2";
  if (endpoint_plank_seam_2_7) {
    mesh_plank_seam_2_7.position.copy(endpoint_plank_seam_2_7.midpoint);
    mesh_plank_seam_2_7.quaternion.copy(endpoint_plank_seam_2_7.quaternion);
  }
  mesh_plank_seam_2_7.castShadow = options.castShadow ?? true;
  mesh_plank_seam_2_7.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_seam_2_7.userData.sculptComponent = {"id": "plank-seam-2", "name": "Plank seam 2", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.0, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_2_7.add(mesh_plank_seam_2_7);
  meshes["plank-seam-2"] = mesh_plank_seam_2_7;
  colliders["plank-seam-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plank-seam-2"] ??= [];
  destructionGroups["plank-seam-2"].push(node_plank_seam_2_7);

  const endpoint_plank_seam_3_8 = makeAttachmentEndpoint(null);
  const node_plank_seam_3_8 = new THREE.Group();
  node_plank_seam_3_8.name = "Plank seam 3__pivot";
  node_plank_seam_3_8.scale.set(1, 1, 1);
  if (endpoint_plank_seam_3_8) {
    node_plank_seam_3_8.position.copy(endpoint_plank_seam_3_8.start);
    node_plank_seam_3_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plank_seam_3_8.position.set(0.8, 0.004, 0.0);
    node_plank_seam_3_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_plank_seam_3_8.userData.sculptComponent = {"id": "plank-seam-3", "name": "Plank seam 3", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.8, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_3_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}};
  (nodes["root"] ?? root).add(node_plank_seam_3_8);
  nodes["plank-seam-3"] = node_plank_seam_3_8;
  const mesh_plank_seam_3_8Geometry = endpoint_plank_seam_3_8
    ? new THREE.CylinderGeometry(endpoint_plank_seam_3_8.endRadius, endpoint_plank_seam_3_8.baseRadius, endpoint_plank_seam_3_8.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plank_seam_3_8) {
    mesh_plank_seam_3_8Geometry.scale(0.015, 0.008, 3.35);
  }
  const mesh_plank_seam_3_8 = new THREE.Mesh(
    mesh_plank_seam_3_8Geometry,
    materialMap["wood-seam"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_seam_3_8.name = "Plank seam 3";
  if (endpoint_plank_seam_3_8) {
    mesh_plank_seam_3_8.position.copy(endpoint_plank_seam_3_8.midpoint);
    mesh_plank_seam_3_8.quaternion.copy(endpoint_plank_seam_3_8.quaternion);
  }
  mesh_plank_seam_3_8.castShadow = options.castShadow ?? true;
  mesh_plank_seam_3_8.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_seam_3_8.userData.sculptComponent = {"id": "plank-seam-3", "name": "Plank seam 3", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.8, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_3_8.add(mesh_plank_seam_3_8);
  meshes["plank-seam-3"] = mesh_plank_seam_3_8;
  colliders["plank-seam-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plank-seam-3"] ??= [];
  destructionGroups["plank-seam-3"].push(node_plank_seam_3_8);

  const endpoint_plank_seam_4_9 = makeAttachmentEndpoint(null);
  const node_plank_seam_4_9 = new THREE.Group();
  node_plank_seam_4_9.name = "Plank seam 4__pivot";
  node_plank_seam_4_9.scale.set(1, 1, 1);
  if (endpoint_plank_seam_4_9) {
    node_plank_seam_4_9.position.copy(endpoint_plank_seam_4_9.start);
    node_plank_seam_4_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_plank_seam_4_9.position.set(1.6, 0.004, 0.0);
    node_plank_seam_4_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_plank_seam_4_9.userData.sculptComponent = {"id": "plank-seam-4", "name": "Plank seam 4", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_4_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}};
  (nodes["root"] ?? root).add(node_plank_seam_4_9);
  nodes["plank-seam-4"] = node_plank_seam_4_9;
  const mesh_plank_seam_4_9Geometry = endpoint_plank_seam_4_9
    ? new THREE.CylinderGeometry(endpoint_plank_seam_4_9.endRadius, endpoint_plank_seam_4_9.baseRadius, endpoint_plank_seam_4_9.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plank_seam_4_9) {
    mesh_plank_seam_4_9Geometry.scale(0.015, 0.008, 3.35);
  }
  const mesh_plank_seam_4_9 = new THREE.Mesh(
    mesh_plank_seam_4_9Geometry,
    materialMap["wood-seam"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plank_seam_4_9.name = "Plank seam 4";
  if (endpoint_plank_seam_4_9) {
    mesh_plank_seam_4_9.position.copy(endpoint_plank_seam_4_9.midpoint);
    mesh_plank_seam_4_9.quaternion.copy(endpoint_plank_seam_4_9.quaternion);
  }
  mesh_plank_seam_4_9.castShadow = options.castShadow ?? true;
  mesh_plank_seam_4_9.receiveShadow = options.receiveShadow ?? true;
  mesh_plank_seam_4_9.userData.sculptComponent = {"id": "plank-seam-4", "name": "Plank seam 4", "level": "macro", "role": "seam", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plank seam 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.015, "height": 0.008, "depth": 3.35, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.6, 0.004, 0], "rotation": [0, 0, 0], "scale": [0.015, 0.008, 3.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "plank-seam-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood-seam"}}, "material": "wood-seam", "materialLayers": ["wood-seam"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 98, 1.0)", "secondaryAlbedo": "rgba(160, 119, 80, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_plank_seam_4_9.add(mesh_plank_seam_4_9);
  meshes["plank-seam-4"] = mesh_plank_seam_4_9;
  colliders["plank-seam-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["plank-seam-4"] ??= [];
  destructionGroups["plank-seam-4"].push(node_plank_seam_4_9);

  const endpoint_shelf_post_0_10 = makeAttachmentEndpoint(null);
  const node_shelf_post_0_10 = new THREE.Group();
  node_shelf_post_0_10.name = "Shelf post 0__pivot";
  node_shelf_post_0_10.scale.set(1, 1, 1);
  if (endpoint_shelf_post_0_10) {
    node_shelf_post_0_10.position.copy(endpoint_shelf_post_0_10.start);
    node_shelf_post_0_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_post_0_10.position.set(-2.12, 1.08, -0.1);
    node_shelf_post_0_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_post_0_10.userData.sculptComponent = {"id": "shelf-post-0", "name": "Shelf post 0", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.12, 1.08, -0.1], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_0_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_post_0_10);
  nodes["shelf-post-0"] = node_shelf_post_0_10;
  const mesh_shelf_post_0_10Geometry = endpoint_shelf_post_0_10
    ? new THREE.CylinderGeometry(endpoint_shelf_post_0_10.endRadius, endpoint_shelf_post_0_10.baseRadius, endpoint_shelf_post_0_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_post_0_10) {
    mesh_shelf_post_0_10Geometry.scale(0.06, 2.12, 0.06);
  }
  const mesh_shelf_post_0_10 = new THREE.Mesh(
    mesh_shelf_post_0_10Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_post_0_10.name = "Shelf post 0";
  if (endpoint_shelf_post_0_10) {
    mesh_shelf_post_0_10.position.copy(endpoint_shelf_post_0_10.midpoint);
    mesh_shelf_post_0_10.quaternion.copy(endpoint_shelf_post_0_10.quaternion);
  }
  mesh_shelf_post_0_10.castShadow = options.castShadow ?? true;
  mesh_shelf_post_0_10.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_post_0_10.userData.sculptComponent = {"id": "shelf-post-0", "name": "Shelf post 0", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.12, 1.08, -0.1], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_0_10.add(mesh_shelf_post_0_10);
  meshes["shelf-post-0"] = mesh_shelf_post_0_10;
  colliders["shelf-post-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-post-0"] ??= [];
  destructionGroups["shelf-post-0"].push(node_shelf_post_0_10);

  const endpoint_shelf_post_1_11 = makeAttachmentEndpoint(null);
  const node_shelf_post_1_11 = new THREE.Group();
  node_shelf_post_1_11.name = "Shelf post 1__pivot";
  node_shelf_post_1_11.scale.set(1, 1, 1);
  if (endpoint_shelf_post_1_11) {
    node_shelf_post_1_11.position.copy(endpoint_shelf_post_1_11.start);
    node_shelf_post_1_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_post_1_11.position.set(-2.12, 1.08, 0.8);
    node_shelf_post_1_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_post_1_11.userData.sculptComponent = {"id": "shelf-post-1", "name": "Shelf post 1", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.12, 1.08, 0.8], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_1_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_post_1_11);
  nodes["shelf-post-1"] = node_shelf_post_1_11;
  const mesh_shelf_post_1_11Geometry = endpoint_shelf_post_1_11
    ? new THREE.CylinderGeometry(endpoint_shelf_post_1_11.endRadius, endpoint_shelf_post_1_11.baseRadius, endpoint_shelf_post_1_11.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_post_1_11) {
    mesh_shelf_post_1_11Geometry.scale(0.06, 2.12, 0.06);
  }
  const mesh_shelf_post_1_11 = new THREE.Mesh(
    mesh_shelf_post_1_11Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_post_1_11.name = "Shelf post 1";
  if (endpoint_shelf_post_1_11) {
    mesh_shelf_post_1_11.position.copy(endpoint_shelf_post_1_11.midpoint);
    mesh_shelf_post_1_11.quaternion.copy(endpoint_shelf_post_1_11.quaternion);
  }
  mesh_shelf_post_1_11.castShadow = options.castShadow ?? true;
  mesh_shelf_post_1_11.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_post_1_11.userData.sculptComponent = {"id": "shelf-post-1", "name": "Shelf post 1", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.12, 1.08, 0.8], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_1_11.add(mesh_shelf_post_1_11);
  meshes["shelf-post-1"] = mesh_shelf_post_1_11;
  colliders["shelf-post-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-post-1"] ??= [];
  destructionGroups["shelf-post-1"].push(node_shelf_post_1_11);

  const endpoint_shelf_post_2_12 = makeAttachmentEndpoint(null);
  const node_shelf_post_2_12 = new THREE.Group();
  node_shelf_post_2_12.name = "Shelf post 2__pivot";
  node_shelf_post_2_12.scale.set(1, 1, 1);
  if (endpoint_shelf_post_2_12) {
    node_shelf_post_2_12.position.copy(endpoint_shelf_post_2_12.start);
    node_shelf_post_2_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_post_2_12.position.set(-1.76, 1.08, -0.1);
    node_shelf_post_2_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_post_2_12.userData.sculptComponent = {"id": "shelf-post-2", "name": "Shelf post 2", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.76, 1.08, -0.1], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_2_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_post_2_12);
  nodes["shelf-post-2"] = node_shelf_post_2_12;
  const mesh_shelf_post_2_12Geometry = endpoint_shelf_post_2_12
    ? new THREE.CylinderGeometry(endpoint_shelf_post_2_12.endRadius, endpoint_shelf_post_2_12.baseRadius, endpoint_shelf_post_2_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_post_2_12) {
    mesh_shelf_post_2_12Geometry.scale(0.06, 2.12, 0.06);
  }
  const mesh_shelf_post_2_12 = new THREE.Mesh(
    mesh_shelf_post_2_12Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_post_2_12.name = "Shelf post 2";
  if (endpoint_shelf_post_2_12) {
    mesh_shelf_post_2_12.position.copy(endpoint_shelf_post_2_12.midpoint);
    mesh_shelf_post_2_12.quaternion.copy(endpoint_shelf_post_2_12.quaternion);
  }
  mesh_shelf_post_2_12.castShadow = options.castShadow ?? true;
  mesh_shelf_post_2_12.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_post_2_12.userData.sculptComponent = {"id": "shelf-post-2", "name": "Shelf post 2", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.76, 1.08, -0.1], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_2_12.add(mesh_shelf_post_2_12);
  meshes["shelf-post-2"] = mesh_shelf_post_2_12;
  colliders["shelf-post-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-post-2"] ??= [];
  destructionGroups["shelf-post-2"].push(node_shelf_post_2_12);

  const endpoint_shelf_post_3_13 = makeAttachmentEndpoint(null);
  const node_shelf_post_3_13 = new THREE.Group();
  node_shelf_post_3_13.name = "Shelf post 3__pivot";
  node_shelf_post_3_13.scale.set(1, 1, 1);
  if (endpoint_shelf_post_3_13) {
    node_shelf_post_3_13.position.copy(endpoint_shelf_post_3_13.start);
    node_shelf_post_3_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_post_3_13.position.set(-1.76, 1.08, 0.8);
    node_shelf_post_3_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_post_3_13.userData.sculptComponent = {"id": "shelf-post-3", "name": "Shelf post 3", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.76, 1.08, 0.8], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_3_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_post_3_13);
  nodes["shelf-post-3"] = node_shelf_post_3_13;
  const mesh_shelf_post_3_13Geometry = endpoint_shelf_post_3_13
    ? new THREE.CylinderGeometry(endpoint_shelf_post_3_13.endRadius, endpoint_shelf_post_3_13.baseRadius, endpoint_shelf_post_3_13.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_post_3_13) {
    mesh_shelf_post_3_13Geometry.scale(0.06, 2.12, 0.06);
  }
  const mesh_shelf_post_3_13 = new THREE.Mesh(
    mesh_shelf_post_3_13Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_post_3_13.name = "Shelf post 3";
  if (endpoint_shelf_post_3_13) {
    mesh_shelf_post_3_13.position.copy(endpoint_shelf_post_3_13.midpoint);
    mesh_shelf_post_3_13.quaternion.copy(endpoint_shelf_post_3_13.quaternion);
  }
  mesh_shelf_post_3_13.castShadow = options.castShadow ?? true;
  mesh_shelf_post_3_13.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_post_3_13.userData.sculptComponent = {"id": "shelf-post-3", "name": "Shelf post 3", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf post 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 2.12, "depth": 0.06, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.76, 1.08, 0.8], "rotation": [0, 0, 0], "scale": [0.06, 2.12, 0.06]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-post-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_post_3_13.add(mesh_shelf_post_3_13);
  meshes["shelf-post-3"] = mesh_shelf_post_3_13;
  colliders["shelf-post-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-post-3"] ??= [];
  destructionGroups["shelf-post-3"].push(node_shelf_post_3_13);

  const endpoint_shelf_board_0_14 = makeAttachmentEndpoint(null);
  const node_shelf_board_0_14 = new THREE.Group();
  node_shelf_board_0_14.name = "Shelf board 0__pivot";
  node_shelf_board_0_14.scale.set(1, 1, 1);
  if (endpoint_shelf_board_0_14) {
    node_shelf_board_0_14.position.copy(endpoint_shelf_board_0_14.start);
    node_shelf_board_0_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_board_0_14.position.set(-1.94, 0.08, 0.35);
    node_shelf_board_0_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_board_0_14.userData.sculptComponent = {"id": "shelf-board-0", "name": "Shelf board 0", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.08, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_0_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_board_0_14);
  nodes["shelf-board-0"] = node_shelf_board_0_14;
  const mesh_shelf_board_0_14Geometry = endpoint_shelf_board_0_14
    ? new THREE.CylinderGeometry(endpoint_shelf_board_0_14.endRadius, endpoint_shelf_board_0_14.baseRadius, endpoint_shelf_board_0_14.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_board_0_14) {
    mesh_shelf_board_0_14Geometry.scale(0.42, 0.04, 0.96);
  }
  const mesh_shelf_board_0_14 = new THREE.Mesh(
    mesh_shelf_board_0_14Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_board_0_14.name = "Shelf board 0";
  if (endpoint_shelf_board_0_14) {
    mesh_shelf_board_0_14.position.copy(endpoint_shelf_board_0_14.midpoint);
    mesh_shelf_board_0_14.quaternion.copy(endpoint_shelf_board_0_14.quaternion);
  }
  mesh_shelf_board_0_14.castShadow = options.castShadow ?? true;
  mesh_shelf_board_0_14.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_board_0_14.userData.sculptComponent = {"id": "shelf-board-0", "name": "Shelf board 0", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.08, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_0_14.add(mesh_shelf_board_0_14);
  meshes["shelf-board-0"] = mesh_shelf_board_0_14;
  colliders["shelf-board-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-board-0"] ??= [];
  destructionGroups["shelf-board-0"].push(node_shelf_board_0_14);

  const endpoint_shelf_board_1_15 = makeAttachmentEndpoint(null);
  const node_shelf_board_1_15 = new THREE.Group();
  node_shelf_board_1_15.name = "Shelf board 1__pivot";
  node_shelf_board_1_15.scale.set(1, 1, 1);
  if (endpoint_shelf_board_1_15) {
    node_shelf_board_1_15.position.copy(endpoint_shelf_board_1_15.start);
    node_shelf_board_1_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_board_1_15.position.set(-1.94, 0.55, 0.35);
    node_shelf_board_1_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_board_1_15.userData.sculptComponent = {"id": "shelf-board-1", "name": "Shelf board 1", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.55, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_1_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_board_1_15);
  nodes["shelf-board-1"] = node_shelf_board_1_15;
  const mesh_shelf_board_1_15Geometry = endpoint_shelf_board_1_15
    ? new THREE.CylinderGeometry(endpoint_shelf_board_1_15.endRadius, endpoint_shelf_board_1_15.baseRadius, endpoint_shelf_board_1_15.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_board_1_15) {
    mesh_shelf_board_1_15Geometry.scale(0.42, 0.04, 0.96);
  }
  const mesh_shelf_board_1_15 = new THREE.Mesh(
    mesh_shelf_board_1_15Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_board_1_15.name = "Shelf board 1";
  if (endpoint_shelf_board_1_15) {
    mesh_shelf_board_1_15.position.copy(endpoint_shelf_board_1_15.midpoint);
    mesh_shelf_board_1_15.quaternion.copy(endpoint_shelf_board_1_15.quaternion);
  }
  mesh_shelf_board_1_15.castShadow = options.castShadow ?? true;
  mesh_shelf_board_1_15.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_board_1_15.userData.sculptComponent = {"id": "shelf-board-1", "name": "Shelf board 1", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.55, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_1_15.add(mesh_shelf_board_1_15);
  meshes["shelf-board-1"] = mesh_shelf_board_1_15;
  colliders["shelf-board-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-board-1"] ??= [];
  destructionGroups["shelf-board-1"].push(node_shelf_board_1_15);

  const endpoint_shelf_board_2_16 = makeAttachmentEndpoint(null);
  const node_shelf_board_2_16 = new THREE.Group();
  node_shelf_board_2_16.name = "Shelf board 2__pivot";
  node_shelf_board_2_16.scale.set(1, 1, 1);
  if (endpoint_shelf_board_2_16) {
    node_shelf_board_2_16.position.copy(endpoint_shelf_board_2_16.start);
    node_shelf_board_2_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_board_2_16.position.set(-1.94, 1.15, 0.35);
    node_shelf_board_2_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_board_2_16.userData.sculptComponent = {"id": "shelf-board-2", "name": "Shelf board 2", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 1.15, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_2_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_board_2_16);
  nodes["shelf-board-2"] = node_shelf_board_2_16;
  const mesh_shelf_board_2_16Geometry = endpoint_shelf_board_2_16
    ? new THREE.CylinderGeometry(endpoint_shelf_board_2_16.endRadius, endpoint_shelf_board_2_16.baseRadius, endpoint_shelf_board_2_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_board_2_16) {
    mesh_shelf_board_2_16Geometry.scale(0.42, 0.04, 0.96);
  }
  const mesh_shelf_board_2_16 = new THREE.Mesh(
    mesh_shelf_board_2_16Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_board_2_16.name = "Shelf board 2";
  if (endpoint_shelf_board_2_16) {
    mesh_shelf_board_2_16.position.copy(endpoint_shelf_board_2_16.midpoint);
    mesh_shelf_board_2_16.quaternion.copy(endpoint_shelf_board_2_16.quaternion);
  }
  mesh_shelf_board_2_16.castShadow = options.castShadow ?? true;
  mesh_shelf_board_2_16.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_board_2_16.userData.sculptComponent = {"id": "shelf-board-2", "name": "Shelf board 2", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 1.15, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_2_16.add(mesh_shelf_board_2_16);
  meshes["shelf-board-2"] = mesh_shelf_board_2_16;
  colliders["shelf-board-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-board-2"] ??= [];
  destructionGroups["shelf-board-2"].push(node_shelf_board_2_16);

  const endpoint_shelf_board_3_17 = makeAttachmentEndpoint(null);
  const node_shelf_board_3_17 = new THREE.Group();
  node_shelf_board_3_17.name = "Shelf board 3__pivot";
  node_shelf_board_3_17.scale.set(1, 1, 1);
  if (endpoint_shelf_board_3_17) {
    node_shelf_board_3_17.position.copy(endpoint_shelf_board_3_17.start);
    node_shelf_board_3_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_board_3_17.position.set(-1.94, 1.7, 0.35);
    node_shelf_board_3_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_board_3_17.userData.sculptComponent = {"id": "shelf-board-3", "name": "Shelf board 3", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 1.7, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_3_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_board_3_17);
  nodes["shelf-board-3"] = node_shelf_board_3_17;
  const mesh_shelf_board_3_17Geometry = endpoint_shelf_board_3_17
    ? new THREE.CylinderGeometry(endpoint_shelf_board_3_17.endRadius, endpoint_shelf_board_3_17.baseRadius, endpoint_shelf_board_3_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_board_3_17) {
    mesh_shelf_board_3_17Geometry.scale(0.42, 0.04, 0.96);
  }
  const mesh_shelf_board_3_17 = new THREE.Mesh(
    mesh_shelf_board_3_17Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_board_3_17.name = "Shelf board 3";
  if (endpoint_shelf_board_3_17) {
    mesh_shelf_board_3_17.position.copy(endpoint_shelf_board_3_17.midpoint);
    mesh_shelf_board_3_17.quaternion.copy(endpoint_shelf_board_3_17.quaternion);
  }
  mesh_shelf_board_3_17.castShadow = options.castShadow ?? true;
  mesh_shelf_board_3_17.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_board_3_17.userData.sculptComponent = {"id": "shelf-board-3", "name": "Shelf board 3", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 1.7, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_3_17.add(mesh_shelf_board_3_17);
  meshes["shelf-board-3"] = mesh_shelf_board_3_17;
  colliders["shelf-board-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-board-3"] ??= [];
  destructionGroups["shelf-board-3"].push(node_shelf_board_3_17);

  const endpoint_shelf_board_4_18 = makeAttachmentEndpoint(null);
  const node_shelf_board_4_18 = new THREE.Group();
  node_shelf_board_4_18.name = "Shelf board 4__pivot";
  node_shelf_board_4_18.scale.set(1, 1, 1);
  if (endpoint_shelf_board_4_18) {
    node_shelf_board_4_18.position.copy(endpoint_shelf_board_4_18.start);
    node_shelf_board_4_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_board_4_18.position.set(-1.94, 2.12, 0.35);
    node_shelf_board_4_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_board_4_18.userData.sculptComponent = {"id": "shelf-board-4", "name": "Shelf board 4", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 2.12, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shelf-board-bevel", "kind": "bevel", "note": "light catches the board front edge"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_4_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_shelf_board_4_18);
  nodes["shelf-board-4"] = node_shelf_board_4_18;
  const mesh_shelf_board_4_18Geometry = endpoint_shelf_board_4_18
    ? new THREE.CylinderGeometry(endpoint_shelf_board_4_18.endRadius, endpoint_shelf_board_4_18.baseRadius, endpoint_shelf_board_4_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_board_4_18) {
    mesh_shelf_board_4_18Geometry.scale(0.42, 0.04, 0.96);
  }
  const mesh_shelf_board_4_18 = new THREE.Mesh(
    mesh_shelf_board_4_18Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_board_4_18.name = "Shelf board 4";
  if (endpoint_shelf_board_4_18) {
    mesh_shelf_board_4_18.position.copy(endpoint_shelf_board_4_18.midpoint);
    mesh_shelf_board_4_18.quaternion.copy(endpoint_shelf_board_4_18.quaternion);
  }
  mesh_shelf_board_4_18.castShadow = options.castShadow ?? true;
  mesh_shelf_board_4_18.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_board_4_18.userData.sculptComponent = {"id": "shelf-board-4", "name": "Shelf board 4", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf board 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.04, "depth": 0.96, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 2.12, 0.35], "rotation": [0, 0, 0], "scale": [0.42, 0.04, 0.96]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-board-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shelf-board-bevel", "kind": "bevel", "note": "light catches the board front edge"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_board_4_18.add(mesh_shelf_board_4_18);
  meshes["shelf-board-4"] = mesh_shelf_board_4_18;
  colliders["shelf-board-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-board-4"] ??= [];
  destructionGroups["shelf-board-4"].push(node_shelf_board_4_18);

  const endpoint_shelf_cabinet_19 = makeAttachmentEndpoint(null);
  const node_shelf_cabinet_19 = new THREE.Group();
  node_shelf_cabinet_19.name = "Shelf cabinet__pivot";
  node_shelf_cabinet_19.scale.set(1, 1, 1);
  if (endpoint_shelf_cabinet_19) {
    node_shelf_cabinet_19.position.copy(endpoint_shelf_cabinet_19.start);
    node_shelf_cabinet_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shelf_cabinet_19.position.set(-1.94, 0.85, 0.35);
    node_shelf_cabinet_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_shelf_cabinet_19.userData.sculptComponent = {"id": "shelf-cabinet", "name": "Shelf cabinet", "level": "macro", "role": "cabinet", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf cabinet is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.46, "depth": 0.82, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.85, 0.35], "rotation": [0, 0, 0], "scale": [0.36, 0.46, 0.82]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cabinet-door-seam", "kind": "seam", "note": "vertical split on the white cabinet"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_cabinet_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_shelf_cabinet_19);
  nodes["shelf-cabinet"] = node_shelf_cabinet_19;
  const mesh_shelf_cabinet_19Geometry = endpoint_shelf_cabinet_19
    ? new THREE.CylinderGeometry(endpoint_shelf_cabinet_19.endRadius, endpoint_shelf_cabinet_19.baseRadius, endpoint_shelf_cabinet_19.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_shelf_cabinet_19) {
    mesh_shelf_cabinet_19Geometry.scale(0.36, 0.46, 0.82);
  }
  const mesh_shelf_cabinet_19 = new THREE.Mesh(
    mesh_shelf_cabinet_19Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shelf_cabinet_19.name = "Shelf cabinet";
  if (endpoint_shelf_cabinet_19) {
    mesh_shelf_cabinet_19.position.copy(endpoint_shelf_cabinet_19.midpoint);
    mesh_shelf_cabinet_19.quaternion.copy(endpoint_shelf_cabinet_19.quaternion);
  }
  mesh_shelf_cabinet_19.castShadow = options.castShadow ?? true;
  mesh_shelf_cabinet_19.receiveShadow = options.receiveShadow ?? true;
  mesh_shelf_cabinet_19.userData.sculptComponent = {"id": "shelf-cabinet", "name": "Shelf cabinet", "level": "macro", "role": "cabinet", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Shelf cabinet is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.46, "depth": 0.82, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.94, 0.85, 0.35], "rotation": [0, 0, 0], "scale": [0.36, 0.46, 0.82]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shelf-cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cabinet-door-seam", "kind": "seam", "note": "vertical split on the white cabinet"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_shelf_cabinet_19.add(mesh_shelf_cabinet_19);
  meshes["shelf-cabinet"] = mesh_shelf_cabinet_19;
  colliders["shelf-cabinet"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["shelf-cabinet"] ??= [];
  destructionGroups["shelf-cabinet"].push(node_shelf_cabinet_19);

  const endpoint_book_top_0_20 = makeAttachmentEndpoint(null);
  const node_book_top_0_20 = new THREE.Group();
  node_book_top_0_20.name = "Top book 0__pivot";
  node_book_top_0_20.scale.set(1, 1, 1);
  if (endpoint_book_top_0_20) {
    node_book_top_0_20.position.copy(endpoint_book_top_0_20.start);
    node_book_top_0_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_0_20.position.set(-1.9, 1.88, -0.28);
    node_book_top_0_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_0_20.userData.sculptComponent = {"id": "book-top-0", "name": "Top book 0", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, -0.28], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}}, "material": "book-0", "materialLayers": ["book-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(53, 92, 138, 1.0)", "secondaryAlbedo": "rgba(43, 75, 113, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_0_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}};
  (nodes["root"] ?? root).add(node_book_top_0_20);
  nodes["book-top-0"] = node_book_top_0_20;
  const mesh_book_top_0_20Geometry = endpoint_book_top_0_20
    ? new THREE.CylinderGeometry(endpoint_book_top_0_20.endRadius, endpoint_book_top_0_20.baseRadius, endpoint_book_top_0_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_0_20) {
    mesh_book_top_0_20Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_0_20 = new THREE.Mesh(
    mesh_book_top_0_20Geometry,
    materialMap["book-0"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_0_20.name = "Top book 0";
  if (endpoint_book_top_0_20) {
    mesh_book_top_0_20.position.copy(endpoint_book_top_0_20.midpoint);
    mesh_book_top_0_20.quaternion.copy(endpoint_book_top_0_20.quaternion);
  }
  mesh_book_top_0_20.castShadow = options.castShadow ?? true;
  mesh_book_top_0_20.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_0_20.userData.sculptComponent = {"id": "book-top-0", "name": "Top book 0", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, -0.28], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}}, "material": "book-0", "materialLayers": ["book-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(53, 92, 138, 1.0)", "secondaryAlbedo": "rgba(43, 75, 113, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_0_20.add(mesh_book_top_0_20);
  meshes["book-top-0"] = mesh_book_top_0_20;
  colliders["book-top-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-0"] ??= [];
  destructionGroups["book-top-0"].push(node_book_top_0_20);

  const endpoint_book_low_0_21 = makeAttachmentEndpoint(null);
  const node_book_low_0_21 = new THREE.Group();
  node_book_low_0_21.name = "Low book 0__pivot";
  node_book_low_0_21.scale.set(1, 1, 1);
  if (endpoint_book_low_0_21) {
    node_book_low_0_21.position.copy(endpoint_book_low_0_21.start);
    node_book_low_0_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_0_21.position.set(-1.9, 0.26, -0.28);
    node_book_low_0_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_0_21.userData.sculptComponent = {"id": "book-low-0", "name": "Low book 0", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, -0.28], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}}, "material": "book-3", "materialLayers": ["book-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 44, 44, 1.0)", "secondaryAlbedo": "rgba(36, 36, 36, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_0_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}};
  (nodes["root"] ?? root).add(node_book_low_0_21);
  nodes["book-low-0"] = node_book_low_0_21;
  const mesh_book_low_0_21Geometry = endpoint_book_low_0_21
    ? new THREE.CylinderGeometry(endpoint_book_low_0_21.endRadius, endpoint_book_low_0_21.baseRadius, endpoint_book_low_0_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_0_21) {
    mesh_book_low_0_21Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_0_21 = new THREE.Mesh(
    mesh_book_low_0_21Geometry,
    materialMap["book-3"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_0_21.name = "Low book 0";
  if (endpoint_book_low_0_21) {
    mesh_book_low_0_21.position.copy(endpoint_book_low_0_21.midpoint);
    mesh_book_low_0_21.quaternion.copy(endpoint_book_low_0_21.quaternion);
  }
  mesh_book_low_0_21.castShadow = options.castShadow ?? true;
  mesh_book_low_0_21.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_0_21.userData.sculptComponent = {"id": "book-low-0", "name": "Low book 0", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, -0.28], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}}, "material": "book-3", "materialLayers": ["book-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 44, 44, 1.0)", "secondaryAlbedo": "rgba(36, 36, 36, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_0_21.add(mesh_book_low_0_21);
  meshes["book-low-0"] = mesh_book_low_0_21;
  colliders["book-low-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-0"] ??= [];
  destructionGroups["book-low-0"].push(node_book_low_0_21);

  const endpoint_book_top_1_22 = makeAttachmentEndpoint(null);
  const node_book_top_1_22 = new THREE.Group();
  node_book_top_1_22.name = "Top book 1__pivot";
  node_book_top_1_22.scale.set(1, 1, 1);
  if (endpoint_book_top_1_22) {
    node_book_top_1_22.position.copy(endpoint_book_top_1_22.start);
    node_book_top_1_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_1_22.position.set(-1.9, 1.88, -0.12);
    node_book_top_1_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_1_22.userData.sculptComponent = {"id": "book-top-1", "name": "Top book 1", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, -0.12], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}}, "material": "book-1", "materialLayers": ["book-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(198, 198, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_1_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}};
  (nodes["root"] ?? root).add(node_book_top_1_22);
  nodes["book-top-1"] = node_book_top_1_22;
  const mesh_book_top_1_22Geometry = endpoint_book_top_1_22
    ? new THREE.CylinderGeometry(endpoint_book_top_1_22.endRadius, endpoint_book_top_1_22.baseRadius, endpoint_book_top_1_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_1_22) {
    mesh_book_top_1_22Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_1_22 = new THREE.Mesh(
    mesh_book_top_1_22Geometry,
    materialMap["book-1"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_1_22.name = "Top book 1";
  if (endpoint_book_top_1_22) {
    mesh_book_top_1_22.position.copy(endpoint_book_top_1_22.midpoint);
    mesh_book_top_1_22.quaternion.copy(endpoint_book_top_1_22.quaternion);
  }
  mesh_book_top_1_22.castShadow = options.castShadow ?? true;
  mesh_book_top_1_22.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_1_22.userData.sculptComponent = {"id": "book-top-1", "name": "Top book 1", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, -0.12], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}}, "material": "book-1", "materialLayers": ["book-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(198, 198, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_1_22.add(mesh_book_top_1_22);
  meshes["book-top-1"] = mesh_book_top_1_22;
  colliders["book-top-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-1"] ??= [];
  destructionGroups["book-top-1"].push(node_book_top_1_22);

  const endpoint_book_low_1_23 = makeAttachmentEndpoint(null);
  const node_book_low_1_23 = new THREE.Group();
  node_book_low_1_23.name = "Low book 1__pivot";
  node_book_low_1_23.scale.set(1, 1, 1);
  if (endpoint_book_low_1_23) {
    node_book_low_1_23.position.copy(endpoint_book_low_1_23.start);
    node_book_low_1_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_1_23.position.set(-1.9, 0.26, -0.12);
    node_book_low_1_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_1_23.userData.sculptComponent = {"id": "book-low-1", "name": "Low book 1", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, -0.12], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}}, "material": "book-4", "materialLayers": ["book-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 74, 58, 1.0)", "secondaryAlbedo": "rgba(115, 60, 47, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_1_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}};
  (nodes["root"] ?? root).add(node_book_low_1_23);
  nodes["book-low-1"] = node_book_low_1_23;
  const mesh_book_low_1_23Geometry = endpoint_book_low_1_23
    ? new THREE.CylinderGeometry(endpoint_book_low_1_23.endRadius, endpoint_book_low_1_23.baseRadius, endpoint_book_low_1_23.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_1_23) {
    mesh_book_low_1_23Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_1_23 = new THREE.Mesh(
    mesh_book_low_1_23Geometry,
    materialMap["book-4"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_1_23.name = "Low book 1";
  if (endpoint_book_low_1_23) {
    mesh_book_low_1_23.position.copy(endpoint_book_low_1_23.midpoint);
    mesh_book_low_1_23.quaternion.copy(endpoint_book_low_1_23.quaternion);
  }
  mesh_book_low_1_23.castShadow = options.castShadow ?? true;
  mesh_book_low_1_23.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_1_23.userData.sculptComponent = {"id": "book-low-1", "name": "Low book 1", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, -0.12], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}}, "material": "book-4", "materialLayers": ["book-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 74, 58, 1.0)", "secondaryAlbedo": "rgba(115, 60, 47, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_1_23.add(mesh_book_low_1_23);
  meshes["book-low-1"] = mesh_book_low_1_23;
  colliders["book-low-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-1"] ??= [];
  destructionGroups["book-low-1"].push(node_book_low_1_23);

  const endpoint_book_top_2_24 = makeAttachmentEndpoint(null);
  const node_book_top_2_24 = new THREE.Group();
  node_book_top_2_24.name = "Top book 2__pivot";
  node_book_top_2_24.scale.set(1, 1, 1);
  if (endpoint_book_top_2_24) {
    node_book_top_2_24.position.copy(endpoint_book_top_2_24.start);
    node_book_top_2_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_2_24.position.set(-1.9, 1.88, 0.04);
    node_book_top_2_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_2_24.userData.sculptComponent = {"id": "book-top-2", "name": "Top book 2", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.04], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-2"}}, "material": "book-2", "materialLayers": ["book-2"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 122, 61, 1.0)", "secondaryAlbedo": "rgba(183, 100, 50, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_2_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-2"}};
  (nodes["root"] ?? root).add(node_book_top_2_24);
  nodes["book-top-2"] = node_book_top_2_24;
  const mesh_book_top_2_24Geometry = endpoint_book_top_2_24
    ? new THREE.CylinderGeometry(endpoint_book_top_2_24.endRadius, endpoint_book_top_2_24.baseRadius, endpoint_book_top_2_24.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_2_24) {
    mesh_book_top_2_24Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_2_24 = new THREE.Mesh(
    mesh_book_top_2_24Geometry,
    materialMap["book-2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_2_24.name = "Top book 2";
  if (endpoint_book_top_2_24) {
    mesh_book_top_2_24.position.copy(endpoint_book_top_2_24.midpoint);
    mesh_book_top_2_24.quaternion.copy(endpoint_book_top_2_24.quaternion);
  }
  mesh_book_top_2_24.castShadow = options.castShadow ?? true;
  mesh_book_top_2_24.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_2_24.userData.sculptComponent = {"id": "book-top-2", "name": "Top book 2", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.04], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-2"}}, "material": "book-2", "materialLayers": ["book-2"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 122, 61, 1.0)", "secondaryAlbedo": "rgba(183, 100, 50, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_2_24.add(mesh_book_top_2_24);
  meshes["book-top-2"] = mesh_book_top_2_24;
  colliders["book-top-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-2"] ??= [];
  destructionGroups["book-top-2"].push(node_book_top_2_24);

  const endpoint_book_low_2_25 = makeAttachmentEndpoint(null);
  const node_book_low_2_25 = new THREE.Group();
  node_book_low_2_25.name = "Low book 2__pivot";
  node_book_low_2_25.scale.set(1, 1, 1);
  if (endpoint_book_low_2_25) {
    node_book_low_2_25.position.copy(endpoint_book_low_2_25.start);
    node_book_low_2_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_2_25.position.set(-1.9, 0.26, 0.04);
    node_book_low_2_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_2_25.userData.sculptComponent = {"id": "book-low-2", "name": "Low book 2", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.04], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}}, "material": "book-5", "materialLayers": ["book-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 196, 163, 1.0)", "secondaryAlbedo": "rgba(176, 160, 133, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_2_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}};
  (nodes["root"] ?? root).add(node_book_low_2_25);
  nodes["book-low-2"] = node_book_low_2_25;
  const mesh_book_low_2_25Geometry = endpoint_book_low_2_25
    ? new THREE.CylinderGeometry(endpoint_book_low_2_25.endRadius, endpoint_book_low_2_25.baseRadius, endpoint_book_low_2_25.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_2_25) {
    mesh_book_low_2_25Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_2_25 = new THREE.Mesh(
    mesh_book_low_2_25Geometry,
    materialMap["book-5"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_2_25.name = "Low book 2";
  if (endpoint_book_low_2_25) {
    mesh_book_low_2_25.position.copy(endpoint_book_low_2_25.midpoint);
    mesh_book_low_2_25.quaternion.copy(endpoint_book_low_2_25.quaternion);
  }
  mesh_book_low_2_25.castShadow = options.castShadow ?? true;
  mesh_book_low_2_25.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_2_25.userData.sculptComponent = {"id": "book-low-2", "name": "Low book 2", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.04], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}}, "material": "book-5", "materialLayers": ["book-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 196, 163, 1.0)", "secondaryAlbedo": "rgba(176, 160, 133, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_2_25.add(mesh_book_low_2_25);
  meshes["book-low-2"] = mesh_book_low_2_25;
  colliders["book-low-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-2"] ??= [];
  destructionGroups["book-low-2"].push(node_book_low_2_25);

  const endpoint_book_top_3_26 = makeAttachmentEndpoint(null);
  const node_book_top_3_26 = new THREE.Group();
  node_book_top_3_26.name = "Top book 3__pivot";
  node_book_top_3_26.scale.set(1, 1, 1);
  if (endpoint_book_top_3_26) {
    node_book_top_3_26.position.copy(endpoint_book_top_3_26.start);
    node_book_top_3_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_3_26.position.set(-1.9, 1.88, 0.2);
    node_book_top_3_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_3_26.userData.sculptComponent = {"id": "book-top-3", "name": "Top book 3", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.2], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}}, "material": "book-3", "materialLayers": ["book-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 44, 44, 1.0)", "secondaryAlbedo": "rgba(36, 36, 36, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_3_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}};
  (nodes["root"] ?? root).add(node_book_top_3_26);
  nodes["book-top-3"] = node_book_top_3_26;
  const mesh_book_top_3_26Geometry = endpoint_book_top_3_26
    ? new THREE.CylinderGeometry(endpoint_book_top_3_26.endRadius, endpoint_book_top_3_26.baseRadius, endpoint_book_top_3_26.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_3_26) {
    mesh_book_top_3_26Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_3_26 = new THREE.Mesh(
    mesh_book_top_3_26Geometry,
    materialMap["book-3"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_3_26.name = "Top book 3";
  if (endpoint_book_top_3_26) {
    mesh_book_top_3_26.position.copy(endpoint_book_top_3_26.midpoint);
    mesh_book_top_3_26.quaternion.copy(endpoint_book_top_3_26.quaternion);
  }
  mesh_book_top_3_26.castShadow = options.castShadow ?? true;
  mesh_book_top_3_26.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_3_26.userData.sculptComponent = {"id": "book-top-3", "name": "Top book 3", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.2], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-3"}}, "material": "book-3", "materialLayers": ["book-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(44, 44, 44, 1.0)", "secondaryAlbedo": "rgba(36, 36, 36, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_3_26.add(mesh_book_top_3_26);
  meshes["book-top-3"] = mesh_book_top_3_26;
  colliders["book-top-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-3"] ??= [];
  destructionGroups["book-top-3"].push(node_book_top_3_26);

  const endpoint_book_low_3_27 = makeAttachmentEndpoint(null);
  const node_book_low_3_27 = new THREE.Group();
  node_book_low_3_27.name = "Low book 3__pivot";
  node_book_low_3_27.scale.set(1, 1, 1);
  if (endpoint_book_low_3_27) {
    node_book_low_3_27.position.copy(endpoint_book_low_3_27.start);
    node_book_low_3_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_3_27.position.set(-1.9, 0.26, 0.2);
    node_book_low_3_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_3_27.userData.sculptComponent = {"id": "book-low-3", "name": "Low book 3", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.2], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}}, "material": "book-6", "materialLayers": ["book-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(77, 107, 74, 1.0)", "secondaryAlbedo": "rgba(63, 87, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_3_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}};
  (nodes["root"] ?? root).add(node_book_low_3_27);
  nodes["book-low-3"] = node_book_low_3_27;
  const mesh_book_low_3_27Geometry = endpoint_book_low_3_27
    ? new THREE.CylinderGeometry(endpoint_book_low_3_27.endRadius, endpoint_book_low_3_27.baseRadius, endpoint_book_low_3_27.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_3_27) {
    mesh_book_low_3_27Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_3_27 = new THREE.Mesh(
    mesh_book_low_3_27Geometry,
    materialMap["book-6"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_3_27.name = "Low book 3";
  if (endpoint_book_low_3_27) {
    mesh_book_low_3_27.position.copy(endpoint_book_low_3_27.midpoint);
    mesh_book_low_3_27.quaternion.copy(endpoint_book_low_3_27.quaternion);
  }
  mesh_book_low_3_27.castShadow = options.castShadow ?? true;
  mesh_book_low_3_27.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_3_27.userData.sculptComponent = {"id": "book-low-3", "name": "Low book 3", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.2], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}}, "material": "book-6", "materialLayers": ["book-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(77, 107, 74, 1.0)", "secondaryAlbedo": "rgba(63, 87, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_3_27.add(mesh_book_low_3_27);
  meshes["book-low-3"] = mesh_book_low_3_27;
  colliders["book-low-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-3"] ??= [];
  destructionGroups["book-low-3"].push(node_book_low_3_27);

  const endpoint_book_top_4_28 = makeAttachmentEndpoint(null);
  const node_book_top_4_28 = new THREE.Group();
  node_book_top_4_28.name = "Top book 4__pivot";
  node_book_top_4_28.scale.set(1, 1, 1);
  if (endpoint_book_top_4_28) {
    node_book_top_4_28.position.copy(endpoint_book_top_4_28.start);
    node_book_top_4_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_4_28.position.set(-1.9, 1.88, 0.36);
    node_book_top_4_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_4_28.userData.sculptComponent = {"id": "book-top-4", "name": "Top book 4", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.36], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}}, "material": "book-4", "materialLayers": ["book-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 74, 58, 1.0)", "secondaryAlbedo": "rgba(115, 60, 47, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_4_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}};
  (nodes["root"] ?? root).add(node_book_top_4_28);
  nodes["book-top-4"] = node_book_top_4_28;
  const mesh_book_top_4_28Geometry = endpoint_book_top_4_28
    ? new THREE.CylinderGeometry(endpoint_book_top_4_28.endRadius, endpoint_book_top_4_28.baseRadius, endpoint_book_top_4_28.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_4_28) {
    mesh_book_top_4_28Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_4_28 = new THREE.Mesh(
    mesh_book_top_4_28Geometry,
    materialMap["book-4"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_4_28.name = "Top book 4";
  if (endpoint_book_top_4_28) {
    mesh_book_top_4_28.position.copy(endpoint_book_top_4_28.midpoint);
    mesh_book_top_4_28.quaternion.copy(endpoint_book_top_4_28.quaternion);
  }
  mesh_book_top_4_28.castShadow = options.castShadow ?? true;
  mesh_book_top_4_28.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_4_28.userData.sculptComponent = {"id": "book-top-4", "name": "Top book 4", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.36], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-4"}}, "material": "book-4", "materialLayers": ["book-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 74, 58, 1.0)", "secondaryAlbedo": "rgba(115, 60, 47, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_4_28.add(mesh_book_top_4_28);
  meshes["book-top-4"] = mesh_book_top_4_28;
  colliders["book-top-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-4"] ??= [];
  destructionGroups["book-top-4"].push(node_book_top_4_28);

  const endpoint_book_low_4_29 = makeAttachmentEndpoint(null);
  const node_book_low_4_29 = new THREE.Group();
  node_book_low_4_29.name = "Low book 4__pivot";
  node_book_low_4_29.scale.set(1, 1, 1);
  if (endpoint_book_low_4_29) {
    node_book_low_4_29.position.copy(endpoint_book_low_4_29.start);
    node_book_low_4_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_4_29.position.set(-1.9, 0.26, 0.36);
    node_book_low_4_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_4_29.userData.sculptComponent = {"id": "book-low-4", "name": "Low book 4", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.36], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-7"}}, "material": "book-7", "materialLayers": ["book-7"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 91, 106, 1.0)", "secondaryAlbedo": "rgba(160, 74, 86, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_4_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-7"}};
  (nodes["root"] ?? root).add(node_book_low_4_29);
  nodes["book-low-4"] = node_book_low_4_29;
  const mesh_book_low_4_29Geometry = endpoint_book_low_4_29
    ? new THREE.CylinderGeometry(endpoint_book_low_4_29.endRadius, endpoint_book_low_4_29.baseRadius, endpoint_book_low_4_29.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_4_29) {
    mesh_book_low_4_29Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_4_29 = new THREE.Mesh(
    mesh_book_low_4_29Geometry,
    materialMap["book-7"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_4_29.name = "Low book 4";
  if (endpoint_book_low_4_29) {
    mesh_book_low_4_29.position.copy(endpoint_book_low_4_29.midpoint);
    mesh_book_low_4_29.quaternion.copy(endpoint_book_low_4_29.quaternion);
  }
  mesh_book_low_4_29.castShadow = options.castShadow ?? true;
  mesh_book_low_4_29.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_4_29.userData.sculptComponent = {"id": "book-low-4", "name": "Low book 4", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.36], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-7"}}, "material": "book-7", "materialLayers": ["book-7"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 91, 106, 1.0)", "secondaryAlbedo": "rgba(160, 74, 86, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_4_29.add(mesh_book_low_4_29);
  meshes["book-low-4"] = mesh_book_low_4_29;
  colliders["book-low-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-4"] ??= [];
  destructionGroups["book-low-4"].push(node_book_low_4_29);

  const endpoint_book_top_5_30 = makeAttachmentEndpoint(null);
  const node_book_top_5_30 = new THREE.Group();
  node_book_top_5_30.name = "Top book 5__pivot";
  node_book_top_5_30.scale.set(1, 1, 1);
  if (endpoint_book_top_5_30) {
    node_book_top_5_30.position.copy(endpoint_book_top_5_30.start);
    node_book_top_5_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_5_30.position.set(-1.9, 1.88, 0.52);
    node_book_top_5_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_5_30.userData.sculptComponent = {"id": "book-top-5", "name": "Top book 5", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 5 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.52], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}}, "material": "book-5", "materialLayers": ["book-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 196, 163, 1.0)", "secondaryAlbedo": "rgba(176, 160, 133, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_5_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}};
  (nodes["root"] ?? root).add(node_book_top_5_30);
  nodes["book-top-5"] = node_book_top_5_30;
  const mesh_book_top_5_30Geometry = endpoint_book_top_5_30
    ? new THREE.CylinderGeometry(endpoint_book_top_5_30.endRadius, endpoint_book_top_5_30.baseRadius, endpoint_book_top_5_30.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_5_30) {
    mesh_book_top_5_30Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_5_30 = new THREE.Mesh(
    mesh_book_top_5_30Geometry,
    materialMap["book-5"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_5_30.name = "Top book 5";
  if (endpoint_book_top_5_30) {
    mesh_book_top_5_30.position.copy(endpoint_book_top_5_30.midpoint);
    mesh_book_top_5_30.quaternion.copy(endpoint_book_top_5_30.quaternion);
  }
  mesh_book_top_5_30.castShadow = options.castShadow ?? true;
  mesh_book_top_5_30.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_5_30.userData.sculptComponent = {"id": "book-top-5", "name": "Top book 5", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 5 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.52], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-5"}}, "material": "book-5", "materialLayers": ["book-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(215, 196, 163, 1.0)", "secondaryAlbedo": "rgba(176, 160, 133, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_5_30.add(mesh_book_top_5_30);
  meshes["book-top-5"] = mesh_book_top_5_30;
  colliders["book-top-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-5"] ??= [];
  destructionGroups["book-top-5"].push(node_book_top_5_30);

  const endpoint_book_low_5_31 = makeAttachmentEndpoint(null);
  const node_book_low_5_31 = new THREE.Group();
  node_book_low_5_31.name = "Low book 5__pivot";
  node_book_low_5_31.scale.set(1, 1, 1);
  if (endpoint_book_low_5_31) {
    node_book_low_5_31.position.copy(endpoint_book_low_5_31.start);
    node_book_low_5_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_5_31.position.set(-1.9, 0.26, 0.52);
    node_book_low_5_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_5_31.userData.sculptComponent = {"id": "book-low-5", "name": "Low book 5", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 5 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.52], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}}, "material": "book-0", "materialLayers": ["book-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(53, 92, 138, 1.0)", "secondaryAlbedo": "rgba(43, 75, 113, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_5_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}};
  (nodes["root"] ?? root).add(node_book_low_5_31);
  nodes["book-low-5"] = node_book_low_5_31;
  const mesh_book_low_5_31Geometry = endpoint_book_low_5_31
    ? new THREE.CylinderGeometry(endpoint_book_low_5_31.endRadius, endpoint_book_low_5_31.baseRadius, endpoint_book_low_5_31.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_5_31) {
    mesh_book_low_5_31Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_5_31 = new THREE.Mesh(
    mesh_book_low_5_31Geometry,
    materialMap["book-0"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_5_31.name = "Low book 5";
  if (endpoint_book_low_5_31) {
    mesh_book_low_5_31.position.copy(endpoint_book_low_5_31.midpoint);
    mesh_book_low_5_31.quaternion.copy(endpoint_book_low_5_31.quaternion);
  }
  mesh_book_low_5_31.castShadow = options.castShadow ?? true;
  mesh_book_low_5_31.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_5_31.userData.sculptComponent = {"id": "book-low-5", "name": "Low book 5", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 5 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.52], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-0"}}, "material": "book-0", "materialLayers": ["book-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(53, 92, 138, 1.0)", "secondaryAlbedo": "rgba(43, 75, 113, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_5_31.add(mesh_book_low_5_31);
  meshes["book-low-5"] = mesh_book_low_5_31;
  colliders["book-low-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-5"] ??= [];
  destructionGroups["book-low-5"].push(node_book_low_5_31);

  const endpoint_book_top_6_32 = makeAttachmentEndpoint(null);
  const node_book_top_6_32 = new THREE.Group();
  node_book_top_6_32.name = "Top book 6__pivot";
  node_book_top_6_32.scale.set(1, 1, 1);
  if (endpoint_book_top_6_32) {
    node_book_top_6_32.position.copy(endpoint_book_top_6_32.start);
    node_book_top_6_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_top_6_32.position.set(-1.9, 1.88, 0.68);
    node_book_top_6_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_top_6_32.userData.sculptComponent = {"id": "book-top-6", "name": "Top book 6", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 6 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.68], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}}, "material": "book-6", "materialLayers": ["book-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(77, 107, 74, 1.0)", "secondaryAlbedo": "rgba(63, 87, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_6_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}};
  (nodes["root"] ?? root).add(node_book_top_6_32);
  nodes["book-top-6"] = node_book_top_6_32;
  const mesh_book_top_6_32Geometry = endpoint_book_top_6_32
    ? new THREE.CylinderGeometry(endpoint_book_top_6_32.endRadius, endpoint_book_top_6_32.baseRadius, endpoint_book_top_6_32.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_top_6_32) {
    mesh_book_top_6_32Geometry.scale(0.16, 0.28, 0.07);
  }
  const mesh_book_top_6_32 = new THREE.Mesh(
    mesh_book_top_6_32Geometry,
    materialMap["book-6"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_top_6_32.name = "Top book 6";
  if (endpoint_book_top_6_32) {
    mesh_book_top_6_32.position.copy(endpoint_book_top_6_32.midpoint);
    mesh_book_top_6_32.quaternion.copy(endpoint_book_top_6_32.quaternion);
  }
  mesh_book_top_6_32.castShadow = options.castShadow ?? true;
  mesh_book_top_6_32.receiveShadow = options.receiveShadow ?? true;
  mesh_book_top_6_32.userData.sculptComponent = {"id": "book-top-6", "name": "Top book 6", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Top book 6 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.28, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 1.88, 0.68], "rotation": [0, 0, 0], "scale": [0.16, 0.28, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-top-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-6"}}, "material": "book-6", "materialLayers": ["book-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(77, 107, 74, 1.0)", "secondaryAlbedo": "rgba(63, 87, 60, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_top_6_32.add(mesh_book_top_6_32);
  meshes["book-top-6"] = mesh_book_top_6_32;
  colliders["book-top-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-top-6"] ??= [];
  destructionGroups["book-top-6"].push(node_book_top_6_32);

  const endpoint_book_low_6_33 = makeAttachmentEndpoint(null);
  const node_book_low_6_33 = new THREE.Group();
  node_book_low_6_33.name = "Low book 6__pivot";
  node_book_low_6_33.scale.set(1, 1, 1);
  if (endpoint_book_low_6_33) {
    node_book_low_6_33.position.copy(endpoint_book_low_6_33.start);
    node_book_low_6_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_book_low_6_33.position.set(-1.9, 0.26, 0.68);
    node_book_low_6_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_book_low_6_33.userData.sculptComponent = {"id": "book-low-6", "name": "Low book 6", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 6 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.68], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}}, "material": "book-1", "materialLayers": ["book-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(198, 198, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_6_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}};
  (nodes["root"] ?? root).add(node_book_low_6_33);
  nodes["book-low-6"] = node_book_low_6_33;
  const mesh_book_low_6_33Geometry = endpoint_book_low_6_33
    ? new THREE.CylinderGeometry(endpoint_book_low_6_33.endRadius, endpoint_book_low_6_33.baseRadius, endpoint_book_low_6_33.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_book_low_6_33) {
    mesh_book_low_6_33Geometry.scale(0.16, 0.26, 0.07);
  }
  const mesh_book_low_6_33 = new THREE.Mesh(
    mesh_book_low_6_33Geometry,
    materialMap["book-1"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_book_low_6_33.name = "Low book 6";
  if (endpoint_book_low_6_33) {
    mesh_book_low_6_33.position.copy(endpoint_book_low_6_33.midpoint);
    mesh_book_low_6_33.quaternion.copy(endpoint_book_low_6_33.quaternion);
  }
  mesh_book_low_6_33.castShadow = options.castShadow ?? true;
  mesh_book_low_6_33.receiveShadow = options.receiveShadow ?? true;
  mesh_book_low_6_33.userData.sculptComponent = {"id": "book-low-6", "name": "Low book 6", "level": "macro", "role": "book", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Low book 6 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 0.26, "depth": 0.07, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 0.26, 0.68], "rotation": [0, 0, 0], "scale": [0.16, 0.26, 0.07]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "book-low-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "book-1"}}, "material": "book-1", "materialLayers": ["book-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 242, 242, 1.0)", "secondaryAlbedo": "rgba(198, 198, 198, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_book_low_6_33.add(mesh_book_low_6_33);
  meshes["book-low-6"] = mesh_book_low_6_33;
  colliders["book-low-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["book-low-6"] ??= [];
  destructionGroups["book-low-6"].push(node_book_low_6_33);

  const endpoint_figurine_0_34 = makeAttachmentEndpoint(null);
  const node_figurine_0_34 = new THREE.Group();
  node_figurine_0_34.name = "Figurine 0__pivot";
  node_figurine_0_34.scale.set(1, 1, 1);
  if (endpoint_figurine_0_34) {
    node_figurine_0_34.position.copy(endpoint_figurine_0_34.start);
    node_figurine_0_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_0_34.position.set(-1.98, 2.26, -0.22);
    node_figurine_0_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_0_34.userData.sculptComponent = {"id": "figurine-0", "name": "Figurine 0", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 0 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.98, 2.26, -0.22], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-0"}}, "material": "fig-0", "materialLayers": ["fig-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 93, 76, 1.0)", "secondaryAlbedo": "rgba(190, 76, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_0_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-0"}};
  (nodes["root"] ?? root).add(node_figurine_0_34);
  nodes["figurine-0"] = node_figurine_0_34;
  const mesh_figurine_0_34Geometry = endpoint_figurine_0_34
    ? new THREE.CylinderGeometry(endpoint_figurine_0_34.endRadius, endpoint_figurine_0_34.baseRadius, endpoint_figurine_0_34.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_0_34) {
    mesh_figurine_0_34Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_0_34 = new THREE.Mesh(
    mesh_figurine_0_34Geometry,
    materialMap["fig-0"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_0_34.name = "Figurine 0";
  if (endpoint_figurine_0_34) {
    mesh_figurine_0_34.position.copy(endpoint_figurine_0_34.midpoint);
    mesh_figurine_0_34.quaternion.copy(endpoint_figurine_0_34.quaternion);
  }
  mesh_figurine_0_34.castShadow = options.castShadow ?? true;
  mesh_figurine_0_34.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_0_34.userData.sculptComponent = {"id": "figurine-0", "name": "Figurine 0", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 0 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.98, 2.26, -0.22], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-0"}}, "material": "fig-0", "materialLayers": ["fig-0"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 93, 76, 1.0)", "secondaryAlbedo": "rgba(190, 76, 62, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_0_34.add(mesh_figurine_0_34);
  meshes["figurine-0"] = mesh_figurine_0_34;
  colliders["figurine-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-0"] ??= [];
  destructionGroups["figurine-0"].push(node_figurine_0_34);

  const endpoint_figurine_1_35 = makeAttachmentEndpoint(null);
  const node_figurine_1_35 = new THREE.Group();
  node_figurine_1_35.name = "Figurine 1__pivot";
  node_figurine_1_35.scale.set(1, 1, 1);
  if (endpoint_figurine_1_35) {
    node_figurine_1_35.position.copy(endpoint_figurine_1_35.start);
    node_figurine_1_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_1_35.position.set(-1.9, 2.26, -0.02);
    node_figurine_1_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_1_35.userData.sculptComponent = {"id": "figurine-1", "name": "Figurine 1", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 1 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 2.26, -0.02], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-1"}}, "material": "fig-1", "materialLayers": ["fig-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 162, 2, 1.0)", "secondaryAlbedo": "rgba(196, 132, 1, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_1_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-1"}};
  (nodes["root"] ?? root).add(node_figurine_1_35);
  nodes["figurine-1"] = node_figurine_1_35;
  const mesh_figurine_1_35Geometry = endpoint_figurine_1_35
    ? new THREE.CylinderGeometry(endpoint_figurine_1_35.endRadius, endpoint_figurine_1_35.baseRadius, endpoint_figurine_1_35.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_1_35) {
    mesh_figurine_1_35Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_1_35 = new THREE.Mesh(
    mesh_figurine_1_35Geometry,
    materialMap["fig-1"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_1_35.name = "Figurine 1";
  if (endpoint_figurine_1_35) {
    mesh_figurine_1_35.position.copy(endpoint_figurine_1_35.midpoint);
    mesh_figurine_1_35.quaternion.copy(endpoint_figurine_1_35.quaternion);
  }
  mesh_figurine_1_35.castShadow = options.castShadow ?? true;
  mesh_figurine_1_35.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_1_35.userData.sculptComponent = {"id": "figurine-1", "name": "Figurine 1", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 1 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 2.26, -0.02], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-1"}}, "material": "fig-1", "materialLayers": ["fig-1"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(240, 162, 2, 1.0)", "secondaryAlbedo": "rgba(196, 132, 1, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_1_35.add(mesh_figurine_1_35);
  meshes["figurine-1"] = mesh_figurine_1_35;
  colliders["figurine-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-1"] ??= [];
  destructionGroups["figurine-1"].push(node_figurine_1_35);

  const endpoint_figurine_2_36 = makeAttachmentEndpoint(null);
  const node_figurine_2_36 = new THREE.Group();
  node_figurine_2_36.name = "Figurine 2__pivot";
  node_figurine_2_36.scale.set(1, 1, 1);
  if (endpoint_figurine_2_36) {
    node_figurine_2_36.position.copy(endpoint_figurine_2_36.start);
    node_figurine_2_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_2_36.position.set(-1.98, 2.26, 0.16);
    node_figurine_2_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_2_36.userData.sculptComponent = {"id": "figurine-2", "name": "Figurine 2", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 2 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.98, 2.26, 0.16], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-2"}}, "material": "fig-2", "materialLayers": ["fig-2"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 211, 94, 1.0)", "secondaryAlbedo": "rgba(200, 173, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_2_36.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-2"}};
  (nodes["root"] ?? root).add(node_figurine_2_36);
  nodes["figurine-2"] = node_figurine_2_36;
  const mesh_figurine_2_36Geometry = endpoint_figurine_2_36
    ? new THREE.CylinderGeometry(endpoint_figurine_2_36.endRadius, endpoint_figurine_2_36.baseRadius, endpoint_figurine_2_36.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_2_36) {
    mesh_figurine_2_36Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_2_36 = new THREE.Mesh(
    mesh_figurine_2_36Geometry,
    materialMap["fig-2"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_2_36.name = "Figurine 2";
  if (endpoint_figurine_2_36) {
    mesh_figurine_2_36.position.copy(endpoint_figurine_2_36.midpoint);
    mesh_figurine_2_36.quaternion.copy(endpoint_figurine_2_36.quaternion);
  }
  mesh_figurine_2_36.castShadow = options.castShadow ?? true;
  mesh_figurine_2_36.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_2_36.userData.sculptComponent = {"id": "figurine-2", "name": "Figurine 2", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 2 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.98, 2.26, 0.16], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-2"}}, "material": "fig-2", "materialLayers": ["fig-2"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 211, 94, 1.0)", "secondaryAlbedo": "rgba(200, 173, 77, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_2_36.add(mesh_figurine_2_36);
  meshes["figurine-2"] = mesh_figurine_2_36;
  colliders["figurine-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-2"] ??= [];
  destructionGroups["figurine-2"].push(node_figurine_2_36);

  const endpoint_figurine_3_37 = makeAttachmentEndpoint(null);
  const node_figurine_3_37 = new THREE.Group();
  node_figurine_3_37.name = "Figurine 3__pivot";
  node_figurine_3_37.scale.set(1, 1, 1);
  if (endpoint_figurine_3_37) {
    node_figurine_3_37.position.copy(endpoint_figurine_3_37.start);
    node_figurine_3_37.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_3_37.position.set(-1.88, 2.26, 0.34);
    node_figurine_3_37.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_3_37.userData.sculptComponent = {"id": "figurine-3", "name": "Figurine 3", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 3 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.88, 2.26, 0.34], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-3"}}, "material": "fig-3", "materialLayers": ["fig-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(125, 206, 130, 1.0)", "secondaryAlbedo": "rgba(102, 168, 106, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_3_37.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-3"}};
  (nodes["root"] ?? root).add(node_figurine_3_37);
  nodes["figurine-3"] = node_figurine_3_37;
  const mesh_figurine_3_37Geometry = endpoint_figurine_3_37
    ? new THREE.CylinderGeometry(endpoint_figurine_3_37.endRadius, endpoint_figurine_3_37.baseRadius, endpoint_figurine_3_37.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_3_37) {
    mesh_figurine_3_37Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_3_37 = new THREE.Mesh(
    mesh_figurine_3_37Geometry,
    materialMap["fig-3"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_3_37.name = "Figurine 3";
  if (endpoint_figurine_3_37) {
    mesh_figurine_3_37.position.copy(endpoint_figurine_3_37.midpoint);
    mesh_figurine_3_37.quaternion.copy(endpoint_figurine_3_37.quaternion);
  }
  mesh_figurine_3_37.castShadow = options.castShadow ?? true;
  mesh_figurine_3_37.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_3_37.userData.sculptComponent = {"id": "figurine-3", "name": "Figurine 3", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 3 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.88, 2.26, 0.34], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-3"}}, "material": "fig-3", "materialLayers": ["fig-3"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(125, 206, 130, 1.0)", "secondaryAlbedo": "rgba(102, 168, 106, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_3_37.add(mesh_figurine_3_37);
  meshes["figurine-3"] = mesh_figurine_3_37;
  colliders["figurine-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-3"] ??= [];
  destructionGroups["figurine-3"].push(node_figurine_3_37);

  const endpoint_figurine_4_38 = makeAttachmentEndpoint(null);
  const node_figurine_4_38 = new THREE.Group();
  node_figurine_4_38.name = "Figurine 4__pivot";
  node_figurine_4_38.scale.set(1, 1, 1);
  if (endpoint_figurine_4_38) {
    node_figurine_4_38.position.copy(endpoint_figurine_4_38.start);
    node_figurine_4_38.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_4_38.position.set(-2.0, 2.26, 0.5);
    node_figurine_4_38.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_4_38.userData.sculptComponent = {"id": "figurine-4", "name": "Figurine 4", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 4 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.0, 2.26, 0.5], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-4"}}, "material": "fig-4", "materialLayers": ["fig-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(94, 177, 232, 1.0)", "secondaryAlbedo": "rgba(77, 145, 190, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_4_38.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-4"}};
  (nodes["root"] ?? root).add(node_figurine_4_38);
  nodes["figurine-4"] = node_figurine_4_38;
  const mesh_figurine_4_38Geometry = endpoint_figurine_4_38
    ? new THREE.CylinderGeometry(endpoint_figurine_4_38.endRadius, endpoint_figurine_4_38.baseRadius, endpoint_figurine_4_38.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_4_38) {
    mesh_figurine_4_38Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_4_38 = new THREE.Mesh(
    mesh_figurine_4_38Geometry,
    materialMap["fig-4"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_4_38.name = "Figurine 4";
  if (endpoint_figurine_4_38) {
    mesh_figurine_4_38.position.copy(endpoint_figurine_4_38.midpoint);
    mesh_figurine_4_38.quaternion.copy(endpoint_figurine_4_38.quaternion);
  }
  mesh_figurine_4_38.castShadow = options.castShadow ?? true;
  mesh_figurine_4_38.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_4_38.userData.sculptComponent = {"id": "figurine-4", "name": "Figurine 4", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 4 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.0, 2.26, 0.5], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-4"}}, "material": "fig-4", "materialLayers": ["fig-4"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(94, 177, 232, 1.0)", "secondaryAlbedo": "rgba(77, 145, 190, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_4_38.add(mesh_figurine_4_38);
  meshes["figurine-4"] = mesh_figurine_4_38;
  colliders["figurine-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-4"] ??= [];
  destructionGroups["figurine-4"].push(node_figurine_4_38);

  const endpoint_figurine_5_39 = makeAttachmentEndpoint(null);
  const node_figurine_5_39 = new THREE.Group();
  node_figurine_5_39.name = "Figurine 5__pivot";
  node_figurine_5_39.scale.set(1, 1, 1);
  if (endpoint_figurine_5_39) {
    node_figurine_5_39.position.copy(endpoint_figurine_5_39.start);
    node_figurine_5_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_5_39.position.set(-1.9, 2.26, 0.66);
    node_figurine_5_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_5_39.userData.sculptComponent = {"id": "figurine-5", "name": "Figurine 5", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 5 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 2.26, 0.66], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-5"}}, "material": "fig-5", "materialLayers": ["fig-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 111, 240, 1.0)", "secondaryAlbedo": "rgba(100, 91, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_5_39.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-5"}};
  (nodes["root"] ?? root).add(node_figurine_5_39);
  nodes["figurine-5"] = node_figurine_5_39;
  const mesh_figurine_5_39Geometry = endpoint_figurine_5_39
    ? new THREE.CylinderGeometry(endpoint_figurine_5_39.endRadius, endpoint_figurine_5_39.baseRadius, endpoint_figurine_5_39.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_5_39) {
    mesh_figurine_5_39Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_5_39 = new THREE.Mesh(
    mesh_figurine_5_39Geometry,
    materialMap["fig-5"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_5_39.name = "Figurine 5";
  if (endpoint_figurine_5_39) {
    mesh_figurine_5_39.position.copy(endpoint_figurine_5_39.midpoint);
    mesh_figurine_5_39.quaternion.copy(endpoint_figurine_5_39.quaternion);
  }
  mesh_figurine_5_39.castShadow = options.castShadow ?? true;
  mesh_figurine_5_39.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_5_39.userData.sculptComponent = {"id": "figurine-5", "name": "Figurine 5", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 5 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.9, 2.26, 0.66], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-5", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-5"}}, "material": "fig-5", "materialLayers": ["fig-5"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 111, 240, 1.0)", "secondaryAlbedo": "rgba(100, 91, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_5_39.add(mesh_figurine_5_39);
  meshes["figurine-5"] = mesh_figurine_5_39;
  colliders["figurine-5"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-5"] ??= [];
  destructionGroups["figurine-5"].push(node_figurine_5_39);

  const endpoint_figurine_6_40 = makeAttachmentEndpoint(null);
  const node_figurine_6_40 = new THREE.Group();
  node_figurine_6_40.name = "Figurine 6__pivot";
  node_figurine_6_40.scale.set(1, 1, 1);
  if (endpoint_figurine_6_40) {
    node_figurine_6_40.position.copy(endpoint_figurine_6_40.start);
    node_figurine_6_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_6_40.position.set(-1.84, 2.26, 0.22);
    node_figurine_6_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_6_40.userData.sculptComponent = {"id": "figurine-6", "name": "Figurine 6", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 6 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.84, 2.26, 0.22], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-6"}}, "material": "fig-6", "materialLayers": ["fig-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 107, 176, 1.0)", "secondaryAlbedo": "rgba(190, 87, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_6_40.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-6"}};
  (nodes["root"] ?? root).add(node_figurine_6_40);
  nodes["figurine-6"] = node_figurine_6_40;
  const mesh_figurine_6_40Geometry = endpoint_figurine_6_40
    ? new THREE.CylinderGeometry(endpoint_figurine_6_40.endRadius, endpoint_figurine_6_40.baseRadius, endpoint_figurine_6_40.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_6_40) {
    mesh_figurine_6_40Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_6_40 = new THREE.Mesh(
    mesh_figurine_6_40Geometry,
    materialMap["fig-6"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_6_40.name = "Figurine 6";
  if (endpoint_figurine_6_40) {
    mesh_figurine_6_40.position.copy(endpoint_figurine_6_40.midpoint);
    mesh_figurine_6_40.quaternion.copy(endpoint_figurine_6_40.quaternion);
  }
  mesh_figurine_6_40.castShadow = options.castShadow ?? true;
  mesh_figurine_6_40.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_6_40.userData.sculptComponent = {"id": "figurine-6", "name": "Figurine 6", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 6 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.84, 2.26, 0.22], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-6", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-6"}}, "material": "fig-6", "materialLayers": ["fig-6"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(232, 107, 176, 1.0)", "secondaryAlbedo": "rgba(190, 87, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_6_40.add(mesh_figurine_6_40);
  meshes["figurine-6"] = mesh_figurine_6_40;
  colliders["figurine-6"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-6"] ??= [];
  destructionGroups["figurine-6"].push(node_figurine_6_40);

  const endpoint_figurine_7_41 = makeAttachmentEndpoint(null);
  const node_figurine_7_41 = new THREE.Group();
  node_figurine_7_41.name = "Figurine 7__pivot";
  node_figurine_7_41.scale.set(1, 1, 1);
  if (endpoint_figurine_7_41) {
    node_figurine_7_41.position.copy(endpoint_figurine_7_41.start);
    node_figurine_7_41.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_figurine_7_41.position.set(-2.04, 2.26, 0.4);
    node_figurine_7_41.rotation.set(0.0, 0.0, 0.0);
  }
  node_figurine_7_41.userData.sculptComponent = {"id": "figurine-7", "name": "Figurine 7", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 7 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.04, 2.26, 0.4], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-7"}}, "material": "fig-7", "materialLayers": ["fig-7"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 140, 107, 1.0)", "secondaryAlbedo": "rgba(198, 114, 87, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_7_41.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-7"}};
  (nodes["root"] ?? root).add(node_figurine_7_41);
  nodes["figurine-7"] = node_figurine_7_41;
  const mesh_figurine_7_41Geometry = endpoint_figurine_7_41
    ? new THREE.CylinderGeometry(endpoint_figurine_7_41.endRadius, endpoint_figurine_7_41.baseRadius, endpoint_figurine_7_41.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_figurine_7_41) {
    mesh_figurine_7_41Geometry.scale(0.13, 0.13, 0.13);
  }
  const mesh_figurine_7_41 = new THREE.Mesh(
    mesh_figurine_7_41Geometry,
    materialMap["fig-7"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_figurine_7_41.name = "Figurine 7";
  if (endpoint_figurine_7_41) {
    mesh_figurine_7_41.position.copy(endpoint_figurine_7_41.midpoint);
    mesh_figurine_7_41.quaternion.copy(endpoint_figurine_7_41.quaternion);
  }
  mesh_figurine_7_41.castShadow = options.castShadow ?? true;
  mesh_figurine_7_41.receiveShadow = options.receiveShadow ?? true;
  mesh_figurine_7_41.userData.sculptComponent = {"id": "figurine-7", "name": "Figurine 7", "level": "macro", "role": "figurine", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Figurine 7 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.13, "height": 0.13, "depth": 0.13, "units": "relative", "confidence": 0.6}, "transform": {"position": [-2.04, 2.26, 0.4], "rotation": [0, 0, 0], "scale": [0.13, 0.13, 0.13]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "figurine-7", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fig-7"}}, "material": "fig-7", "materialLayers": ["fig-7"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 140, 107, 1.0)", "secondaryAlbedo": "rgba(198, 114, 87, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_figurine_7_41.add(mesh_figurine_7_41);
  meshes["figurine-7"] = mesh_figurine_7_41;
  colliders["figurine-7"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["figurine-7"] ??= [];
  destructionGroups["figurine-7"].push(node_figurine_7_41);

  const endpoint_desk_top_42 = makeAttachmentEndpoint(null);
  const node_desk_top_42 = new THREE.Group();
  node_desk_top_42.name = "Desk top__pivot";
  node_desk_top_42.scale.set(1, 1, 1);
  if (endpoint_desk_top_42) {
    node_desk_top_42.position.copy(endpoint_desk_top_42.start);
    node_desk_top_42.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_desk_top_42.position.set(-0.95, 0.74, -1.18);
    node_desk_top_42.rotation.set(0.0, 0.0, 0.0);
  }
  node_desk_top_42.userData.sculptComponent = {"id": "desk-top", "name": "Desk top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Desk top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.5, "height": 0.05, "depth": 0.64, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.95, 0.74, -1.18], "rotation": [0, 0, 0], "scale": [1.5, 0.05, 0.64]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_desk_top_42.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_desk_top_42);
  nodes["desk-top"] = node_desk_top_42;
  const mesh_desk_top_42Geometry = endpoint_desk_top_42
    ? new THREE.CylinderGeometry(endpoint_desk_top_42.endRadius, endpoint_desk_top_42.baseRadius, endpoint_desk_top_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_desk_top_42) {
    mesh_desk_top_42Geometry.scale(1.5, 0.05, 0.64);
  }
  const mesh_desk_top_42 = new THREE.Mesh(
    mesh_desk_top_42Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_desk_top_42.name = "Desk top";
  if (endpoint_desk_top_42) {
    mesh_desk_top_42.position.copy(endpoint_desk_top_42.midpoint);
    mesh_desk_top_42.quaternion.copy(endpoint_desk_top_42.quaternion);
  }
  mesh_desk_top_42.castShadow = options.castShadow ?? true;
  mesh_desk_top_42.receiveShadow = options.receiveShadow ?? true;
  mesh_desk_top_42.userData.sculptComponent = {"id": "desk-top", "name": "Desk top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Desk top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.5, "height": 0.05, "depth": 0.64, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.95, 0.74, -1.18], "rotation": [0, 0, 0], "scale": [1.5, 0.05, 0.64]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "desk-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_desk_top_42.add(mesh_desk_top_42);
  meshes["desk-top"] = mesh_desk_top_42;
  colliders["desk-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["desk-top"] ??= [];
  destructionGroups["desk-top"].push(node_desk_top_42);

  const endpoint_drawer_pedestal_43 = makeAttachmentEndpoint(null);
  const node_drawer_pedestal_43 = new THREE.Group();
  node_drawer_pedestal_43.name = "Drawer pedestal__pivot";
  node_drawer_pedestal_43.scale.set(1, 1, 1);
  if (endpoint_drawer_pedestal_43) {
    node_drawer_pedestal_43.position.copy(endpoint_drawer_pedestal_43.start);
    node_drawer_pedestal_43.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_drawer_pedestal_43.position.set(-1.42, 0.36, -1.18);
    node_drawer_pedestal_43.rotation.set(0.0, 0.0, 0.0);
  }
  node_drawer_pedestal_43.userData.sculptComponent = {"id": "drawer-pedestal", "name": "Drawer pedestal", "level": "macro", "role": "pedestal", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Drawer pedestal is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.68, "depth": 0.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.42, 0.36, -1.18], "rotation": [0, 0, 0], "scale": [0.42, 0.68, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawer-pedestal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_drawer_pedestal_43.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawer-pedestal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_drawer_pedestal_43);
  nodes["drawer-pedestal"] = node_drawer_pedestal_43;
  const mesh_drawer_pedestal_43Geometry = endpoint_drawer_pedestal_43
    ? new THREE.CylinderGeometry(endpoint_drawer_pedestal_43.endRadius, endpoint_drawer_pedestal_43.baseRadius, endpoint_drawer_pedestal_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_drawer_pedestal_43) {
    mesh_drawer_pedestal_43Geometry.scale(0.42, 0.68, 0.5);
  }
  const mesh_drawer_pedestal_43 = new THREE.Mesh(
    mesh_drawer_pedestal_43Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drawer_pedestal_43.name = "Drawer pedestal";
  if (endpoint_drawer_pedestal_43) {
    mesh_drawer_pedestal_43.position.copy(endpoint_drawer_pedestal_43.midpoint);
    mesh_drawer_pedestal_43.quaternion.copy(endpoint_drawer_pedestal_43.quaternion);
  }
  mesh_drawer_pedestal_43.castShadow = options.castShadow ?? true;
  mesh_drawer_pedestal_43.receiveShadow = options.receiveShadow ?? true;
  mesh_drawer_pedestal_43.userData.sculptComponent = {"id": "drawer-pedestal", "name": "Drawer pedestal", "level": "macro", "role": "pedestal", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Drawer pedestal is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.42, "height": 0.68, "depth": 0.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.42, 0.36, -1.18], "rotation": [0, 0, 0], "scale": [0.42, 0.68, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drawer-pedestal", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_drawer_pedestal_43.add(mesh_drawer_pedestal_43);
  meshes["drawer-pedestal"] = mesh_drawer_pedestal_43;
  colliders["drawer-pedestal"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["drawer-pedestal"] ??= [];
  destructionGroups["drawer-pedestal"].push(node_drawer_pedestal_43);

  const endpoint_monitor_bezel_44 = makeAttachmentEndpoint(null);
  const node_monitor_bezel_44 = new THREE.Group();
  node_monitor_bezel_44.name = "Monitor bezel__pivot";
  node_monitor_bezel_44.scale.set(1, 1, 1);
  if (endpoint_monitor_bezel_44) {
    node_monitor_bezel_44.position.copy(endpoint_monitor_bezel_44.start);
    node_monitor_bezel_44.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitor_bezel_44.position.set(-1.15, 1.16, -1.4);
    node_monitor_bezel_44.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitor_bezel_44.userData.sculptComponent = {"id": "monitor-bezel", "name": "Monitor bezel", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor bezel is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.64, "height": 0.4, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.15, 1.16, -1.4], "rotation": [0, 0, 0], "scale": [0.64, 0.4, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-bezel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_bezel_44.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-bezel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_monitor_bezel_44);
  nodes["monitor-bezel"] = node_monitor_bezel_44;
  const mesh_monitor_bezel_44Geometry = endpoint_monitor_bezel_44
    ? new THREE.CylinderGeometry(endpoint_monitor_bezel_44.endRadius, endpoint_monitor_bezel_44.baseRadius, endpoint_monitor_bezel_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_monitor_bezel_44) {
    mesh_monitor_bezel_44Geometry.scale(0.64, 0.4, 0.04);
  }
  const mesh_monitor_bezel_44 = new THREE.Mesh(
    mesh_monitor_bezel_44Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitor_bezel_44.name = "Monitor bezel";
  if (endpoint_monitor_bezel_44) {
    mesh_monitor_bezel_44.position.copy(endpoint_monitor_bezel_44.midpoint);
    mesh_monitor_bezel_44.quaternion.copy(endpoint_monitor_bezel_44.quaternion);
  }
  mesh_monitor_bezel_44.castShadow = options.castShadow ?? true;
  mesh_monitor_bezel_44.receiveShadow = options.receiveShadow ?? true;
  mesh_monitor_bezel_44.userData.sculptComponent = {"id": "monitor-bezel", "name": "Monitor bezel", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor bezel is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.64, "height": 0.4, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.15, 1.16, -1.4], "rotation": [0, 0, 0], "scale": [0.64, 0.4, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-bezel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_bezel_44.add(mesh_monitor_bezel_44);
  meshes["monitor-bezel"] = mesh_monitor_bezel_44;
  colliders["monitor-bezel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["monitor-bezel"] ??= [];
  destructionGroups["monitor-bezel"].push(node_monitor_bezel_44);

  const endpoint_monitor_screen_45 = makeAttachmentEndpoint(null);
  const node_monitor_screen_45 = new THREE.Group();
  node_monitor_screen_45.name = "Monitor screen__pivot";
  node_monitor_screen_45.scale.set(1, 1, 1);
  if (endpoint_monitor_screen_45) {
    node_monitor_screen_45.position.copy(endpoint_monitor_screen_45.start);
    node_monitor_screen_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_monitor_screen_45.position.set(-1.15, 1.16, -1.372);
    node_monitor_screen_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_monitor_screen_45.userData.sculptComponent = {"id": "monitor-screen", "name": "Monitor screen", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor screen is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.56, "height": 0.32, "depth": 0.012, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.15, 1.16, -1.372], "rotation": [0, 0, 0], "scale": [0.56, 0.32, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-warm"}}, "material": "screen-warm", "materialLayers": ["screen-warm"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sunset-gradient", "kind": "emissive", "note": "orange screen on the monitor"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 106, 26, 1.0)", "secondaryAlbedo": "rgba(209, 86, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_screen_45.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-warm"}};
  (nodes["root"] ?? root).add(node_monitor_screen_45);
  nodes["monitor-screen"] = node_monitor_screen_45;
  const mesh_monitor_screen_45Geometry = endpoint_monitor_screen_45
    ? new THREE.CylinderGeometry(endpoint_monitor_screen_45.endRadius, endpoint_monitor_screen_45.baseRadius, endpoint_monitor_screen_45.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_monitor_screen_45) {
    mesh_monitor_screen_45Geometry.scale(0.56, 0.32, 0.012);
  }
  const mesh_monitor_screen_45 = new THREE.Mesh(
    mesh_monitor_screen_45Geometry,
    materialMap["screen-warm"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitor_screen_45.name = "Monitor screen";
  if (endpoint_monitor_screen_45) {
    mesh_monitor_screen_45.position.copy(endpoint_monitor_screen_45.midpoint);
    mesh_monitor_screen_45.quaternion.copy(endpoint_monitor_screen_45.quaternion);
  }
  mesh_monitor_screen_45.castShadow = options.castShadow ?? true;
  mesh_monitor_screen_45.receiveShadow = options.receiveShadow ?? true;
  mesh_monitor_screen_45.userData.sculptComponent = {"id": "monitor-screen", "name": "Monitor screen", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor screen is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.56, "height": 0.32, "depth": 0.012, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.15, 1.16, -1.372], "rotation": [0, 0, 0], "scale": [0.56, 0.32, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-warm"}}, "material": "screen-warm", "materialLayers": ["screen-warm"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sunset-gradient", "kind": "emissive", "note": "orange screen on the monitor"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 106, 26, 1.0)", "secondaryAlbedo": "rgba(209, 86, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_screen_45.add(mesh_monitor_screen_45);
  meshes["monitor-screen"] = mesh_monitor_screen_45;
  colliders["monitor-screen"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["monitor-screen"] ??= [];
  destructionGroups["monitor-screen"].push(node_monitor_screen_45);

  const endpoint_monitor_boom_46 = makeAttachmentEndpoint(null);
  const node_monitor_boom_46 = new THREE.Group();
  node_monitor_boom_46.name = "Monitor boom__pivot";
  node_monitor_boom_46.scale.set(1, 1, 1);
  if (endpoint_monitor_boom_46) {
    node_monitor_boom_46.position.copy(endpoint_monitor_boom_46.start);
    node_monitor_boom_46.rotation.set(0.0, 0.0, 0.6);
  } else {
    node_monitor_boom_46.position.set(-1.45, 1.0, -1.42);
    node_monitor_boom_46.rotation.set(0.0, 0.0, 0.6);
  }
  node_monitor_boom_46.userData.sculptComponent = {"id": "monitor-boom", "name": "Monitor boom", "level": "macro", "role": "boom", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor boom is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.45, 1.0, -1.42], "rotation": [0, 0, 0.6], "scale": [0.28, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-boom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_boom_46.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-boom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_monitor_boom_46);
  nodes["monitor-boom"] = node_monitor_boom_46;
  const mesh_monitor_boom_46Geometry = endpoint_monitor_boom_46
    ? new THREE.CylinderGeometry(endpoint_monitor_boom_46.endRadius, endpoint_monitor_boom_46.baseRadius, endpoint_monitor_boom_46.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_monitor_boom_46) {
    mesh_monitor_boom_46Geometry.scale(0.28, 0.03, 0.03);
  }
  const mesh_monitor_boom_46 = new THREE.Mesh(
    mesh_monitor_boom_46Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_monitor_boom_46.name = "Monitor boom";
  if (endpoint_monitor_boom_46) {
    mesh_monitor_boom_46.position.copy(endpoint_monitor_boom_46.midpoint);
    mesh_monitor_boom_46.quaternion.copy(endpoint_monitor_boom_46.quaternion);
  }
  mesh_monitor_boom_46.castShadow = options.castShadow ?? true;
  mesh_monitor_boom_46.receiveShadow = options.receiveShadow ?? true;
  mesh_monitor_boom_46.userData.sculptComponent = {"id": "monitor-boom", "name": "Monitor boom", "level": "macro", "role": "boom", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Monitor boom is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.03, "depth": 0.03, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.45, 1.0, -1.42], "rotation": [0, 0, 0.6], "scale": [0.28, 0.03, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "monitor-boom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_monitor_boom_46.add(mesh_monitor_boom_46);
  meshes["monitor-boom"] = mesh_monitor_boom_46;
  colliders["monitor-boom"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["monitor-boom"] ??= [];
  destructionGroups["monitor-boom"].push(node_monitor_boom_46);

  const endpoint_lamp_shade_47 = makeAttachmentEndpoint(null);
  const node_lamp_shade_47 = new THREE.Group();
  node_lamp_shade_47.name = "Lamp shade__pivot";
  node_lamp_shade_47.scale.set(1, 1, 1);
  if (endpoint_lamp_shade_47) {
    node_lamp_shade_47.position.copy(endpoint_lamp_shade_47.start);
    node_lamp_shade_47.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lamp_shade_47.position.set(-1.58, 1.48, -1.32);
    node_lamp_shade_47.rotation.set(0.0, 0.0, 0.0);
  }
  node_lamp_shade_47.userData.sculptComponent = {"id": "lamp-shade", "name": "Lamp shade", "level": "macro", "role": "lamp", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Lamp shade is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.58, 1.48, -1.32], "rotation": [0, 0, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-shade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lamp"}}, "material": "lamp", "materialLayers": ["lamp"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lamp-hotspot", "kind": "emissive", "note": "white shade is the local key"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 246, 232, 1.0)", "secondaryAlbedo": "rgba(209, 201, 190, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lamp_shade_47.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-shade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lamp"}};
  (nodes["root"] ?? root).add(node_lamp_shade_47);
  nodes["lamp-shade"] = node_lamp_shade_47;
  const mesh_lamp_shade_47Geometry = endpoint_lamp_shade_47
    ? new THREE.CylinderGeometry(endpoint_lamp_shade_47.endRadius, endpoint_lamp_shade_47.baseRadius, endpoint_lamp_shade_47.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_lamp_shade_47) {
    mesh_lamp_shade_47Geometry.scale(0.22, 0.16, 0.22);
  }
  const mesh_lamp_shade_47 = new THREE.Mesh(
    mesh_lamp_shade_47Geometry,
    materialMap["lamp"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lamp_shade_47.name = "Lamp shade";
  if (endpoint_lamp_shade_47) {
    mesh_lamp_shade_47.position.copy(endpoint_lamp_shade_47.midpoint);
    mesh_lamp_shade_47.quaternion.copy(endpoint_lamp_shade_47.quaternion);
  }
  mesh_lamp_shade_47.castShadow = options.castShadow ?? true;
  mesh_lamp_shade_47.receiveShadow = options.receiveShadow ?? true;
  mesh_lamp_shade_47.userData.sculptComponent = {"id": "lamp-shade", "name": "Lamp shade", "level": "macro", "role": "lamp", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Lamp shade is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.16, "depth": 0.22, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.58, 1.48, -1.32], "rotation": [0, 0, 0], "scale": [0.22, 0.16, 0.22]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-shade", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lamp"}}, "material": "lamp", "materialLayers": ["lamp"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lamp-hotspot", "kind": "emissive", "note": "white shade is the local key"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 246, 232, 1.0)", "secondaryAlbedo": "rgba(209, 201, 190, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lamp_shade_47.add(mesh_lamp_shade_47);
  meshes["lamp-shade"] = mesh_lamp_shade_47;
  colliders["lamp-shade"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lamp-shade"] ??= [];
  destructionGroups["lamp-shade"].push(node_lamp_shade_47);

  const attachment_lamp_stem_48 = null;
  const endpoint_lamp_stem_48 = makeAttachmentEndpoint(attachment_lamp_stem_48);
  const node_lamp_stem_48 = new THREE.Group();
  node_lamp_stem_48.name = "Lamp stem__pivot";
  node_lamp_stem_48.scale.set(1, 1, 1);
  if (endpoint_lamp_stem_48) {
    node_lamp_stem_48.position.copy(endpoint_lamp_stem_48.start);
    node_lamp_stem_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lamp_stem_48.position.set(-1.55, 1.1, -1.36);
    node_lamp_stem_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_lamp_stem_48.userData.sculptComponent = {"id": "lamp-stem", "name": "Lamp stem", "level": "macro", "role": "stem", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Lamp stem is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.03, "height": 0.55, "depth": 0.03, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.55, 1.1, -1.36], "rotation": [0, 0, 0], "scale": [0.03, 0.55, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lamp_stem_48.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_lamp_stem_48);
  nodes["lamp-stem"] = node_lamp_stem_48;
  const mesh_lamp_stem_48Geometry = endpoint_lamp_stem_48
    ? new THREE.CylinderGeometry(endpoint_lamp_stem_48.endRadius, endpoint_lamp_stem_48.baseRadius, endpoint_lamp_stem_48.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_lamp_stem_48) {
    mesh_lamp_stem_48Geometry.scale(0.03, 0.55, 0.03);
  }
  const mesh_lamp_stem_48 = new THREE.Mesh(
    mesh_lamp_stem_48Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lamp_stem_48.name = "Lamp stem";
  if (endpoint_lamp_stem_48) {
    mesh_lamp_stem_48.position.copy(endpoint_lamp_stem_48.midpoint);
    mesh_lamp_stem_48.quaternion.copy(endpoint_lamp_stem_48.quaternion);
  }
  mesh_lamp_stem_48.castShadow = options.castShadow ?? true;
  mesh_lamp_stem_48.receiveShadow = options.receiveShadow ?? true;
  mesh_lamp_stem_48.userData.sculptComponent = {"id": "lamp-stem", "name": "Lamp stem", "level": "macro", "role": "stem", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Lamp stem is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.03, "height": 0.55, "depth": 0.03, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.55, 1.1, -1.36], "rotation": [0, 0, 0], "scale": [0.03, 0.55, 0.03]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lamp-stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_lamp_stem_48.add(mesh_lamp_stem_48);
  meshes["lamp-stem"] = mesh_lamp_stem_48;
  colliders["lamp-stem"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lamp-stem"] ??= [];
  destructionGroups["lamp-stem"].push(node_lamp_stem_48);

  const endpoint_laptop_base_49 = makeAttachmentEndpoint(null);
  const node_laptop_base_49 = new THREE.Group();
  node_laptop_base_49.name = "Laptop base__pivot";
  node_laptop_base_49.scale.set(1, 1, 1);
  if (endpoint_laptop_base_49) {
    node_laptop_base_49.position.copy(endpoint_laptop_base_49.start);
    node_laptop_base_49.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_laptop_base_49.position.set(-0.42, 0.785, -1.12);
    node_laptop_base_49.rotation.set(0.0, 0.0, 0.0);
  }
  node_laptop_base_49.userData.sculptComponent = {"id": "laptop-base", "name": "Laptop base", "level": "macro", "role": "computer", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Laptop base is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.02, "depth": 0.24, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.42, 0.785, -1.12], "rotation": [0, 0, 0], "scale": [0.36, 0.02, 0.24]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_laptop_base_49.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}};
  (nodes["root"] ?? root).add(node_laptop_base_49);
  nodes["laptop-base"] = node_laptop_base_49;
  const mesh_laptop_base_49Geometry = endpoint_laptop_base_49
    ? new THREE.CylinderGeometry(endpoint_laptop_base_49.endRadius, endpoint_laptop_base_49.baseRadius, endpoint_laptop_base_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_laptop_base_49) {
    mesh_laptop_base_49Geometry.scale(0.36, 0.02, 0.24);
  }
  const mesh_laptop_base_49 = new THREE.Mesh(
    mesh_laptop_base_49Geometry,
    materialMap["plastic-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptop_base_49.name = "Laptop base";
  if (endpoint_laptop_base_49) {
    mesh_laptop_base_49.position.copy(endpoint_laptop_base_49.midpoint);
    mesh_laptop_base_49.quaternion.copy(endpoint_laptop_base_49.quaternion);
  }
  mesh_laptop_base_49.castShadow = options.castShadow ?? true;
  mesh_laptop_base_49.receiveShadow = options.receiveShadow ?? true;
  mesh_laptop_base_49.userData.sculptComponent = {"id": "laptop-base", "name": "Laptop base", "level": "macro", "role": "computer", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Laptop base is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.02, "depth": 0.24, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.42, 0.785, -1.12], "rotation": [0, 0, 0], "scale": [0.36, 0.02, 0.24]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_laptop_base_49.add(mesh_laptop_base_49);
  meshes["laptop-base"] = mesh_laptop_base_49;
  colliders["laptop-base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["laptop-base"] ??= [];
  destructionGroups["laptop-base"].push(node_laptop_base_49);

  const endpoint_laptop_lid_50 = makeAttachmentEndpoint(null);
  const node_laptop_lid_50 = new THREE.Group();
  node_laptop_lid_50.name = "Laptop lid__pivot";
  node_laptop_lid_50.scale.set(1, 1, 1);
  if (endpoint_laptop_lid_50) {
    node_laptop_lid_50.position.copy(endpoint_laptop_lid_50.start);
    node_laptop_lid_50.rotation.set(-0.85, 0.0, 0.0);
  } else {
    node_laptop_lid_50.position.set(-0.42, 0.96, -1.26);
    node_laptop_lid_50.rotation.set(-0.85, 0.0, 0.0);
  }
  node_laptop_lid_50.userData.sculptComponent = {"id": "laptop-lid", "name": "Laptop lid", "level": "macro", "role": "computer", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Laptop lid is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.22, "depth": 0.012, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.42, 0.96, -1.26], "rotation": [-0.85, 0, 0], "scale": [0.36, 0.22, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_laptop_lid_50.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}};
  (nodes["root"] ?? root).add(node_laptop_lid_50);
  nodes["laptop-lid"] = node_laptop_lid_50;
  const mesh_laptop_lid_50Geometry = endpoint_laptop_lid_50
    ? new THREE.CylinderGeometry(endpoint_laptop_lid_50.endRadius, endpoint_laptop_lid_50.baseRadius, endpoint_laptop_lid_50.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_laptop_lid_50) {
    mesh_laptop_lid_50Geometry.scale(0.36, 0.22, 0.012);
  }
  const mesh_laptop_lid_50 = new THREE.Mesh(
    mesh_laptop_lid_50Geometry,
    materialMap["plastic-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_laptop_lid_50.name = "Laptop lid";
  if (endpoint_laptop_lid_50) {
    mesh_laptop_lid_50.position.copy(endpoint_laptop_lid_50.midpoint);
    mesh_laptop_lid_50.quaternion.copy(endpoint_laptop_lid_50.quaternion);
  }
  mesh_laptop_lid_50.castShadow = options.castShadow ?? true;
  mesh_laptop_lid_50.receiveShadow = options.receiveShadow ?? true;
  mesh_laptop_lid_50.userData.sculptComponent = {"id": "laptop-lid", "name": "Laptop lid", "level": "macro", "role": "computer", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Laptop lid is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.22, "depth": 0.012, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.42, 0.96, -1.26], "rotation": [-0.85, 0, 0], "scale": [0.36, 0.22, 0.012]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "laptop-lid", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_laptop_lid_50.add(mesh_laptop_lid_50);
  meshes["laptop-lid"] = mesh_laptop_lid_50;
  colliders["laptop-lid"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["laptop-lid"] ??= [];
  destructionGroups["laptop-lid"].push(node_laptop_lid_50);

  const endpoint_keyboard_51 = makeAttachmentEndpoint(null);
  const node_keyboard_51 = new THREE.Group();
  node_keyboard_51.name = "Keyboard__pivot";
  node_keyboard_51.scale.set(1, 1, 1);
  if (endpoint_keyboard_51) {
    node_keyboard_51.position.copy(endpoint_keyboard_51.start);
    node_keyboard_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_keyboard_51.position.set(-1.05, 0.78, -1.02);
    node_keyboard_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_keyboard_51.userData.sculptComponent = {"id": "keyboard", "name": "Keyboard", "level": "macro", "role": "peripheral", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Keyboard is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.02, "depth": 0.12, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.05, 0.78, -1.02], "rotation": [0, 0, 0], "scale": [0.34, 0.02, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_keyboard_51.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_keyboard_51);
  nodes["keyboard"] = node_keyboard_51;
  const mesh_keyboard_51Geometry = endpoint_keyboard_51
    ? new THREE.CylinderGeometry(endpoint_keyboard_51.endRadius, endpoint_keyboard_51.baseRadius, endpoint_keyboard_51.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_keyboard_51) {
    mesh_keyboard_51Geometry.scale(0.34, 0.02, 0.12);
  }
  const mesh_keyboard_51 = new THREE.Mesh(
    mesh_keyboard_51Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_keyboard_51.name = "Keyboard";
  if (endpoint_keyboard_51) {
    mesh_keyboard_51.position.copy(endpoint_keyboard_51.midpoint);
    mesh_keyboard_51.quaternion.copy(endpoint_keyboard_51.quaternion);
  }
  mesh_keyboard_51.castShadow = options.castShadow ?? true;
  mesh_keyboard_51.receiveShadow = options.receiveShadow ?? true;
  mesh_keyboard_51.userData.sculptComponent = {"id": "keyboard", "name": "Keyboard", "level": "macro", "role": "peripheral", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Keyboard is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.02, "depth": 0.12, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.05, 0.78, -1.02], "rotation": [0, 0, 0], "scale": [0.34, 0.02, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "keyboard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_keyboard_51.add(mesh_keyboard_51);
  meshes["keyboard"] = mesh_keyboard_51;
  colliders["keyboard"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["keyboard"] ??= [];
  destructionGroups["keyboard"].push(node_keyboard_51);

  const endpoint_chair_seat_52 = makeAttachmentEndpoint(null);
  const node_chair_seat_52 = new THREE.Group();
  node_chair_seat_52.name = "Chair seat__pivot";
  node_chair_seat_52.scale.set(1, 1, 1);
  if (endpoint_chair_seat_52) {
    node_chair_seat_52.position.copy(endpoint_chair_seat_52.start);
    node_chair_seat_52.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_seat_52.position.set(-0.65, 0.48, -0.52);
    node_chair_seat_52.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_seat_52.userData.sculptComponent = {"id": "chair-seat", "name": "Chair seat", "level": "macro", "role": "seat", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair seat is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.52, "height": 0.1, "depth": 0.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.48, -0.52], "rotation": [0, 0, 0], "scale": [0.52, 0.1, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}}, "material": "chair", "materialLayers": ["chair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 46, 1.0)", "secondaryAlbedo": "rgba(34, 34, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_seat_52.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}};
  (nodes["root"] ?? root).add(node_chair_seat_52);
  nodes["chair-seat"] = node_chair_seat_52;
  const mesh_chair_seat_52Geometry = endpoint_chair_seat_52
    ? new THREE.CylinderGeometry(endpoint_chair_seat_52.endRadius, endpoint_chair_seat_52.baseRadius, endpoint_chair_seat_52.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_seat_52) {
    mesh_chair_seat_52Geometry.scale(0.52, 0.1, 0.5);
  }
  const mesh_chair_seat_52 = new THREE.Mesh(
    mesh_chair_seat_52Geometry,
    materialMap["chair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_seat_52.name = "Chair seat";
  if (endpoint_chair_seat_52) {
    mesh_chair_seat_52.position.copy(endpoint_chair_seat_52.midpoint);
    mesh_chair_seat_52.quaternion.copy(endpoint_chair_seat_52.quaternion);
  }
  mesh_chair_seat_52.castShadow = options.castShadow ?? true;
  mesh_chair_seat_52.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_seat_52.userData.sculptComponent = {"id": "chair-seat", "name": "Chair seat", "level": "macro", "role": "seat", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair seat is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.52, "height": 0.1, "depth": 0.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.48, -0.52], "rotation": [0, 0, 0], "scale": [0.52, 0.1, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}}, "material": "chair", "materialLayers": ["chair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 46, 1.0)", "secondaryAlbedo": "rgba(34, 34, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_seat_52.add(mesh_chair_seat_52);
  meshes["chair-seat"] = mesh_chair_seat_52;
  colliders["chair-seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-seat"] ??= [];
  destructionGroups["chair-seat"].push(node_chair_seat_52);

  const endpoint_chair_back_53 = makeAttachmentEndpoint(null);
  const node_chair_back_53 = new THREE.Group();
  node_chair_back_53.name = "Chair back__pivot";
  node_chair_back_53.scale.set(1, 1, 1);
  if (endpoint_chair_back_53) {
    node_chair_back_53.position.copy(endpoint_chair_back_53.start);
    node_chair_back_53.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_back_53.position.set(-0.65, 0.9, -0.3);
    node_chair_back_53.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_back_53.userData.sculptComponent = {"id": "chair-back", "name": "Chair back", "level": "macro", "role": "backrest", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair back is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.5, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.9, -0.3], "rotation": [0, 0, 0], "scale": [0.5, 0.62, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}}, "material": "chair", "materialLayers": ["chair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 46, 1.0)", "secondaryAlbedo": "rgba(34, 34, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_back_53.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}};
  (nodes["root"] ?? root).add(node_chair_back_53);
  nodes["chair-back"] = node_chair_back_53;
  const mesh_chair_back_53Geometry = endpoint_chair_back_53
    ? new THREE.CylinderGeometry(endpoint_chair_back_53.endRadius, endpoint_chair_back_53.baseRadius, endpoint_chair_back_53.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_back_53) {
    mesh_chair_back_53Geometry.scale(0.5, 0.62, 0.1);
  }
  const mesh_chair_back_53 = new THREE.Mesh(
    mesh_chair_back_53Geometry,
    materialMap["chair"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_back_53.name = "Chair back";
  if (endpoint_chair_back_53) {
    mesh_chair_back_53.position.copy(endpoint_chair_back_53.midpoint);
    mesh_chair_back_53.quaternion.copy(endpoint_chair_back_53.quaternion);
  }
  mesh_chair_back_53.castShadow = options.castShadow ?? true;
  mesh_chair_back_53.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_back_53.userData.sculptComponent = {"id": "chair-back", "name": "Chair back", "level": "macro", "role": "backrest", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair back is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.5, "height": 0.62, "depth": 0.1, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.9, -0.3], "rotation": [0, 0, 0], "scale": [0.5, 0.62, 0.1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-back", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chair"}}, "material": "chair", "materialLayers": ["chair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(42, 42, 46, 1.0)", "secondaryAlbedo": "rgba(34, 34, 37, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_back_53.add(mesh_chair_back_53);
  meshes["chair-back"] = mesh_chair_back_53;
  colliders["chair-back"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-back"] ??= [];
  destructionGroups["chair-back"].push(node_chair_back_53);

  const endpoint_chair_side_a_54 = makeAttachmentEndpoint(null);
  const node_chair_side_a_54 = new THREE.Group();
  node_chair_side_a_54.name = "Chair side A__pivot";
  node_chair_side_a_54.scale.set(1, 1, 1);
  if (endpoint_chair_side_a_54) {
    node_chair_side_a_54.position.copy(endpoint_chair_side_a_54.start);
    node_chair_side_a_54.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_side_a_54.position.set(-0.9, 0.85, -0.32);
    node_chair_side_a_54.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_side_a_54.userData.sculptComponent = {"id": "chair-side-a", "name": "Chair side A", "level": "macro", "role": "bolster", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair side A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 0.4, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.9, 0.85, -0.32], "rotation": [0, 0, 0], "scale": [0.06, 0.4, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_side_a_54.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}};
  (nodes["root"] ?? root).add(node_chair_side_a_54);
  nodes["chair-side-a"] = node_chair_side_a_54;
  const mesh_chair_side_a_54Geometry = endpoint_chair_side_a_54
    ? new THREE.CylinderGeometry(endpoint_chair_side_a_54.endRadius, endpoint_chair_side_a_54.baseRadius, endpoint_chair_side_a_54.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_side_a_54) {
    mesh_chair_side_a_54Geometry.scale(0.06, 0.4, 0.08);
  }
  const mesh_chair_side_a_54 = new THREE.Mesh(
    mesh_chair_side_a_54Geometry,
    materialMap["plastic-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_side_a_54.name = "Chair side A";
  if (endpoint_chair_side_a_54) {
    mesh_chair_side_a_54.position.copy(endpoint_chair_side_a_54.midpoint);
    mesh_chair_side_a_54.quaternion.copy(endpoint_chair_side_a_54.quaternion);
  }
  mesh_chair_side_a_54.castShadow = options.castShadow ?? true;
  mesh_chair_side_a_54.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_side_a_54.userData.sculptComponent = {"id": "chair-side-a", "name": "Chair side A", "level": "macro", "role": "bolster", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair side A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 0.4, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.9, 0.85, -0.32], "rotation": [0, 0, 0], "scale": [0.06, 0.4, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_side_a_54.add(mesh_chair_side_a_54);
  meshes["chair-side-a"] = mesh_chair_side_a_54;
  colliders["chair-side-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-side-a"] ??= [];
  destructionGroups["chair-side-a"].push(node_chair_side_a_54);

  const endpoint_chair_side_b_55 = makeAttachmentEndpoint(null);
  const node_chair_side_b_55 = new THREE.Group();
  node_chair_side_b_55.name = "Chair side B__pivot";
  node_chair_side_b_55.scale.set(1, 1, 1);
  if (endpoint_chair_side_b_55) {
    node_chair_side_b_55.position.copy(endpoint_chair_side_b_55.start);
    node_chair_side_b_55.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_side_b_55.position.set(-0.4, 0.85, -0.32);
    node_chair_side_b_55.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_side_b_55.userData.sculptComponent = {"id": "chair-side-b", "name": "Chair side B", "level": "macro", "role": "bolster", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair side B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 0.4, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.4, 0.85, -0.32], "rotation": [0, 0, 0], "scale": [0.06, 0.4, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_side_b_55.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}};
  (nodes["root"] ?? root).add(node_chair_side_b_55);
  nodes["chair-side-b"] = node_chair_side_b_55;
  const mesh_chair_side_b_55Geometry = endpoint_chair_side_b_55
    ? new THREE.CylinderGeometry(endpoint_chair_side_b_55.endRadius, endpoint_chair_side_b_55.baseRadius, endpoint_chair_side_b_55.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_side_b_55) {
    mesh_chair_side_b_55Geometry.scale(0.06, 0.4, 0.08);
  }
  const mesh_chair_side_b_55 = new THREE.Mesh(
    mesh_chair_side_b_55Geometry,
    materialMap["plastic-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_side_b_55.name = "Chair side B";
  if (endpoint_chair_side_b_55) {
    mesh_chair_side_b_55.position.copy(endpoint_chair_side_b_55.midpoint);
    mesh_chair_side_b_55.quaternion.copy(endpoint_chair_side_b_55.quaternion);
  }
  mesh_chair_side_b_55.castShadow = options.castShadow ?? true;
  mesh_chair_side_b_55.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_side_b_55.userData.sculptComponent = {"id": "chair-side-b", "name": "Chair side B", "level": "macro", "role": "bolster", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair side B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 0.4, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.4, 0.85, -0.32], "rotation": [0, 0, 0], "scale": [0.06, 0.4, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-side-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-grey"}}, "material": "plastic-grey", "materialLayers": ["plastic-grey"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(141, 143, 151, 1.0)", "secondaryAlbedo": "rgba(115, 117, 123, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_side_b_55.add(mesh_chair_side_b_55);
  meshes["chair-side-b"] = mesh_chair_side_b_55;
  colliders["chair-side-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-side-b"] ??= [];
  destructionGroups["chair-side-b"].push(node_chair_side_b_55);

  const attachment_chair_column_56 = null;
  const endpoint_chair_column_56 = makeAttachmentEndpoint(attachment_chair_column_56);
  const node_chair_column_56 = new THREE.Group();
  node_chair_column_56.name = "Chair column__pivot";
  node_chair_column_56.scale.set(1, 1, 1);
  if (endpoint_chair_column_56) {
    node_chair_column_56.position.copy(endpoint_chair_column_56.start);
    node_chair_column_56.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_column_56.position.set(-0.65, 0.24, -0.52);
    node_chair_column_56.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_column_56.userData.sculptComponent = {"id": "chair-column", "name": "Chair column", "level": "macro", "role": "column", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Chair column is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 0.32, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.24, -0.52], "rotation": [0, 0, 0], "scale": [0.08, 0.32, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-column", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_column_56.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-column", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_column_56);
  nodes["chair-column"] = node_chair_column_56;
  const mesh_chair_column_56Geometry = endpoint_chair_column_56
    ? new THREE.CylinderGeometry(endpoint_chair_column_56.endRadius, endpoint_chair_column_56.baseRadius, endpoint_chair_column_56.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_chair_column_56) {
    mesh_chair_column_56Geometry.scale(0.08, 0.32, 0.08);
  }
  const mesh_chair_column_56 = new THREE.Mesh(
    mesh_chair_column_56Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_column_56.name = "Chair column";
  if (endpoint_chair_column_56) {
    mesh_chair_column_56.position.copy(endpoint_chair_column_56.midpoint);
    mesh_chair_column_56.quaternion.copy(endpoint_chair_column_56.quaternion);
  }
  mesh_chair_column_56.castShadow = options.castShadow ?? true;
  mesh_chair_column_56.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_column_56.userData.sculptComponent = {"id": "chair-column", "name": "Chair column", "level": "macro", "role": "column", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Chair column is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.08, "height": 0.32, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.24, -0.52], "rotation": [0, 0, 0], "scale": [0.08, 0.32, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-column", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_column_56.add(mesh_chair_column_56);
  meshes["chair-column"] = mesh_chair_column_56;
  colliders["chair-column"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-column"] ??= [];
  destructionGroups["chair-column"].push(node_chair_column_56);

  const attachment_chair_hub_57 = null;
  const endpoint_chair_hub_57 = makeAttachmentEndpoint(attachment_chair_hub_57);
  const node_chair_hub_57 = new THREE.Group();
  node_chair_hub_57.name = "Chair hub__pivot";
  node_chair_hub_57.scale.set(1, 1, 1);
  if (endpoint_chair_hub_57) {
    node_chair_hub_57.position.copy(endpoint_chair_hub_57.start);
    node_chair_hub_57.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chair_hub_57.position.set(-0.65, 0.08, -0.52);
    node_chair_hub_57.rotation.set(0.0, 0.0, 0.0);
  }
  node_chair_hub_57.userData.sculptComponent = {"id": "chair-hub", "name": "Chair hub", "level": "macro", "role": "hub", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Chair hub is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.12, "height": 0.04, "depth": 0.12, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.08, -0.52], "rotation": [0, 0, 0], "scale": [0.12, 0.04, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-hub", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_hub_57.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-hub", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_hub_57);
  nodes["chair-hub"] = node_chair_hub_57;
  const mesh_chair_hub_57Geometry = endpoint_chair_hub_57
    ? new THREE.CylinderGeometry(endpoint_chair_hub_57.endRadius, endpoint_chair_hub_57.baseRadius, endpoint_chair_hub_57.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_chair_hub_57) {
    mesh_chair_hub_57Geometry.scale(0.12, 0.04, 0.12);
  }
  const mesh_chair_hub_57 = new THREE.Mesh(
    mesh_chair_hub_57Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_hub_57.name = "Chair hub";
  if (endpoint_chair_hub_57) {
    mesh_chair_hub_57.position.copy(endpoint_chair_hub_57.midpoint);
    mesh_chair_hub_57.quaternion.copy(endpoint_chair_hub_57.quaternion);
  }
  mesh_chair_hub_57.castShadow = options.castShadow ?? true;
  mesh_chair_hub_57.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_hub_57.userData.sculptComponent = {"id": "chair-hub", "name": "Chair hub", "level": "macro", "role": "hub", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Chair hub is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.12, "height": 0.04, "depth": 0.12, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.65, 0.08, -0.52], "rotation": [0, 0, 0], "scale": [0.12, 0.04, 0.12]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-hub", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_hub_57.add(mesh_chair_hub_57);
  meshes["chair-hub"] = mesh_chair_hub_57;
  colliders["chair-hub"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-hub"] ??= [];
  destructionGroups["chair-hub"].push(node_chair_hub_57);

  const endpoint_chair_spoke_0_58 = makeAttachmentEndpoint(null);
  const node_chair_spoke_0_58 = new THREE.Group();
  node_chair_spoke_0_58.name = "Chair spoke 0__pivot";
  node_chair_spoke_0_58.scale.set(1, 1, 1);
  if (endpoint_chair_spoke_0_58) {
    node_chair_spoke_0_58.position.copy(endpoint_chair_spoke_0_58.start);
    node_chair_spoke_0_58.rotation.set(0.0, -0.0, 0.0);
  } else {
    node_chair_spoke_0_58.position.set(-0.49, 0.07, -0.52);
    node_chair_spoke_0_58.rotation.set(0.0, -0.0, 0.0);
  }
  node_chair_spoke_0_58.userData.sculptComponent = {"id": "chair-spoke-0", "name": "Chair spoke 0", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.49, 0.07, -0.52], "rotation": [0, -0.0, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_0_58.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_spoke_0_58);
  nodes["chair-spoke-0"] = node_chair_spoke_0_58;
  const mesh_chair_spoke_0_58Geometry = endpoint_chair_spoke_0_58
    ? new THREE.CylinderGeometry(endpoint_chair_spoke_0_58.endRadius, endpoint_chair_spoke_0_58.baseRadius, endpoint_chair_spoke_0_58.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_spoke_0_58) {
    mesh_chair_spoke_0_58Geometry.scale(0.28, 0.025, 0.045);
  }
  const mesh_chair_spoke_0_58 = new THREE.Mesh(
    mesh_chair_spoke_0_58Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_spoke_0_58.name = "Chair spoke 0";
  if (endpoint_chair_spoke_0_58) {
    mesh_chair_spoke_0_58.position.copy(endpoint_chair_spoke_0_58.midpoint);
    mesh_chair_spoke_0_58.quaternion.copy(endpoint_chair_spoke_0_58.quaternion);
  }
  mesh_chair_spoke_0_58.castShadow = options.castShadow ?? true;
  mesh_chair_spoke_0_58.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_spoke_0_58.userData.sculptComponent = {"id": "chair-spoke-0", "name": "Chair spoke 0", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.49, 0.07, -0.52], "rotation": [0, -0.0, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_0_58.add(mesh_chair_spoke_0_58);
  meshes["chair-spoke-0"] = mesh_chair_spoke_0_58;
  colliders["chair-spoke-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-spoke-0"] ??= [];
  destructionGroups["chair-spoke-0"].push(node_chair_spoke_0_58);

  const endpoint_caster_0_59 = makeAttachmentEndpoint(null);
  const node_caster_0_59 = new THREE.Group();
  node_caster_0_59.name = "Caster 0__pivot";
  node_caster_0_59.scale.set(1, 1, 1);
  if (endpoint_caster_0_59) {
    node_caster_0_59.position.copy(endpoint_caster_0_59.start);
    node_caster_0_59.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_caster_0_59.position.set(-0.37, 0.04, -0.52);
    node_caster_0_59.rotation.set(0.0, 0.0, 0.0);
  }
  node_caster_0_59.userData.sculptComponent = {"id": "caster-0", "name": "Caster 0", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 0 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.37, 0.04, -0.52], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_0_59.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_caster_0_59);
  nodes["caster-0"] = node_caster_0_59;
  const mesh_caster_0_59Geometry = endpoint_caster_0_59
    ? new THREE.CylinderGeometry(endpoint_caster_0_59.endRadius, endpoint_caster_0_59.baseRadius, endpoint_caster_0_59.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_caster_0_59) {
    mesh_caster_0_59Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_caster_0_59 = new THREE.Mesh(
    mesh_caster_0_59Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caster_0_59.name = "Caster 0";
  if (endpoint_caster_0_59) {
    mesh_caster_0_59.position.copy(endpoint_caster_0_59.midpoint);
    mesh_caster_0_59.quaternion.copy(endpoint_caster_0_59.quaternion);
  }
  mesh_caster_0_59.castShadow = options.castShadow ?? true;
  mesh_caster_0_59.receiveShadow = options.receiveShadow ?? true;
  mesh_caster_0_59.userData.sculptComponent = {"id": "caster-0", "name": "Caster 0", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 0 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.37, 0.04, -0.52], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_0_59.add(mesh_caster_0_59);
  meshes["caster-0"] = mesh_caster_0_59;
  colliders["caster-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["caster-0"] ??= [];
  destructionGroups["caster-0"].push(node_caster_0_59);

  const endpoint_chair_spoke_1_60 = makeAttachmentEndpoint(null);
  const node_chair_spoke_1_60 = new THREE.Group();
  node_chair_spoke_1_60.name = "Chair spoke 1__pivot";
  node_chair_spoke_1_60.scale.set(1, 1, 1);
  if (endpoint_chair_spoke_1_60) {
    node_chair_spoke_1_60.position.copy(endpoint_chair_spoke_1_60.start);
    node_chair_spoke_1_60.rotation.set(0.0, -1.2566370614359172, 0.0);
  } else {
    node_chair_spoke_1_60.position.set(-0.6005572809000084, 0.07, -0.36783095739277544);
    node_chair_spoke_1_60.rotation.set(0.0, -1.2566370614359172, 0.0);
  }
  node_chair_spoke_1_60.userData.sculptComponent = {"id": "chair-spoke-1", "name": "Chair spoke 1", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.6005572809000084, 0.07, -0.36783095739277544], "rotation": [0, -1.2566370614359172, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_1_60.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_spoke_1_60);
  nodes["chair-spoke-1"] = node_chair_spoke_1_60;
  const mesh_chair_spoke_1_60Geometry = endpoint_chair_spoke_1_60
    ? new THREE.CylinderGeometry(endpoint_chair_spoke_1_60.endRadius, endpoint_chair_spoke_1_60.baseRadius, endpoint_chair_spoke_1_60.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_spoke_1_60) {
    mesh_chair_spoke_1_60Geometry.scale(0.28, 0.025, 0.045);
  }
  const mesh_chair_spoke_1_60 = new THREE.Mesh(
    mesh_chair_spoke_1_60Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_spoke_1_60.name = "Chair spoke 1";
  if (endpoint_chair_spoke_1_60) {
    mesh_chair_spoke_1_60.position.copy(endpoint_chair_spoke_1_60.midpoint);
    mesh_chair_spoke_1_60.quaternion.copy(endpoint_chair_spoke_1_60.quaternion);
  }
  mesh_chair_spoke_1_60.castShadow = options.castShadow ?? true;
  mesh_chair_spoke_1_60.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_spoke_1_60.userData.sculptComponent = {"id": "chair-spoke-1", "name": "Chair spoke 1", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.6005572809000084, 0.07, -0.36783095739277544], "rotation": [0, -1.2566370614359172, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_1_60.add(mesh_chair_spoke_1_60);
  meshes["chair-spoke-1"] = mesh_chair_spoke_1_60;
  colliders["chair-spoke-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-spoke-1"] ??= [];
  destructionGroups["chair-spoke-1"].push(node_chair_spoke_1_60);

  const endpoint_caster_1_61 = makeAttachmentEndpoint(null);
  const node_caster_1_61 = new THREE.Group();
  node_caster_1_61.name = "Caster 1__pivot";
  node_caster_1_61.scale.set(1, 1, 1);
  if (endpoint_caster_1_61) {
    node_caster_1_61.position.copy(endpoint_caster_1_61.start);
    node_caster_1_61.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_caster_1_61.position.set(-0.5634752415750147, 0.04, -0.253704175437357);
    node_caster_1_61.rotation.set(0.0, 0.0, 0.0);
  }
  node_caster_1_61.userData.sculptComponent = {"id": "caster-1", "name": "Caster 1", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 1 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.5634752415750147, 0.04, -0.253704175437357], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_1_61.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_caster_1_61);
  nodes["caster-1"] = node_caster_1_61;
  const mesh_caster_1_61Geometry = endpoint_caster_1_61
    ? new THREE.CylinderGeometry(endpoint_caster_1_61.endRadius, endpoint_caster_1_61.baseRadius, endpoint_caster_1_61.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_caster_1_61) {
    mesh_caster_1_61Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_caster_1_61 = new THREE.Mesh(
    mesh_caster_1_61Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caster_1_61.name = "Caster 1";
  if (endpoint_caster_1_61) {
    mesh_caster_1_61.position.copy(endpoint_caster_1_61.midpoint);
    mesh_caster_1_61.quaternion.copy(endpoint_caster_1_61.quaternion);
  }
  mesh_caster_1_61.castShadow = options.castShadow ?? true;
  mesh_caster_1_61.receiveShadow = options.receiveShadow ?? true;
  mesh_caster_1_61.userData.sculptComponent = {"id": "caster-1", "name": "Caster 1", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 1 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.5634752415750147, 0.04, -0.253704175437357], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_1_61.add(mesh_caster_1_61);
  meshes["caster-1"] = mesh_caster_1_61;
  colliders["caster-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["caster-1"] ??= [];
  destructionGroups["caster-1"].push(node_caster_1_61);

  const endpoint_chair_spoke_2_62 = makeAttachmentEndpoint(null);
  const node_chair_spoke_2_62 = new THREE.Group();
  node_chair_spoke_2_62.name = "Chair spoke 2__pivot";
  node_chair_spoke_2_62.scale.set(1, 1, 1);
  if (endpoint_chair_spoke_2_62) {
    node_chair_spoke_2_62.position.copy(endpoint_chair_spoke_2_62.start);
    node_chair_spoke_2_62.rotation.set(0.0, -2.5132741228718345, 0.0);
  } else {
    node_chair_spoke_2_62.position.set(-0.7794427190999916, 0.07, -0.42595435963320427);
    node_chair_spoke_2_62.rotation.set(0.0, -2.5132741228718345, 0.0);
  }
  node_chair_spoke_2_62.userData.sculptComponent = {"id": "chair-spoke-2", "name": "Chair spoke 2", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.7794427190999916, 0.07, -0.42595435963320427], "rotation": [0, -2.5132741228718345, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_2_62.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_spoke_2_62);
  nodes["chair-spoke-2"] = node_chair_spoke_2_62;
  const mesh_chair_spoke_2_62Geometry = endpoint_chair_spoke_2_62
    ? new THREE.CylinderGeometry(endpoint_chair_spoke_2_62.endRadius, endpoint_chair_spoke_2_62.baseRadius, endpoint_chair_spoke_2_62.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_spoke_2_62) {
    mesh_chair_spoke_2_62Geometry.scale(0.28, 0.025, 0.045);
  }
  const mesh_chair_spoke_2_62 = new THREE.Mesh(
    mesh_chair_spoke_2_62Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_spoke_2_62.name = "Chair spoke 2";
  if (endpoint_chair_spoke_2_62) {
    mesh_chair_spoke_2_62.position.copy(endpoint_chair_spoke_2_62.midpoint);
    mesh_chair_spoke_2_62.quaternion.copy(endpoint_chair_spoke_2_62.quaternion);
  }
  mesh_chair_spoke_2_62.castShadow = options.castShadow ?? true;
  mesh_chair_spoke_2_62.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_spoke_2_62.userData.sculptComponent = {"id": "chair-spoke-2", "name": "Chair spoke 2", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.7794427190999916, 0.07, -0.42595435963320427], "rotation": [0, -2.5132741228718345, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_2_62.add(mesh_chair_spoke_2_62);
  meshes["chair-spoke-2"] = mesh_chair_spoke_2_62;
  colliders["chair-spoke-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-spoke-2"] ??= [];
  destructionGroups["chair-spoke-2"].push(node_chair_spoke_2_62);

  const endpoint_caster_2_63 = makeAttachmentEndpoint(null);
  const node_caster_2_63 = new THREE.Group();
  node_caster_2_63.name = "Caster 2__pivot";
  node_caster_2_63.scale.set(1, 1, 1);
  if (endpoint_caster_2_63) {
    node_caster_2_63.position.copy(endpoint_caster_2_63.start);
    node_caster_2_63.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_caster_2_63.position.set(-0.8765247584249853, 0.04, -0.3554201293581075);
    node_caster_2_63.rotation.set(0.0, 0.0, 0.0);
  }
  node_caster_2_63.userData.sculptComponent = {"id": "caster-2", "name": "Caster 2", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 2 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8765247584249853, 0.04, -0.3554201293581075], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_2_63.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_caster_2_63);
  nodes["caster-2"] = node_caster_2_63;
  const mesh_caster_2_63Geometry = endpoint_caster_2_63
    ? new THREE.CylinderGeometry(endpoint_caster_2_63.endRadius, endpoint_caster_2_63.baseRadius, endpoint_caster_2_63.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_caster_2_63) {
    mesh_caster_2_63Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_caster_2_63 = new THREE.Mesh(
    mesh_caster_2_63Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caster_2_63.name = "Caster 2";
  if (endpoint_caster_2_63) {
    mesh_caster_2_63.position.copy(endpoint_caster_2_63.midpoint);
    mesh_caster_2_63.quaternion.copy(endpoint_caster_2_63.quaternion);
  }
  mesh_caster_2_63.castShadow = options.castShadow ?? true;
  mesh_caster_2_63.receiveShadow = options.receiveShadow ?? true;
  mesh_caster_2_63.userData.sculptComponent = {"id": "caster-2", "name": "Caster 2", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 2 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8765247584249853, 0.04, -0.3554201293581075], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_2_63.add(mesh_caster_2_63);
  meshes["caster-2"] = mesh_caster_2_63;
  colliders["caster-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["caster-2"] ??= [];
  destructionGroups["caster-2"].push(node_caster_2_63);

  const endpoint_chair_spoke_3_64 = makeAttachmentEndpoint(null);
  const node_chair_spoke_3_64 = new THREE.Group();
  node_chair_spoke_3_64.name = "Chair spoke 3__pivot";
  node_chair_spoke_3_64.scale.set(1, 1, 1);
  if (endpoint_chair_spoke_3_64) {
    node_chair_spoke_3_64.position.copy(endpoint_chair_spoke_3_64.start);
    node_chair_spoke_3_64.rotation.set(0.0, -3.7699111843077517, 0.0);
  } else {
    node_chair_spoke_3_64.position.set(-0.7794427190999916, 0.07, -0.6140456403667958);
    node_chair_spoke_3_64.rotation.set(0.0, -3.7699111843077517, 0.0);
  }
  node_chair_spoke_3_64.userData.sculptComponent = {"id": "chair-spoke-3", "name": "Chair spoke 3", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.7794427190999916, 0.07, -0.6140456403667958], "rotation": [0, -3.7699111843077517, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_3_64.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_spoke_3_64);
  nodes["chair-spoke-3"] = node_chair_spoke_3_64;
  const mesh_chair_spoke_3_64Geometry = endpoint_chair_spoke_3_64
    ? new THREE.CylinderGeometry(endpoint_chair_spoke_3_64.endRadius, endpoint_chair_spoke_3_64.baseRadius, endpoint_chair_spoke_3_64.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_spoke_3_64) {
    mesh_chair_spoke_3_64Geometry.scale(0.28, 0.025, 0.045);
  }
  const mesh_chair_spoke_3_64 = new THREE.Mesh(
    mesh_chair_spoke_3_64Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_spoke_3_64.name = "Chair spoke 3";
  if (endpoint_chair_spoke_3_64) {
    mesh_chair_spoke_3_64.position.copy(endpoint_chair_spoke_3_64.midpoint);
    mesh_chair_spoke_3_64.quaternion.copy(endpoint_chair_spoke_3_64.quaternion);
  }
  mesh_chair_spoke_3_64.castShadow = options.castShadow ?? true;
  mesh_chair_spoke_3_64.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_spoke_3_64.userData.sculptComponent = {"id": "chair-spoke-3", "name": "Chair spoke 3", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 3 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.7794427190999916, 0.07, -0.6140456403667958], "rotation": [0, -3.7699111843077517, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_3_64.add(mesh_chair_spoke_3_64);
  meshes["chair-spoke-3"] = mesh_chair_spoke_3_64;
  colliders["chair-spoke-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-spoke-3"] ??= [];
  destructionGroups["chair-spoke-3"].push(node_chair_spoke_3_64);

  const endpoint_caster_3_65 = makeAttachmentEndpoint(null);
  const node_caster_3_65 = new THREE.Group();
  node_caster_3_65.name = "Caster 3__pivot";
  node_caster_3_65.scale.set(1, 1, 1);
  if (endpoint_caster_3_65) {
    node_caster_3_65.position.copy(endpoint_caster_3_65.start);
    node_caster_3_65.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_caster_3_65.position.set(-0.8765247584249853, 0.04, -0.6845798706418925);
    node_caster_3_65.rotation.set(0.0, 0.0, 0.0);
  }
  node_caster_3_65.userData.sculptComponent = {"id": "caster-3", "name": "Caster 3", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 3 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8765247584249853, 0.04, -0.6845798706418925], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_3_65.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_caster_3_65);
  nodes["caster-3"] = node_caster_3_65;
  const mesh_caster_3_65Geometry = endpoint_caster_3_65
    ? new THREE.CylinderGeometry(endpoint_caster_3_65.endRadius, endpoint_caster_3_65.baseRadius, endpoint_caster_3_65.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_caster_3_65) {
    mesh_caster_3_65Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_caster_3_65 = new THREE.Mesh(
    mesh_caster_3_65Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caster_3_65.name = "Caster 3";
  if (endpoint_caster_3_65) {
    mesh_caster_3_65.position.copy(endpoint_caster_3_65.midpoint);
    mesh_caster_3_65.quaternion.copy(endpoint_caster_3_65.quaternion);
  }
  mesh_caster_3_65.castShadow = options.castShadow ?? true;
  mesh_caster_3_65.receiveShadow = options.receiveShadow ?? true;
  mesh_caster_3_65.userData.sculptComponent = {"id": "caster-3", "name": "Caster 3", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 3 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.8765247584249853, 0.04, -0.6845798706418925], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_3_65.add(mesh_caster_3_65);
  meshes["caster-3"] = mesh_caster_3_65;
  colliders["caster-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["caster-3"] ??= [];
  destructionGroups["caster-3"].push(node_caster_3_65);

  const endpoint_chair_spoke_4_66 = makeAttachmentEndpoint(null);
  const node_chair_spoke_4_66 = new THREE.Group();
  node_chair_spoke_4_66.name = "Chair spoke 4__pivot";
  node_chair_spoke_4_66.scale.set(1, 1, 1);
  if (endpoint_chair_spoke_4_66) {
    node_chair_spoke_4_66.position.copy(endpoint_chair_spoke_4_66.start);
    node_chair_spoke_4_66.rotation.set(0.0, -5.026548245743669, 0.0);
  } else {
    node_chair_spoke_4_66.position.set(-0.6005572809000085, 0.07, -0.6721690426072247);
    node_chair_spoke_4_66.rotation.set(0.0, -5.026548245743669, 0.0);
  }
  node_chair_spoke_4_66.userData.sculptComponent = {"id": "chair-spoke-4", "name": "Chair spoke 4", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.6005572809000085, 0.07, -0.6721690426072247], "rotation": [0, -5.026548245743669, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_4_66.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_chair_spoke_4_66);
  nodes["chair-spoke-4"] = node_chair_spoke_4_66;
  const mesh_chair_spoke_4_66Geometry = endpoint_chair_spoke_4_66
    ? new THREE.CylinderGeometry(endpoint_chair_spoke_4_66.endRadius, endpoint_chair_spoke_4_66.baseRadius, endpoint_chair_spoke_4_66.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_chair_spoke_4_66) {
    mesh_chair_spoke_4_66Geometry.scale(0.28, 0.025, 0.045);
  }
  const mesh_chair_spoke_4_66 = new THREE.Mesh(
    mesh_chair_spoke_4_66Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chair_spoke_4_66.name = "Chair spoke 4";
  if (endpoint_chair_spoke_4_66) {
    mesh_chair_spoke_4_66.position.copy(endpoint_chair_spoke_4_66.midpoint);
    mesh_chair_spoke_4_66.quaternion.copy(endpoint_chair_spoke_4_66.quaternion);
  }
  mesh_chair_spoke_4_66.castShadow = options.castShadow ?? true;
  mesh_chair_spoke_4_66.receiveShadow = options.receiveShadow ?? true;
  mesh_chair_spoke_4_66.userData.sculptComponent = {"id": "chair-spoke-4", "name": "Chair spoke 4", "level": "macro", "role": "spoke", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Chair spoke 4 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.025, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.6005572809000085, 0.07, -0.6721690426072247], "rotation": [0, -5.026548245743669, 0], "scale": [0.28, 0.025, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chair-spoke-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_chair_spoke_4_66.add(mesh_chair_spoke_4_66);
  meshes["chair-spoke-4"] = mesh_chair_spoke_4_66;
  colliders["chair-spoke-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chair-spoke-4"] ??= [];
  destructionGroups["chair-spoke-4"].push(node_chair_spoke_4_66);

  const endpoint_caster_4_67 = makeAttachmentEndpoint(null);
  const node_caster_4_67 = new THREE.Group();
  node_caster_4_67.name = "Caster 4__pivot";
  node_caster_4_67.scale.set(1, 1, 1);
  if (endpoint_caster_4_67) {
    node_caster_4_67.position.copy(endpoint_caster_4_67.start);
    node_caster_4_67.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_caster_4_67.position.set(-0.5634752415750148, 0.04, -0.786295824562643);
    node_caster_4_67.rotation.set(0.0, 0.0, 0.0);
  }
  node_caster_4_67.userData.sculptComponent = {"id": "caster-4", "name": "Caster 4", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 4 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.5634752415750148, 0.04, -0.786295824562643], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_4_67.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_caster_4_67);
  nodes["caster-4"] = node_caster_4_67;
  const mesh_caster_4_67Geometry = endpoint_caster_4_67
    ? new THREE.CylinderGeometry(endpoint_caster_4_67.endRadius, endpoint_caster_4_67.baseRadius, endpoint_caster_4_67.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_caster_4_67) {
    mesh_caster_4_67Geometry.scale(0.05, 0.05, 0.05);
  }
  const mesh_caster_4_67 = new THREE.Mesh(
    mesh_caster_4_67Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_caster_4_67.name = "Caster 4";
  if (endpoint_caster_4_67) {
    mesh_caster_4_67.position.copy(endpoint_caster_4_67.midpoint);
    mesh_caster_4_67.quaternion.copy(endpoint_caster_4_67.quaternion);
  }
  mesh_caster_4_67.castShadow = options.castShadow ?? true;
  mesh_caster_4_67.receiveShadow = options.receiveShadow ?? true;
  mesh_caster_4_67.userData.sculptComponent = {"id": "caster-4", "name": "Caster 4", "level": "macro", "role": "caster", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Caster 4 is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.05, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.5634752415750148, 0.04, -0.786295824562643], "rotation": [0, 0, 0], "scale": [0.05, 0.05, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "caster-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_caster_4_67.add(mesh_caster_4_67);
  meshes["caster-4"] = mesh_caster_4_67;
  colliders["caster-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["caster-4"] ??= [];
  destructionGroups["caster-4"].push(node_caster_4_67);

  const endpoint_sofa_body_68 = makeAttachmentEndpoint(null);
  const node_sofa_body_68 = new THREE.Group();
  node_sofa_body_68.name = "Sofa body__pivot";
  node_sofa_body_68.scale.set(1, 1, 1);
  if (endpoint_sofa_body_68) {
    node_sofa_body_68.position.copy(endpoint_sofa_body_68.start);
    node_sofa_body_68.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sofa_body_68.position.set(0.15, 0.32, 0.82);
    node_sofa_body_68.rotation.set(0.0, 0.0, 0.0);
  }
  node_sofa_body_68.userData.sculptComponent = {"id": "sofa-body", "name": "Sofa body", "level": "macro", "role": "seat", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sofa body is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.75, "height": 0.42, "depth": 0.62, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 0.32, 0.82], "rotation": [0, 0, 0], "scale": [1.75, 0.42, 0.62]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}}, "material": "fabric-sofa", "materialLayers": ["fabric-sofa"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 101, 120, 1.0)", "secondaryAlbedo": "rgba(86, 82, 98, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_sofa_body_68.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}};
  (nodes["root"] ?? root).add(node_sofa_body_68);
  nodes["sofa-body"] = node_sofa_body_68;
  const mesh_sofa_body_68Geometry = endpoint_sofa_body_68
    ? new THREE.CylinderGeometry(endpoint_sofa_body_68.endRadius, endpoint_sofa_body_68.baseRadius, endpoint_sofa_body_68.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_sofa_body_68) {
    mesh_sofa_body_68Geometry.scale(1.75, 0.42, 0.62);
  }
  const mesh_sofa_body_68 = new THREE.Mesh(
    mesh_sofa_body_68Geometry,
    materialMap["fabric-sofa"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sofa_body_68.name = "Sofa body";
  if (endpoint_sofa_body_68) {
    mesh_sofa_body_68.position.copy(endpoint_sofa_body_68.midpoint);
    mesh_sofa_body_68.quaternion.copy(endpoint_sofa_body_68.quaternion);
  }
  mesh_sofa_body_68.castShadow = options.castShadow ?? true;
  mesh_sofa_body_68.receiveShadow = options.receiveShadow ?? true;
  mesh_sofa_body_68.userData.sculptComponent = {"id": "sofa-body", "name": "Sofa body", "level": "macro", "role": "seat", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sofa body is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.75, "height": 0.42, "depth": 0.62, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 0.32, 0.82], "rotation": [0, 0, 0], "scale": [1.75, 0.42, 0.62]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}}, "material": "fabric-sofa", "materialLayers": ["fabric-sofa"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 101, 120, 1.0)", "secondaryAlbedo": "rgba(86, 82, 98, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_sofa_body_68.add(mesh_sofa_body_68);
  meshes["sofa-body"] = mesh_sofa_body_68;
  colliders["sofa-body"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sofa-body"] ??= [];
  destructionGroups["sofa-body"].push(node_sofa_body_68);

  const endpoint_sofa_backrest_69 = makeAttachmentEndpoint(null);
  const node_sofa_backrest_69 = new THREE.Group();
  node_sofa_backrest_69.name = "Sofa backrest__pivot";
  node_sofa_backrest_69.scale.set(1, 1, 1);
  if (endpoint_sofa_backrest_69) {
    node_sofa_backrest_69.position.copy(endpoint_sofa_backrest_69.start);
    node_sofa_backrest_69.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_sofa_backrest_69.position.set(0.15, 0.62, 1.12);
    node_sofa_backrest_69.rotation.set(0.0, 0.0, 0.0);
  }
  node_sofa_backrest_69.userData.sculptComponent = {"id": "sofa-backrest", "name": "Sofa backrest", "level": "macro", "role": "backrest", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sofa backrest is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.75, "height": 0.5, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 0.62, 1.12], "rotation": [0, 0, 0], "scale": [1.75, 0.5, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-backrest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}}, "material": "fabric-sofa", "materialLayers": ["fabric-sofa"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sofa-blue-rim", "kind": "contour", "note": "blue wash outlines the sofa back"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 101, 120, 1.0)", "secondaryAlbedo": "rgba(86, 82, 98, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_sofa_backrest_69.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-backrest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}};
  (nodes["root"] ?? root).add(node_sofa_backrest_69);
  nodes["sofa-backrest"] = node_sofa_backrest_69;
  const mesh_sofa_backrest_69Geometry = endpoint_sofa_backrest_69
    ? new THREE.CylinderGeometry(endpoint_sofa_backrest_69.endRadius, endpoint_sofa_backrest_69.baseRadius, endpoint_sofa_backrest_69.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_sofa_backrest_69) {
    mesh_sofa_backrest_69Geometry.scale(1.75, 0.5, 0.14);
  }
  const mesh_sofa_backrest_69 = new THREE.Mesh(
    mesh_sofa_backrest_69Geometry,
    materialMap["fabric-sofa"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sofa_backrest_69.name = "Sofa backrest";
  if (endpoint_sofa_backrest_69) {
    mesh_sofa_backrest_69.position.copy(endpoint_sofa_backrest_69.midpoint);
    mesh_sofa_backrest_69.quaternion.copy(endpoint_sofa_backrest_69.quaternion);
  }
  mesh_sofa_backrest_69.castShadow = options.castShadow ?? true;
  mesh_sofa_backrest_69.receiveShadow = options.receiveShadow ?? true;
  mesh_sofa_backrest_69.userData.sculptComponent = {"id": "sofa-backrest", "name": "Sofa backrest", "level": "macro", "role": "backrest", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sofa backrest is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 1.75, "height": 0.5, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 0.62, 1.12], "rotation": [0, 0, 0], "scale": [1.75, 0.5, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa-backrest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "fabric-sofa"}}, "material": "fabric-sofa", "materialLayers": ["fabric-sofa"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "sofa-blue-rim", "kind": "contour", "note": "blue wash outlines the sofa back"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 101, 120, 1.0)", "secondaryAlbedo": "rgba(86, 82, 98, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_sofa_backrest_69.add(mesh_sofa_backrest_69);
  meshes["sofa-backrest"] = mesh_sofa_backrest_69;
  colliders["sofa-backrest"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["sofa-backrest"] ??= [];
  destructionGroups["sofa-backrest"].push(node_sofa_backrest_69);

  const endpoint_table_top_70 = makeAttachmentEndpoint(null);
  const node_table_top_70 = new THREE.Group();
  node_table_top_70.name = "Table top__pivot";
  node_table_top_70.scale.set(1, 1, 1);
  if (endpoint_table_top_70) {
    node_table_top_70.position.copy(endpoint_table_top_70.start);
    node_table_top_70.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_table_top_70.position.set(0.45, 0.34, 0.15);
    node_table_top_70.rotation.set(0.0, 0.0, 0.0);
  }
  node_table_top_70.userData.sculptComponent = {"id": "table-top", "name": "Table top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Table top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 0.06, "depth": 0.48, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.45, 0.34, 0.15], "rotation": [0, 0, 0], "scale": [0.78, 0.06, 0.48]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "table-edge", "kind": "bevel", "note": "white top edge catches light"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_table_top_70.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_table_top_70);
  nodes["table-top"] = node_table_top_70;
  const mesh_table_top_70Geometry = endpoint_table_top_70
    ? new THREE.CylinderGeometry(endpoint_table_top_70.endRadius, endpoint_table_top_70.baseRadius, endpoint_table_top_70.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_table_top_70) {
    mesh_table_top_70Geometry.scale(0.78, 0.06, 0.48);
  }
  const mesh_table_top_70 = new THREE.Mesh(
    mesh_table_top_70Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_table_top_70.name = "Table top";
  if (endpoint_table_top_70) {
    mesh_table_top_70.position.copy(endpoint_table_top_70.midpoint);
    mesh_table_top_70.quaternion.copy(endpoint_table_top_70.quaternion);
  }
  mesh_table_top_70.castShadow = options.castShadow ?? true;
  mesh_table_top_70.receiveShadow = options.receiveShadow ?? true;
  mesh_table_top_70.userData.sculptComponent = {"id": "table-top", "name": "Table top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Table top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 0.06, "depth": 0.48, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.45, 0.34, 0.15], "rotation": [0, 0, 0], "scale": [0.78, 0.06, 0.48]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "table-edge", "kind": "bevel", "note": "white top edge catches light"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_table_top_70.add(mesh_table_top_70);
  meshes["table-top"] = mesh_table_top_70;
  colliders["table-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["table-top"] ??= [];
  destructionGroups["table-top"].push(node_table_top_70);

  const endpoint_table_base_71 = makeAttachmentEndpoint(null);
  const node_table_base_71 = new THREE.Group();
  node_table_base_71.name = "Table base__pivot";
  node_table_base_71.scale.set(1, 1, 1);
  if (endpoint_table_base_71) {
    node_table_base_71.position.copy(endpoint_table_base_71.start);
    node_table_base_71.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_table_base_71.position.set(0.45, 0.16, 0.15);
    node_table_base_71.rotation.set(0.0, 0.0, 0.0);
  }
  node_table_base_71.userData.sculptComponent = {"id": "table-base", "name": "Table base", "level": "macro", "role": "base", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Table base is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.58, "height": 0.24, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.45, 0.16, 0.15], "rotation": [0, 0, 0], "scale": [0.58, 0.24, 0.34]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_table_base_71.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_table_base_71);
  nodes["table-base"] = node_table_base_71;
  const mesh_table_base_71Geometry = endpoint_table_base_71
    ? new THREE.CylinderGeometry(endpoint_table_base_71.endRadius, endpoint_table_base_71.baseRadius, endpoint_table_base_71.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_table_base_71) {
    mesh_table_base_71Geometry.scale(0.58, 0.24, 0.34);
  }
  const mesh_table_base_71 = new THREE.Mesh(
    mesh_table_base_71Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_table_base_71.name = "Table base";
  if (endpoint_table_base_71) {
    mesh_table_base_71.position.copy(endpoint_table_base_71.midpoint);
    mesh_table_base_71.quaternion.copy(endpoint_table_base_71.quaternion);
  }
  mesh_table_base_71.castShadow = options.castShadow ?? true;
  mesh_table_base_71.receiveShadow = options.receiveShadow ?? true;
  mesh_table_base_71.userData.sculptComponent = {"id": "table-base", "name": "Table base", "level": "macro", "role": "base", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Table base is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.58, "height": 0.24, "depth": 0.34, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.45, 0.16, 0.15], "rotation": [0, 0, 0], "scale": [0.58, 0.24, 0.34]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "table-base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_table_base_71.add(mesh_table_base_71);
  meshes["table-base"] = mesh_table_base_71;
  colliders["table-base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["table-base"] ??= [];
  destructionGroups["table-base"].push(node_table_base_71);

  const endpoint_gamepad_72 = makeAttachmentEndpoint(null);
  const node_gamepad_72 = new THREE.Group();
  node_gamepad_72.name = "Gamepad__pivot";
  node_gamepad_72.scale.set(1, 1, 1);
  if (endpoint_gamepad_72) {
    node_gamepad_72.position.copy(endpoint_gamepad_72.start);
    node_gamepad_72.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gamepad_72.position.set(0.52, 0.39, 0.18);
    node_gamepad_72.rotation.set(0.0, 0.0, 0.0);
  }
  node_gamepad_72.userData.sculptComponent = {"id": "gamepad", "name": "Gamepad", "level": "macro", "role": "peripheral", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gamepad is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.14, "height": 0.035, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.52, 0.39, 0.18], "rotation": [0, 0, 0], "scale": [0.14, 0.035, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "gamepad", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_gamepad_72.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "gamepad", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_gamepad_72);
  nodes["gamepad"] = node_gamepad_72;
  const mesh_gamepad_72Geometry = endpoint_gamepad_72
    ? new THREE.CylinderGeometry(endpoint_gamepad_72.endRadius, endpoint_gamepad_72.baseRadius, endpoint_gamepad_72.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_gamepad_72) {
    mesh_gamepad_72Geometry.scale(0.14, 0.035, 0.08);
  }
  const mesh_gamepad_72 = new THREE.Mesh(
    mesh_gamepad_72Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gamepad_72.name = "Gamepad";
  if (endpoint_gamepad_72) {
    mesh_gamepad_72.position.copy(endpoint_gamepad_72.midpoint);
    mesh_gamepad_72.quaternion.copy(endpoint_gamepad_72.quaternion);
  }
  mesh_gamepad_72.castShadow = options.castShadow ?? true;
  mesh_gamepad_72.receiveShadow = options.receiveShadow ?? true;
  mesh_gamepad_72.userData.sculptComponent = {"id": "gamepad", "name": "Gamepad", "level": "macro", "role": "peripheral", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Gamepad is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.14, "height": 0.035, "depth": 0.08, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.52, 0.39, 0.18], "rotation": [0, 0, 0], "scale": [0.14, 0.035, 0.08]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "gamepad", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_gamepad_72.add(mesh_gamepad_72);
  meshes["gamepad"] = mesh_gamepad_72;
  colliders["gamepad"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["gamepad"] ??= [];
  destructionGroups["gamepad"].push(node_gamepad_72);

  const endpoint_octopus_head_73 = makeAttachmentEndpoint(null);
  const node_octopus_head_73 = new THREE.Group();
  node_octopus_head_73.name = "Octopus head__pivot";
  node_octopus_head_73.scale.set(1, 1, 1);
  if (endpoint_octopus_head_73) {
    node_octopus_head_73.position.copy(endpoint_octopus_head_73.start);
    node_octopus_head_73.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_octopus_head_73.position.set(1.02, 0.72, 0.78);
    node_octopus_head_73.rotation.set(0.0, 0.0, 0.0);
  }
  node_octopus_head_73.userData.sculptComponent = {"id": "octopus-head", "name": "Octopus head", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Octopus head is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.24, "depth": 0.26, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.02, 0.72, 0.78], "rotation": [0, 0, 0], "scale": [0.28, 0.24, 0.26]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "octopus-head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_octopus_head_73.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "octopus-head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_octopus_head_73);
  nodes["octopus-head"] = node_octopus_head_73;
  const mesh_octopus_head_73Geometry = endpoint_octopus_head_73
    ? new THREE.CylinderGeometry(endpoint_octopus_head_73.endRadius, endpoint_octopus_head_73.baseRadius, endpoint_octopus_head_73.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_octopus_head_73) {
    mesh_octopus_head_73Geometry.scale(0.28, 0.24, 0.26);
  }
  const mesh_octopus_head_73 = new THREE.Mesh(
    mesh_octopus_head_73Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_octopus_head_73.name = "Octopus head";
  if (endpoint_octopus_head_73) {
    mesh_octopus_head_73.position.copy(endpoint_octopus_head_73.midpoint);
    mesh_octopus_head_73.quaternion.copy(endpoint_octopus_head_73.quaternion);
  }
  mesh_octopus_head_73.castShadow = options.castShadow ?? true;
  mesh_octopus_head_73.receiveShadow = options.receiveShadow ?? true;
  mesh_octopus_head_73.userData.sculptComponent = {"id": "octopus-head", "name": "Octopus head", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Octopus head is a discrete sphere mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.24, "depth": 0.26, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.02, 0.72, 0.78], "rotation": [0, 0, 0], "scale": [0.28, 0.24, 0.26]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "octopus-head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_octopus_head_73.add(mesh_octopus_head_73);
  meshes["octopus-head"] = mesh_octopus_head_73;
  colliders["octopus-head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["octopus-head"] ??= [];
  destructionGroups["octopus-head"].push(node_octopus_head_73);

  const attachment_tentacle_0_74 = null;
  const endpoint_tentacle_0_74 = makeAttachmentEndpoint(attachment_tentacle_0_74);
  const node_tentacle_0_74 = new THREE.Group();
  node_tentacle_0_74.name = "Tentacle 0__pivot";
  node_tentacle_0_74.scale.set(1, 1, 1);
  if (endpoint_tentacle_0_74) {
    node_tentacle_0_74.position.copy(endpoint_tentacle_0_74.start);
    node_tentacle_0_74.rotation.set(-0.16, 0.0, 0.22);
  } else {
    node_tentacle_0_74.position.set(1.2, 0.32, 0.62);
    node_tentacle_0_74.rotation.set(-0.16, 0.0, 0.22);
  }
  node_tentacle_0_74.userData.sculptComponent = {"id": "tentacle-0", "name": "Tentacle 0", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 0 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.62], "rotation": [-0.16, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_0_74.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_tentacle_0_74);
  nodes["tentacle-0"] = node_tentacle_0_74;
  const mesh_tentacle_0_74Geometry = endpoint_tentacle_0_74
    ? new THREE.CylinderGeometry(endpoint_tentacle_0_74.endRadius, endpoint_tentacle_0_74.baseRadius, endpoint_tentacle_0_74.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tentacle_0_74) {
    mesh_tentacle_0_74Geometry.scale(0.045, 0.5, 0.045);
  }
  const mesh_tentacle_0_74 = new THREE.Mesh(
    mesh_tentacle_0_74Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tentacle_0_74.name = "Tentacle 0";
  if (endpoint_tentacle_0_74) {
    mesh_tentacle_0_74.position.copy(endpoint_tentacle_0_74.midpoint);
    mesh_tentacle_0_74.quaternion.copy(endpoint_tentacle_0_74.quaternion);
  }
  mesh_tentacle_0_74.castShadow = options.castShadow ?? true;
  mesh_tentacle_0_74.receiveShadow = options.receiveShadow ?? true;
  mesh_tentacle_0_74.userData.sculptComponent = {"id": "tentacle-0", "name": "Tentacle 0", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 0 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.62], "rotation": [-0.16, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_0_74.add(mesh_tentacle_0_74);
  meshes["tentacle-0"] = mesh_tentacle_0_74;
  colliders["tentacle-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tentacle-0"] ??= [];
  destructionGroups["tentacle-0"].push(node_tentacle_0_74);

  const attachment_tentacle_1_75 = null;
  const endpoint_tentacle_1_75 = makeAttachmentEndpoint(attachment_tentacle_1_75);
  const node_tentacle_1_75 = new THREE.Group();
  node_tentacle_1_75.name = "Tentacle 1__pivot";
  node_tentacle_1_75.scale.set(1, 1, 1);
  if (endpoint_tentacle_1_75) {
    node_tentacle_1_75.position.copy(endpoint_tentacle_1_75.start);
    node_tentacle_1_75.rotation.set(-0.08, 0.0, 0.22);
  } else {
    node_tentacle_1_75.position.set(1.2, 0.32, 0.69);
    node_tentacle_1_75.rotation.set(-0.08, 0.0, 0.22);
  }
  node_tentacle_1_75.userData.sculptComponent = {"id": "tentacle-1", "name": "Tentacle 1", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 1 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.69], "rotation": [-0.08, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_1_75.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_tentacle_1_75);
  nodes["tentacle-1"] = node_tentacle_1_75;
  const mesh_tentacle_1_75Geometry = endpoint_tentacle_1_75
    ? new THREE.CylinderGeometry(endpoint_tentacle_1_75.endRadius, endpoint_tentacle_1_75.baseRadius, endpoint_tentacle_1_75.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tentacle_1_75) {
    mesh_tentacle_1_75Geometry.scale(0.045, 0.5, 0.045);
  }
  const mesh_tentacle_1_75 = new THREE.Mesh(
    mesh_tentacle_1_75Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tentacle_1_75.name = "Tentacle 1";
  if (endpoint_tentacle_1_75) {
    mesh_tentacle_1_75.position.copy(endpoint_tentacle_1_75.midpoint);
    mesh_tentacle_1_75.quaternion.copy(endpoint_tentacle_1_75.quaternion);
  }
  mesh_tentacle_1_75.castShadow = options.castShadow ?? true;
  mesh_tentacle_1_75.receiveShadow = options.receiveShadow ?? true;
  mesh_tentacle_1_75.userData.sculptComponent = {"id": "tentacle-1", "name": "Tentacle 1", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 1 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.69], "rotation": [-0.08, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_1_75.add(mesh_tentacle_1_75);
  meshes["tentacle-1"] = mesh_tentacle_1_75;
  colliders["tentacle-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tentacle-1"] ??= [];
  destructionGroups["tentacle-1"].push(node_tentacle_1_75);

  const attachment_tentacle_2_76 = null;
  const endpoint_tentacle_2_76 = makeAttachmentEndpoint(attachment_tentacle_2_76);
  const node_tentacle_2_76 = new THREE.Group();
  node_tentacle_2_76.name = "Tentacle 2__pivot";
  node_tentacle_2_76.scale.set(1, 1, 1);
  if (endpoint_tentacle_2_76) {
    node_tentacle_2_76.position.copy(endpoint_tentacle_2_76.start);
    node_tentacle_2_76.rotation.set(0.0, 0.0, 0.22);
  } else {
    node_tentacle_2_76.position.set(1.2, 0.32, 0.76);
    node_tentacle_2_76.rotation.set(0.0, 0.0, 0.22);
  }
  node_tentacle_2_76.userData.sculptComponent = {"id": "tentacle-2", "name": "Tentacle 2", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 2 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.76], "rotation": [0.0, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_2_76.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_tentacle_2_76);
  nodes["tentacle-2"] = node_tentacle_2_76;
  const mesh_tentacle_2_76Geometry = endpoint_tentacle_2_76
    ? new THREE.CylinderGeometry(endpoint_tentacle_2_76.endRadius, endpoint_tentacle_2_76.baseRadius, endpoint_tentacle_2_76.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tentacle_2_76) {
    mesh_tentacle_2_76Geometry.scale(0.045, 0.5, 0.045);
  }
  const mesh_tentacle_2_76 = new THREE.Mesh(
    mesh_tentacle_2_76Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tentacle_2_76.name = "Tentacle 2";
  if (endpoint_tentacle_2_76) {
    mesh_tentacle_2_76.position.copy(endpoint_tentacle_2_76.midpoint);
    mesh_tentacle_2_76.quaternion.copy(endpoint_tentacle_2_76.quaternion);
  }
  mesh_tentacle_2_76.castShadow = options.castShadow ?? true;
  mesh_tentacle_2_76.receiveShadow = options.receiveShadow ?? true;
  mesh_tentacle_2_76.userData.sculptComponent = {"id": "tentacle-2", "name": "Tentacle 2", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 2 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.76], "rotation": [0.0, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_2_76.add(mesh_tentacle_2_76);
  meshes["tentacle-2"] = mesh_tentacle_2_76;
  colliders["tentacle-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tentacle-2"] ??= [];
  destructionGroups["tentacle-2"].push(node_tentacle_2_76);

  const attachment_tentacle_3_77 = null;
  const endpoint_tentacle_3_77 = makeAttachmentEndpoint(attachment_tentacle_3_77);
  const node_tentacle_3_77 = new THREE.Group();
  node_tentacle_3_77.name = "Tentacle 3__pivot";
  node_tentacle_3_77.scale.set(1, 1, 1);
  if (endpoint_tentacle_3_77) {
    node_tentacle_3_77.position.copy(endpoint_tentacle_3_77.start);
    node_tentacle_3_77.rotation.set(0.08, 0.0, 0.22);
  } else {
    node_tentacle_3_77.position.set(1.2, 0.32, 0.83);
    node_tentacle_3_77.rotation.set(0.08, 0.0, 0.22);
  }
  node_tentacle_3_77.userData.sculptComponent = {"id": "tentacle-3", "name": "Tentacle 3", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 3 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.83], "rotation": [0.08, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_3_77.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_tentacle_3_77);
  nodes["tentacle-3"] = node_tentacle_3_77;
  const mesh_tentacle_3_77Geometry = endpoint_tentacle_3_77
    ? new THREE.CylinderGeometry(endpoint_tentacle_3_77.endRadius, endpoint_tentacle_3_77.baseRadius, endpoint_tentacle_3_77.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tentacle_3_77) {
    mesh_tentacle_3_77Geometry.scale(0.045, 0.5, 0.045);
  }
  const mesh_tentacle_3_77 = new THREE.Mesh(
    mesh_tentacle_3_77Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tentacle_3_77.name = "Tentacle 3";
  if (endpoint_tentacle_3_77) {
    mesh_tentacle_3_77.position.copy(endpoint_tentacle_3_77.midpoint);
    mesh_tentacle_3_77.quaternion.copy(endpoint_tentacle_3_77.quaternion);
  }
  mesh_tentacle_3_77.castShadow = options.castShadow ?? true;
  mesh_tentacle_3_77.receiveShadow = options.receiveShadow ?? true;
  mesh_tentacle_3_77.userData.sculptComponent = {"id": "tentacle-3", "name": "Tentacle 3", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 3 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.83], "rotation": [0.08, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_3_77.add(mesh_tentacle_3_77);
  meshes["tentacle-3"] = mesh_tentacle_3_77;
  colliders["tentacle-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tentacle-3"] ??= [];
  destructionGroups["tentacle-3"].push(node_tentacle_3_77);

  const attachment_tentacle_4_78 = null;
  const endpoint_tentacle_4_78 = makeAttachmentEndpoint(attachment_tentacle_4_78);
  const node_tentacle_4_78 = new THREE.Group();
  node_tentacle_4_78.name = "Tentacle 4__pivot";
  node_tentacle_4_78.scale.set(1, 1, 1);
  if (endpoint_tentacle_4_78) {
    node_tentacle_4_78.position.copy(endpoint_tentacle_4_78.start);
    node_tentacle_4_78.rotation.set(0.16, 0.0, 0.22);
  } else {
    node_tentacle_4_78.position.set(1.2, 0.32, 0.8999999999999999);
    node_tentacle_4_78.rotation.set(0.16, 0.0, 0.22);
  }
  node_tentacle_4_78.userData.sculptComponent = {"id": "tentacle-4", "name": "Tentacle 4", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 4 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.8999999999999999], "rotation": [0.16, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_4_78.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}};
  (nodes["root"] ?? root).add(node_tentacle_4_78);
  nodes["tentacle-4"] = node_tentacle_4_78;
  const mesh_tentacle_4_78Geometry = endpoint_tentacle_4_78
    ? new THREE.CylinderGeometry(endpoint_tentacle_4_78.endRadius, endpoint_tentacle_4_78.baseRadius, endpoint_tentacle_4_78.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_tentacle_4_78) {
    mesh_tentacle_4_78Geometry.scale(0.045, 0.5, 0.045);
  }
  const mesh_tentacle_4_78 = new THREE.Mesh(
    mesh_tentacle_4_78Geometry,
    materialMap["octopus"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tentacle_4_78.name = "Tentacle 4";
  if (endpoint_tentacle_4_78) {
    mesh_tentacle_4_78.position.copy(endpoint_tentacle_4_78.midpoint);
    mesh_tentacle_4_78.quaternion.copy(endpoint_tentacle_4_78.quaternion);
  }
  mesh_tentacle_4_78.castShadow = options.castShadow ?? true;
  mesh_tentacle_4_78.receiveShadow = options.receiveShadow ?? true;
  mesh_tentacle_4_78.userData.sculptComponent = {"id": "tentacle-4", "name": "Tentacle 4", "level": "macro", "role": "plush", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tentacle 4 is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.045, "height": 0.5, "depth": 0.045, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.2, 0.32, 0.8999999999999999], "rotation": [0.16, 0, 0.22], "scale": [0.045, 0.5, 0.045]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tentacle-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "octopus"}}, "material": "octopus", "materialLayers": ["octopus"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 196, 212, 1.0)", "secondaryAlbedo": "rgba(164, 160, 173, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tentacle_4_78.add(mesh_tentacle_4_78);
  meshes["tentacle-4"] = mesh_tentacle_4_78;
  colliders["tentacle-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tentacle-4"] ??= [];
  destructionGroups["tentacle-4"].push(node_tentacle_4_78);

  const endpoint_tv_panel_79 = makeAttachmentEndpoint(null);
  const node_tv_panel_79 = new THREE.Group();
  node_tv_panel_79.name = "TV panel__pivot";
  node_tv_panel_79.scale.set(1, 1, 1);
  if (endpoint_tv_panel_79) {
    node_tv_panel_79.position.copy(endpoint_tv_panel_79.start);
    node_tv_panel_79.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tv_panel_79.position.set(2.16, 1.42, -0.05);
    node_tv_panel_79.rotation.set(0.0, 0.0, 0.0);
  }
  node_tv_panel_79.userData.sculptComponent = {"id": "tv-panel", "name": "TV panel", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV panel is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.92, "depth": 1.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.16, 1.42, -0.05], "rotation": [0, 0, 0], "scale": [0.05, 0.92, 1.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_panel_79.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}};
  (nodes["root"] ?? root).add(node_tv_panel_79);
  nodes["tv-panel"] = node_tv_panel_79;
  const mesh_tv_panel_79Geometry = endpoint_tv_panel_79
    ? new THREE.CylinderGeometry(endpoint_tv_panel_79.endRadius, endpoint_tv_panel_79.baseRadius, endpoint_tv_panel_79.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tv_panel_79) {
    mesh_tv_panel_79Geometry.scale(0.05, 0.92, 1.5);
  }
  const mesh_tv_panel_79 = new THREE.Mesh(
    mesh_tv_panel_79Geometry,
    materialMap["plastic-black"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tv_panel_79.name = "TV panel";
  if (endpoint_tv_panel_79) {
    mesh_tv_panel_79.position.copy(endpoint_tv_panel_79.midpoint);
    mesh_tv_panel_79.quaternion.copy(endpoint_tv_panel_79.quaternion);
  }
  mesh_tv_panel_79.castShadow = options.castShadow ?? true;
  mesh_tv_panel_79.receiveShadow = options.receiveShadow ?? true;
  mesh_tv_panel_79.userData.sculptComponent = {"id": "tv-panel", "name": "TV panel", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV panel is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.05, "height": 0.92, "depth": 1.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.16, 1.42, -0.05], "rotation": [0, 0, 0], "scale": [0.05, 0.92, 1.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-black"}}, "material": "plastic-black", "materialLayers": ["plastic-black"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 26, 26, 1.0)", "secondaryAlbedo": "rgba(21, 21, 21, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_panel_79.add(mesh_tv_panel_79);
  meshes["tv-panel"] = mesh_tv_panel_79;
  colliders["tv-panel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tv-panel"] ??= [];
  destructionGroups["tv-panel"].push(node_tv_panel_79);

  const endpoint_tv_screen_80 = makeAttachmentEndpoint(null);
  const node_tv_screen_80 = new THREE.Group();
  node_tv_screen_80.name = "TV screen__pivot";
  node_tv_screen_80.scale.set(1, 1, 1);
  if (endpoint_tv_screen_80) {
    node_tv_screen_80.position.copy(endpoint_tv_screen_80.start);
    node_tv_screen_80.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tv_screen_80.position.set(2.125, 1.42, -0.05);
    node_tv_screen_80.rotation.set(0.0, 0.0, 0.0);
  }
  node_tv_screen_80.userData.sculptComponent = {"id": "tv-screen", "name": "TV screen", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV screen is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.02, "height": 0.78, "depth": 1.32, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.125, 1.42, -0.05], "rotation": [0, 0, 0], "scale": [0.02, 0.78, 1.32]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-dark"}}, "material": "screen-dark", "materialLayers": ["screen-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "journey-wordmark", "kind": "decal", "note": "three.js journey wordmark on the upper screen"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(18, 18, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_screen_80.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-dark"}};
  (nodes["root"] ?? root).add(node_tv_screen_80);
  nodes["tv-screen"] = node_tv_screen_80;
  const mesh_tv_screen_80Geometry = endpoint_tv_screen_80
    ? new THREE.CylinderGeometry(endpoint_tv_screen_80.endRadius, endpoint_tv_screen_80.baseRadius, endpoint_tv_screen_80.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tv_screen_80) {
    mesh_tv_screen_80Geometry.scale(0.02, 0.78, 1.32);
  }
  const mesh_tv_screen_80 = new THREE.Mesh(
    mesh_tv_screen_80Geometry,
    materialMap["screen-dark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tv_screen_80.name = "TV screen";
  if (endpoint_tv_screen_80) {
    mesh_tv_screen_80.position.copy(endpoint_tv_screen_80.midpoint);
    mesh_tv_screen_80.quaternion.copy(endpoint_tv_screen_80.quaternion);
  }
  mesh_tv_screen_80.castShadow = options.castShadow ?? true;
  mesh_tv_screen_80.receiveShadow = options.receiveShadow ?? true;
  mesh_tv_screen_80.userData.sculptComponent = {"id": "tv-screen", "name": "TV screen", "level": "macro", "role": "screen", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV screen is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.02, "height": 0.78, "depth": 1.32, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.125, 1.42, -0.05], "rotation": [0, 0, 0], "scale": [0.02, 0.78, 1.32]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-screen", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "screen-dark"}}, "material": "screen-dark", "materialLayers": ["screen-dark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "journey-wordmark", "kind": "decal", "note": "three.js journey wordmark on the upper screen"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(22, 22, 22, 1.0)", "secondaryAlbedo": "rgba(18, 18, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_screen_80.add(mesh_tv_screen_80);
  meshes["tv-screen"] = mesh_tv_screen_80;
  colliders["tv-screen"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tv-screen"] ??= [];
  destructionGroups["tv-screen"].push(node_tv_screen_80);

  const endpoint_tv_wordmark_81 = makeAttachmentEndpoint(null);
  const node_tv_wordmark_81 = new THREE.Group();
  node_tv_wordmark_81.name = "TV wordmark__pivot";
  node_tv_wordmark_81.scale.set(1, 1, 1);
  if (endpoint_tv_wordmark_81) {
    node_tv_wordmark_81.position.copy(endpoint_tv_wordmark_81.start);
    node_tv_wordmark_81.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tv_wordmark_81.position.set(2.11, 1.62, -0.05);
    node_tv_wordmark_81.rotation.set(0.0, 0.0, 0.0);
  }
  node_tv_wordmark_81.userData.sculptComponent = {"id": "tv-wordmark", "name": "TV wordmark", "level": "macro", "role": "decal", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV wordmark is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.012, "height": 0.07, "depth": 0.62, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.11, 1.62, -0.05], "rotation": [0, 0, 0], "scale": [0.012, 0.07, 0.62]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-wordmark", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wordmark"}}, "material": "wordmark", "materialLayers": ["wordmark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 244, 244, 1.0)", "secondaryAlbedo": "rgba(200, 200, 200, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_wordmark_81.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-wordmark", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wordmark"}};
  (nodes["root"] ?? root).add(node_tv_wordmark_81);
  nodes["tv-wordmark"] = node_tv_wordmark_81;
  const mesh_tv_wordmark_81Geometry = endpoint_tv_wordmark_81
    ? new THREE.CylinderGeometry(endpoint_tv_wordmark_81.endRadius, endpoint_tv_wordmark_81.baseRadius, endpoint_tv_wordmark_81.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tv_wordmark_81) {
    mesh_tv_wordmark_81Geometry.scale(0.012, 0.07, 0.62);
  }
  const mesh_tv_wordmark_81 = new THREE.Mesh(
    mesh_tv_wordmark_81Geometry,
    materialMap["wordmark"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tv_wordmark_81.name = "TV wordmark";
  if (endpoint_tv_wordmark_81) {
    mesh_tv_wordmark_81.position.copy(endpoint_tv_wordmark_81.midpoint);
    mesh_tv_wordmark_81.quaternion.copy(endpoint_tv_wordmark_81.quaternion);
  }
  mesh_tv_wordmark_81.castShadow = options.castShadow ?? true;
  mesh_tv_wordmark_81.receiveShadow = options.receiveShadow ?? true;
  mesh_tv_wordmark_81.userData.sculptComponent = {"id": "tv-wordmark", "name": "TV wordmark", "level": "macro", "role": "decal", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "TV wordmark is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.012, "height": 0.07, "depth": 0.62, "units": "relative", "confidence": 0.6}, "transform": {"position": [2.11, 1.62, -0.05], "rotation": [0, 0, 0], "scale": [0.012, 0.07, 0.62]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tv-wordmark", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wordmark"}}, "material": "wordmark", "materialLayers": ["wordmark"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 244, 244, 1.0)", "secondaryAlbedo": "rgba(200, 200, 200, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_tv_wordmark_81.add(mesh_tv_wordmark_81);
  meshes["tv-wordmark"] = mesh_tv_wordmark_81;
  colliders["tv-wordmark"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["tv-wordmark"] ??= [];
  destructionGroups["tv-wordmark"].push(node_tv_wordmark_81);

  const endpoint_console_body_82 = makeAttachmentEndpoint(null);
  const node_console_body_82 = new THREE.Group();
  node_console_body_82.name = "Console body__pivot";
  node_console_body_82.scale.set(1, 1, 1);
  if (endpoint_console_body_82) {
    node_console_body_82.position.copy(endpoint_console_body_82.start);
    node_console_body_82.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_console_body_82.position.set(1.62, 0.2, -0.05);
    node_console_body_82.rotation.set(0.0, 0.0, 0.0);
  }
  node_console_body_82.userData.sculptComponent = {"id": "console-body", "name": "Console body", "level": "macro", "role": "cabinet", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console body is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.38, "height": 0.28, "depth": 1.42, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.2, -0.05], "rotation": [0, 0, 0], "scale": [0.38, 0.28, 1.42]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_body_82.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_console_body_82);
  nodes["console-body"] = node_console_body_82;
  const mesh_console_body_82Geometry = endpoint_console_body_82
    ? new THREE.CylinderGeometry(endpoint_console_body_82.endRadius, endpoint_console_body_82.baseRadius, endpoint_console_body_82.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_console_body_82) {
    mesh_console_body_82Geometry.scale(0.38, 0.28, 1.42);
  }
  const mesh_console_body_82 = new THREE.Mesh(
    mesh_console_body_82Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_console_body_82.name = "Console body";
  if (endpoint_console_body_82) {
    mesh_console_body_82.position.copy(endpoint_console_body_82.midpoint);
    mesh_console_body_82.quaternion.copy(endpoint_console_body_82.quaternion);
  }
  mesh_console_body_82.castShadow = options.castShadow ?? true;
  mesh_console_body_82.receiveShadow = options.receiveShadow ?? true;
  mesh_console_body_82.userData.sculptComponent = {"id": "console-body", "name": "Console body", "level": "macro", "role": "cabinet", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console body is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.38, "height": 0.28, "depth": 1.42, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.2, -0.05], "rotation": [0, 0, 0], "scale": [0.38, 0.28, 1.42]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_body_82.add(mesh_console_body_82);
  meshes["console-body"] = mesh_console_body_82;
  colliders["console-body"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["console-body"] ??= [];
  destructionGroups["console-body"].push(node_console_body_82);

  const endpoint_console_top_83 = makeAttachmentEndpoint(null);
  const node_console_top_83 = new THREE.Group();
  node_console_top_83.name = "Console top__pivot";
  node_console_top_83.scale.set(1, 1, 1);
  if (endpoint_console_top_83) {
    node_console_top_83.position.copy(endpoint_console_top_83.start);
    node_console_top_83.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_console_top_83.position.set(1.62, 0.36, -0.05);
    node_console_top_83.rotation.set(0.0, 0.0, 0.0);
  }
  node_console_top_83.userData.sculptComponent = {"id": "console-top", "name": "Console top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.44, "height": 0.04, "depth": 1.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.36, -0.05], "rotation": [0, 0, 0], "scale": [0.44, 0.04, 1.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_top_83.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_console_top_83);
  nodes["console-top"] = node_console_top_83;
  const mesh_console_top_83Geometry = endpoint_console_top_83
    ? new THREE.CylinderGeometry(endpoint_console_top_83.endRadius, endpoint_console_top_83.baseRadius, endpoint_console_top_83.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_console_top_83) {
    mesh_console_top_83Geometry.scale(0.44, 0.04, 1.5);
  }
  const mesh_console_top_83 = new THREE.Mesh(
    mesh_console_top_83Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_console_top_83.name = "Console top";
  if (endpoint_console_top_83) {
    mesh_console_top_83.position.copy(endpoint_console_top_83.midpoint);
    mesh_console_top_83.quaternion.copy(endpoint_console_top_83.quaternion);
  }
  mesh_console_top_83.castShadow = options.castShadow ?? true;
  mesh_console_top_83.receiveShadow = options.receiveShadow ?? true;
  mesh_console_top_83.userData.sculptComponent = {"id": "console-top", "name": "Console top", "level": "macro", "role": "top", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.44, "height": 0.04, "depth": 1.5, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.36, -0.05], "rotation": [0, 0, 0], "scale": [0.44, 0.04, 1.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_top_83.add(mesh_console_top_83);
  meshes["console-top"] = mesh_console_top_83;
  colliders["console-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["console-top"] ??= [];
  destructionGroups["console-top"].push(node_console_top_83);

  const endpoint_console_glow_84 = makeAttachmentEndpoint(null);
  const node_console_glow_84 = new THREE.Group();
  node_console_glow_84.name = "Console glow__pivot";
  node_console_glow_84.scale.set(1, 1, 1);
  if (endpoint_console_glow_84) {
    node_console_glow_84.position.copy(endpoint_console_glow_84.start);
    node_console_glow_84.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_console_glow_84.position.set(1.62, 0.05, -0.05);
    node_console_glow_84.rotation.set(0.0, 0.0, 0.0);
  }
  node_console_glow_84.userData.sculptComponent = {"id": "console-glow", "name": "Console glow", "level": "macro", "role": "light", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console glow is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.02, "depth": 1.15, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.05, -0.05], "rotation": [0, 0, 0], "scale": [0.28, 0.02, 1.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-glow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glow-cyan"}}, "material": "glow-cyan", "materialLayers": ["glow-cyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "underglow", "kind": "emissive", "note": "cyan line under the console"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 231, 225, 1.0)", "secondaryAlbedo": "rgba(103, 189, 184, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_glow_84.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-glow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glow-cyan"}};
  (nodes["root"] ?? root).add(node_console_glow_84);
  nodes["console-glow"] = node_console_glow_84;
  const mesh_console_glow_84Geometry = endpoint_console_glow_84
    ? new THREE.CylinderGeometry(endpoint_console_glow_84.endRadius, endpoint_console_glow_84.baseRadius, endpoint_console_glow_84.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_console_glow_84) {
    mesh_console_glow_84Geometry.scale(0.28, 0.02, 1.15);
  }
  const mesh_console_glow_84 = new THREE.Mesh(
    mesh_console_glow_84Geometry,
    materialMap["glow-cyan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_console_glow_84.name = "Console glow";
  if (endpoint_console_glow_84) {
    mesh_console_glow_84.position.copy(endpoint_console_glow_84.midpoint);
    mesh_console_glow_84.quaternion.copy(endpoint_console_glow_84.quaternion);
  }
  mesh_console_glow_84.castShadow = options.castShadow ?? true;
  mesh_console_glow_84.receiveShadow = options.receiveShadow ?? true;
  mesh_console_glow_84.userData.sculptComponent = {"id": "console-glow", "name": "Console glow", "level": "macro", "role": "light", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Console glow is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.02, "depth": 1.15, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.62, 0.05, -0.05], "rotation": [0, 0, 0], "scale": [0.28, 0.02, 1.15]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "console-glow", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glow-cyan"}}, "material": "glow-cyan", "materialLayers": ["glow-cyan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "underglow", "kind": "emissive", "note": "cyan line under the console"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(126, 231, 225, 1.0)", "secondaryAlbedo": "rgba(103, 189, 184, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_console_glow_84.add(mesh_console_glow_84);
  meshes["console-glow"] = mesh_console_glow_84;
  colliders["console-glow"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["console-glow"] ??= [];
  destructionGroups["console-glow"].push(node_console_glow_84);

  const endpoint_window_void_85 = makeAttachmentEndpoint(null);
  const node_window_void_85 = new THREE.Group();
  node_window_void_85.name = "Window void__pivot";
  node_window_void_85.scale.set(1, 1, 1);
  if (endpoint_window_void_85) {
    node_window_void_85.position.copy(endpoint_window_void_85.start);
    node_window_void_85.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_void_85.position.set(0.4, 1.55, -1.68);
    node_window_void_85.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_void_85.userData.sculptComponent = {"id": "window-void", "name": "Window void", "level": "macro", "role": "opening", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window void is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 1.05, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 1.55, -1.68], "rotation": [0, 0, 0], "scale": [0.78, 1.05, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-void", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "void"}}, "material": "void", "materialLayers": ["void"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 5, 5, 1.0)", "secondaryAlbedo": "rgba(4, 4, 4, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_void_85.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-void", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "void"}};
  (nodes["root"] ?? root).add(node_window_void_85);
  nodes["window-void"] = node_window_void_85;
  const mesh_window_void_85Geometry = endpoint_window_void_85
    ? new THREE.CylinderGeometry(endpoint_window_void_85.endRadius, endpoint_window_void_85.baseRadius, endpoint_window_void_85.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_void_85) {
    mesh_window_void_85Geometry.scale(0.78, 1.05, 0.04);
  }
  const mesh_window_void_85 = new THREE.Mesh(
    mesh_window_void_85Geometry,
    materialMap["void"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_void_85.name = "Window void";
  if (endpoint_window_void_85) {
    mesh_window_void_85.position.copy(endpoint_window_void_85.midpoint);
    mesh_window_void_85.quaternion.copy(endpoint_window_void_85.quaternion);
  }
  mesh_window_void_85.castShadow = options.castShadow ?? true;
  mesh_window_void_85.receiveShadow = options.receiveShadow ?? true;
  mesh_window_void_85.userData.sculptComponent = {"id": "window-void", "name": "Window void", "level": "macro", "role": "opening", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window void is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.78, "height": 1.05, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 1.55, -1.68], "rotation": [0, 0, 0], "scale": [0.78, 1.05, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-void", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "void"}}, "material": "void", "materialLayers": ["void"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 5, 5, 1.0)", "secondaryAlbedo": "rgba(4, 4, 4, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_void_85.add(mesh_window_void_85);
  meshes["window-void"] = mesh_window_void_85;
  colliders["window-void"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-void"] ??= [];
  destructionGroups["window-void"].push(node_window_void_85);

  const endpoint_window_frame_top_86 = makeAttachmentEndpoint(null);
  const node_window_frame_top_86 = new THREE.Group();
  node_window_frame_top_86.name = "Window frame top__pivot";
  node_window_frame_top_86.scale.set(1, 1, 1);
  if (endpoint_window_frame_top_86) {
    node_window_frame_top_86.position.copy(endpoint_window_frame_top_86.start);
    node_window_frame_top_86.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_frame_top_86.position.set(0.4, 2.12, -1.66);
    node_window_frame_top_86.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_frame_top_86.userData.sculptComponent = {"id": "window-frame-top", "name": "Window frame top", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.92, "height": 0.06, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 2.12, -1.66], "rotation": [0, 0, 0], "scale": [0.92, 0.06, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_top_86.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_frame_top_86);
  nodes["window-frame-top"] = node_window_frame_top_86;
  const mesh_window_frame_top_86Geometry = endpoint_window_frame_top_86
    ? new THREE.CylinderGeometry(endpoint_window_frame_top_86.endRadius, endpoint_window_frame_top_86.baseRadius, endpoint_window_frame_top_86.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_frame_top_86) {
    mesh_window_frame_top_86Geometry.scale(0.92, 0.06, 0.05);
  }
  const mesh_window_frame_top_86 = new THREE.Mesh(
    mesh_window_frame_top_86Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_frame_top_86.name = "Window frame top";
  if (endpoint_window_frame_top_86) {
    mesh_window_frame_top_86.position.copy(endpoint_window_frame_top_86.midpoint);
    mesh_window_frame_top_86.quaternion.copy(endpoint_window_frame_top_86.quaternion);
  }
  mesh_window_frame_top_86.castShadow = options.castShadow ?? true;
  mesh_window_frame_top_86.receiveShadow = options.receiveShadow ?? true;
  mesh_window_frame_top_86.userData.sculptComponent = {"id": "window-frame-top", "name": "Window frame top", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame top is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.92, "height": 0.06, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 2.12, -1.66], "rotation": [0, 0, 0], "scale": [0.92, 0.06, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_top_86.add(mesh_window_frame_top_86);
  meshes["window-frame-top"] = mesh_window_frame_top_86;
  colliders["window-frame-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-frame-top"] ??= [];
  destructionGroups["window-frame-top"].push(node_window_frame_top_86);

  const endpoint_window_frame_bottom_87 = makeAttachmentEndpoint(null);
  const node_window_frame_bottom_87 = new THREE.Group();
  node_window_frame_bottom_87.name = "Window frame bottom__pivot";
  node_window_frame_bottom_87.scale.set(1, 1, 1);
  if (endpoint_window_frame_bottom_87) {
    node_window_frame_bottom_87.position.copy(endpoint_window_frame_bottom_87.start);
    node_window_frame_bottom_87.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_frame_bottom_87.position.set(0.4, 0.98, -1.66);
    node_window_frame_bottom_87.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_frame_bottom_87.userData.sculptComponent = {"id": "window-frame-bottom", "name": "Window frame bottom", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame bottom is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.92, "height": 0.06, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 0.98, -1.66], "rotation": [0, 0, 0], "scale": [0.92, 0.06, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_bottom_87.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_frame_bottom_87);
  nodes["window-frame-bottom"] = node_window_frame_bottom_87;
  const mesh_window_frame_bottom_87Geometry = endpoint_window_frame_bottom_87
    ? new THREE.CylinderGeometry(endpoint_window_frame_bottom_87.endRadius, endpoint_window_frame_bottom_87.baseRadius, endpoint_window_frame_bottom_87.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_frame_bottom_87) {
    mesh_window_frame_bottom_87Geometry.scale(0.92, 0.06, 0.05);
  }
  const mesh_window_frame_bottom_87 = new THREE.Mesh(
    mesh_window_frame_bottom_87Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_frame_bottom_87.name = "Window frame bottom";
  if (endpoint_window_frame_bottom_87) {
    mesh_window_frame_bottom_87.position.copy(endpoint_window_frame_bottom_87.midpoint);
    mesh_window_frame_bottom_87.quaternion.copy(endpoint_window_frame_bottom_87.quaternion);
  }
  mesh_window_frame_bottom_87.castShadow = options.castShadow ?? true;
  mesh_window_frame_bottom_87.receiveShadow = options.receiveShadow ?? true;
  mesh_window_frame_bottom_87.userData.sculptComponent = {"id": "window-frame-bottom", "name": "Window frame bottom", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame bottom is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.92, "height": 0.06, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.4, 0.98, -1.66], "rotation": [0, 0, 0], "scale": [0.92, 0.06, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_bottom_87.add(mesh_window_frame_bottom_87);
  meshes["window-frame-bottom"] = mesh_window_frame_bottom_87;
  colliders["window-frame-bottom"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-frame-bottom"] ??= [];
  destructionGroups["window-frame-bottom"].push(node_window_frame_bottom_87);

  const endpoint_window_frame_a_88 = makeAttachmentEndpoint(null);
  const node_window_frame_a_88 = new THREE.Group();
  node_window_frame_a_88.name = "Window frame A__pivot";
  node_window_frame_a_88.scale.set(1, 1, 1);
  if (endpoint_window_frame_a_88) {
    node_window_frame_a_88.position.copy(endpoint_window_frame_a_88.start);
    node_window_frame_a_88.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_frame_a_88.position.set(-0.02, 1.55, -1.66);
    node_window_frame_a_88.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_frame_a_88.userData.sculptComponent = {"id": "window-frame-a", "name": "Window frame A", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 1.16, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.02, 1.55, -1.66], "rotation": [0, 0, 0], "scale": [0.06, 1.16, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_a_88.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_frame_a_88);
  nodes["window-frame-a"] = node_window_frame_a_88;
  const mesh_window_frame_a_88Geometry = endpoint_window_frame_a_88
    ? new THREE.CylinderGeometry(endpoint_window_frame_a_88.endRadius, endpoint_window_frame_a_88.baseRadius, endpoint_window_frame_a_88.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_frame_a_88) {
    mesh_window_frame_a_88Geometry.scale(0.06, 1.16, 0.05);
  }
  const mesh_window_frame_a_88 = new THREE.Mesh(
    mesh_window_frame_a_88Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_frame_a_88.name = "Window frame A";
  if (endpoint_window_frame_a_88) {
    mesh_window_frame_a_88.position.copy(endpoint_window_frame_a_88.midpoint);
    mesh_window_frame_a_88.quaternion.copy(endpoint_window_frame_a_88.quaternion);
  }
  mesh_window_frame_a_88.castShadow = options.castShadow ?? true;
  mesh_window_frame_a_88.receiveShadow = options.receiveShadow ?? true;
  mesh_window_frame_a_88.userData.sculptComponent = {"id": "window-frame-a", "name": "Window frame A", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 1.16, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.02, 1.55, -1.66], "rotation": [0, 0, 0], "scale": [0.06, 1.16, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_a_88.add(mesh_window_frame_a_88);
  meshes["window-frame-a"] = mesh_window_frame_a_88;
  colliders["window-frame-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-frame-a"] ??= [];
  destructionGroups["window-frame-a"].push(node_window_frame_a_88);

  const endpoint_window_frame_b_89 = makeAttachmentEndpoint(null);
  const node_window_frame_b_89 = new THREE.Group();
  node_window_frame_b_89.name = "Window frame B__pivot";
  node_window_frame_b_89.scale.set(1, 1, 1);
  if (endpoint_window_frame_b_89) {
    node_window_frame_b_89.position.copy(endpoint_window_frame_b_89.start);
    node_window_frame_b_89.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_frame_b_89.position.set(0.82, 1.55, -1.66);
    node_window_frame_b_89.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_frame_b_89.userData.sculptComponent = {"id": "window-frame-b", "name": "Window frame B", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 1.16, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.82, 1.55, -1.66], "rotation": [0, 0, 0], "scale": [0.06, 1.16, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_b_89.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_frame_b_89);
  nodes["window-frame-b"] = node_window_frame_b_89;
  const mesh_window_frame_b_89Geometry = endpoint_window_frame_b_89
    ? new THREE.CylinderGeometry(endpoint_window_frame_b_89.endRadius, endpoint_window_frame_b_89.baseRadius, endpoint_window_frame_b_89.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_frame_b_89) {
    mesh_window_frame_b_89Geometry.scale(0.06, 1.16, 0.05);
  }
  const mesh_window_frame_b_89 = new THREE.Mesh(
    mesh_window_frame_b_89Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_frame_b_89.name = "Window frame B";
  if (endpoint_window_frame_b_89) {
    mesh_window_frame_b_89.position.copy(endpoint_window_frame_b_89.midpoint);
    mesh_window_frame_b_89.quaternion.copy(endpoint_window_frame_b_89.quaternion);
  }
  mesh_window_frame_b_89.castShadow = options.castShadow ?? true;
  mesh_window_frame_b_89.receiveShadow = options.receiveShadow ?? true;
  mesh_window_frame_b_89.userData.sculptComponent = {"id": "window-frame-b", "name": "Window frame B", "level": "macro", "role": "frame", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window frame B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.06, "height": 1.16, "depth": 0.05, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.82, 1.55, -1.66], "rotation": [0, 0, 0], "scale": [0.06, 1.16, 0.05]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-frame-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_frame_b_89.add(mesh_window_frame_b_89);
  meshes["window-frame-b"] = mesh_window_frame_b_89;
  colliders["window-frame-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-frame-b"] ??= [];
  destructionGroups["window-frame-b"].push(node_window_frame_b_89);

  const endpoint_window_rail_0_90 = makeAttachmentEndpoint(null);
  const node_window_rail_0_90 = new THREE.Group();
  node_window_rail_0_90.name = "Window rail 0__pivot";
  node_window_rail_0_90.scale.set(1, 1, 1);
  if (endpoint_window_rail_0_90) {
    node_window_rail_0_90.position.copy(endpoint_window_rail_0_90.start);
    node_window_rail_0_90.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_rail_0_90.position.set(0.55, 1.35, -1.655);
    node_window_rail_0_90.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_rail_0_90.userData.sculptComponent = {"id": "window-rail-0", "name": "Window rail 0", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.35, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_0_90.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_rail_0_90);
  nodes["window-rail-0"] = node_window_rail_0_90;
  const mesh_window_rail_0_90Geometry = endpoint_window_rail_0_90
    ? new THREE.CylinderGeometry(endpoint_window_rail_0_90.endRadius, endpoint_window_rail_0_90.baseRadius, endpoint_window_rail_0_90.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_rail_0_90) {
    mesh_window_rail_0_90Geometry.scale(0.36, 0.025, 0.02);
  }
  const mesh_window_rail_0_90 = new THREE.Mesh(
    mesh_window_rail_0_90Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_rail_0_90.name = "Window rail 0";
  if (endpoint_window_rail_0_90) {
    mesh_window_rail_0_90.position.copy(endpoint_window_rail_0_90.midpoint);
    mesh_window_rail_0_90.quaternion.copy(endpoint_window_rail_0_90.quaternion);
  }
  mesh_window_rail_0_90.castShadow = options.castShadow ?? true;
  mesh_window_rail_0_90.receiveShadow = options.receiveShadow ?? true;
  mesh_window_rail_0_90.userData.sculptComponent = {"id": "window-rail-0", "name": "Window rail 0", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 0 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.35, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_0_90.add(mesh_window_rail_0_90);
  meshes["window-rail-0"] = mesh_window_rail_0_90;
  colliders["window-rail-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-rail-0"] ??= [];
  destructionGroups["window-rail-0"].push(node_window_rail_0_90);

  const endpoint_window_rail_1_91 = makeAttachmentEndpoint(null);
  const node_window_rail_1_91 = new THREE.Group();
  node_window_rail_1_91.name = "Window rail 1__pivot";
  node_window_rail_1_91.scale.set(1, 1, 1);
  if (endpoint_window_rail_1_91) {
    node_window_rail_1_91.position.copy(endpoint_window_rail_1_91.start);
    node_window_rail_1_91.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_rail_1_91.position.set(0.55, 1.55, -1.655);
    node_window_rail_1_91.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_rail_1_91.userData.sculptComponent = {"id": "window-rail-1", "name": "Window rail 1", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.55, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_1_91.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_rail_1_91);
  nodes["window-rail-1"] = node_window_rail_1_91;
  const mesh_window_rail_1_91Geometry = endpoint_window_rail_1_91
    ? new THREE.CylinderGeometry(endpoint_window_rail_1_91.endRadius, endpoint_window_rail_1_91.baseRadius, endpoint_window_rail_1_91.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_rail_1_91) {
    mesh_window_rail_1_91Geometry.scale(0.36, 0.025, 0.02);
  }
  const mesh_window_rail_1_91 = new THREE.Mesh(
    mesh_window_rail_1_91Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_rail_1_91.name = "Window rail 1";
  if (endpoint_window_rail_1_91) {
    mesh_window_rail_1_91.position.copy(endpoint_window_rail_1_91.midpoint);
    mesh_window_rail_1_91.quaternion.copy(endpoint_window_rail_1_91.quaternion);
  }
  mesh_window_rail_1_91.castShadow = options.castShadow ?? true;
  mesh_window_rail_1_91.receiveShadow = options.receiveShadow ?? true;
  mesh_window_rail_1_91.userData.sculptComponent = {"id": "window-rail-1", "name": "Window rail 1", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 1 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.55, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_1_91.add(mesh_window_rail_1_91);
  meshes["window-rail-1"] = mesh_window_rail_1_91;
  colliders["window-rail-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-rail-1"] ??= [];
  destructionGroups["window-rail-1"].push(node_window_rail_1_91);

  const endpoint_window_rail_2_92 = makeAttachmentEndpoint(null);
  const node_window_rail_2_92 = new THREE.Group();
  node_window_rail_2_92.name = "Window rail 2__pivot";
  node_window_rail_2_92.scale.set(1, 1, 1);
  if (endpoint_window_rail_2_92) {
    node_window_rail_2_92.position.copy(endpoint_window_rail_2_92.start);
    node_window_rail_2_92.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_window_rail_2_92.position.set(0.55, 1.75, -1.655);
    node_window_rail_2_92.rotation.set(0.0, 0.0, 0.0);
  }
  node_window_rail_2_92.userData.sculptComponent = {"id": "window-rail-2", "name": "Window rail 2", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.75, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_2_92.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}};
  (nodes["root"] ?? root).add(node_window_rail_2_92);
  nodes["window-rail-2"] = node_window_rail_2_92;
  const mesh_window_rail_2_92Geometry = endpoint_window_rail_2_92
    ? new THREE.CylinderGeometry(endpoint_window_rail_2_92.endRadius, endpoint_window_rail_2_92.baseRadius, endpoint_window_rail_2_92.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_window_rail_2_92) {
    mesh_window_rail_2_92Geometry.scale(0.36, 0.025, 0.02);
  }
  const mesh_window_rail_2_92 = new THREE.Mesh(
    mesh_window_rail_2_92Geometry,
    materialMap["plastic-white"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_window_rail_2_92.name = "Window rail 2";
  if (endpoint_window_rail_2_92) {
    mesh_window_rail_2_92.position.copy(endpoint_window_rail_2_92.midpoint);
    mesh_window_rail_2_92.quaternion.copy(endpoint_window_rail_2_92.quaternion);
  }
  mesh_window_rail_2_92.castShadow = options.castShadow ?? true;
  mesh_window_rail_2_92.receiveShadow = options.receiveShadow ?? true;
  mesh_window_rail_2_92.userData.sculptComponent = {"id": "window-rail-2", "name": "Window rail 2", "level": "macro", "role": "rail", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Window rail 2 is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.36, "height": 0.025, "depth": 0.02, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.55, 1.75, -1.655], "rotation": [0, 0, 0], "scale": [0.36, 0.025, 0.02]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "window-rail-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "plastic-white"}}, "material": "plastic-white", "materialLayers": ["plastic-white"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 244, 240, 1.0)", "secondaryAlbedo": "rgba(202, 200, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_window_rail_2_92.add(mesh_window_rail_2_92);
  meshes["window-rail-2"] = mesh_window_rail_2_92;
  colliders["window-rail-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["window-rail-2"] ??= [];
  destructionGroups["window-rail-2"].push(node_window_rail_2_92);

  const endpoint_leaf_0_93 = makeAttachmentEndpoint(null);
  const node_leaf_0_93 = new THREE.Group();
  node_leaf_0_93.name = "Leaf 0__pivot";
  node_leaf_0_93.scale.set(1, 1, 1);
  if (endpoint_leaf_0_93) {
    node_leaf_0_93.position.copy(endpoint_leaf_0_93.start);
    node_leaf_0_93.rotation.set(0.5, 0.2, 0.4);
  } else {
    node_leaf_0_93.position.set(-0.05, 1.45, -1.42);
    node_leaf_0_93.rotation.set(0.5, 0.2, 0.4);
  }
  node_leaf_0_93.userData.sculptComponent = {"id": "leaf-0", "name": "Leaf 0", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 0 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.1, "depth": 0.22, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.05, 1.45, -1.42], "rotation": [0.5, 0.2, 0.4], "scale": [0.34, 0.1, 0.22]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_0_93.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["root"] ?? root).add(node_leaf_0_93);
  nodes["leaf-0"] = node_leaf_0_93;
  const mesh_leaf_0_93Geometry = endpoint_leaf_0_93
    ? new THREE.CylinderGeometry(endpoint_leaf_0_93.endRadius, endpoint_leaf_0_93.baseRadius, endpoint_leaf_0_93.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_leaf_0_93) {
    mesh_leaf_0_93Geometry.scale(0.34, 0.1, 0.22);
  }
  const mesh_leaf_0_93 = new THREE.Mesh(
    mesh_leaf_0_93Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_0_93.name = "Leaf 0";
  if (endpoint_leaf_0_93) {
    mesh_leaf_0_93.position.copy(endpoint_leaf_0_93.midpoint);
    mesh_leaf_0_93.quaternion.copy(endpoint_leaf_0_93.quaternion);
  }
  mesh_leaf_0_93.castShadow = options.castShadow ?? true;
  mesh_leaf_0_93.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_0_93.userData.sculptComponent = {"id": "leaf-0", "name": "Leaf 0", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 0 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.1, "depth": 0.22, "units": "relative", "confidence": 0.6}, "transform": {"position": [-0.05, 1.45, -1.42], "rotation": [0.5, 0.2, 0.4], "scale": [0.34, 0.1, 0.22]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_0_93.add(mesh_leaf_0_93);
  meshes["leaf-0"] = mesh_leaf_0_93;
  colliders["leaf-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["leaf-0"] ??= [];
  destructionGroups["leaf-0"].push(node_leaf_0_93);

  const endpoint_leaf_1_94 = makeAttachmentEndpoint(null);
  const node_leaf_1_94 = new THREE.Group();
  node_leaf_1_94.name = "Leaf 1__pivot";
  node_leaf_1_94.scale.set(1, 1, 1);
  if (endpoint_leaf_1_94) {
    node_leaf_1_94.position.copy(endpoint_leaf_1_94.start);
    node_leaf_1_94.rotation.set(-0.3, 0.4, 0.2);
  } else {
    node_leaf_1_94.position.set(0.15, 1.25, -1.38);
    node_leaf_1_94.rotation.set(-0.3, 0.4, 0.2);
  }
  node_leaf_1_94.userData.sculptComponent = {"id": "leaf-1", "name": "Leaf 1", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 1 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.36, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 1.25, -1.38], "rotation": [-0.3, 0.4, 0.2], "scale": [0.28, 0.1, 0.36]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_1_94.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["root"] ?? root).add(node_leaf_1_94);
  nodes["leaf-1"] = node_leaf_1_94;
  const mesh_leaf_1_94Geometry = endpoint_leaf_1_94
    ? new THREE.CylinderGeometry(endpoint_leaf_1_94.endRadius, endpoint_leaf_1_94.baseRadius, endpoint_leaf_1_94.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_leaf_1_94) {
    mesh_leaf_1_94Geometry.scale(0.28, 0.1, 0.36);
  }
  const mesh_leaf_1_94 = new THREE.Mesh(
    mesh_leaf_1_94Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_1_94.name = "Leaf 1";
  if (endpoint_leaf_1_94) {
    mesh_leaf_1_94.position.copy(endpoint_leaf_1_94.midpoint);
    mesh_leaf_1_94.quaternion.copy(endpoint_leaf_1_94.quaternion);
  }
  mesh_leaf_1_94.castShadow = options.castShadow ?? true;
  mesh_leaf_1_94.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_1_94.userData.sculptComponent = {"id": "leaf-1", "name": "Leaf 1", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 1 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.28, "height": 0.1, "depth": 0.36, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.15, 1.25, -1.38], "rotation": [-0.3, 0.4, 0.2], "scale": [0.28, 0.1, 0.36]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_1_94.add(mesh_leaf_1_94);
  meshes["leaf-1"] = mesh_leaf_1_94;
  colliders["leaf-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["leaf-1"] ??= [];
  destructionGroups["leaf-1"].push(node_leaf_1_94);

  const endpoint_leaf_2_95 = makeAttachmentEndpoint(null);
  const node_leaf_2_95 = new THREE.Group();
  node_leaf_2_95.name = "Leaf 2__pivot";
  node_leaf_2_95.scale.set(1, 1, 1);
  if (endpoint_leaf_2_95) {
    node_leaf_2_95.position.copy(endpoint_leaf_2_95.start);
    node_leaf_2_95.rotation.set(0.2, -0.3, -0.4);
  } else {
    node_leaf_2_95.position.set(0.35, 1.55, -1.4);
    node_leaf_2_95.rotation.set(0.2, -0.3, -0.4);
  }
  node_leaf_2_95.userData.sculptComponent = {"id": "leaf-2", "name": "Leaf 2", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 2 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.3, "height": 0.09, "depth": 0.24, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.35, 1.55, -1.4], "rotation": [0.2, -0.3, -0.4], "scale": [0.3, 0.09, 0.24]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_2_95.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["root"] ?? root).add(node_leaf_2_95);
  nodes["leaf-2"] = node_leaf_2_95;
  const mesh_leaf_2_95Geometry = endpoint_leaf_2_95
    ? new THREE.CylinderGeometry(endpoint_leaf_2_95.endRadius, endpoint_leaf_2_95.baseRadius, endpoint_leaf_2_95.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_leaf_2_95) {
    mesh_leaf_2_95Geometry.scale(0.3, 0.09, 0.24);
  }
  const mesh_leaf_2_95 = new THREE.Mesh(
    mesh_leaf_2_95Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_2_95.name = "Leaf 2";
  if (endpoint_leaf_2_95) {
    mesh_leaf_2_95.position.copy(endpoint_leaf_2_95.midpoint);
    mesh_leaf_2_95.quaternion.copy(endpoint_leaf_2_95.quaternion);
  }
  mesh_leaf_2_95.castShadow = options.castShadow ?? true;
  mesh_leaf_2_95.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_2_95.userData.sculptComponent = {"id": "leaf-2", "name": "Leaf 2", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 2 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.3, "height": 0.09, "depth": 0.24, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.35, 1.55, -1.4], "rotation": [0.2, -0.3, -0.4], "scale": [0.3, 0.09, 0.24]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_2_95.add(mesh_leaf_2_95);
  meshes["leaf-2"] = mesh_leaf_2_95;
  colliders["leaf-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["leaf-2"] ??= [];
  destructionGroups["leaf-2"].push(node_leaf_2_95);

  const endpoint_leaf_3_96 = makeAttachmentEndpoint(null);
  const node_leaf_3_96 = new THREE.Group();
  node_leaf_3_96.name = "Leaf 3__pivot";
  node_leaf_3_96.scale.set(1, 1, 1);
  if (endpoint_leaf_3_96) {
    node_leaf_3_96.position.copy(endpoint_leaf_3_96.start);
    node_leaf_3_96.rotation.set(0.6, 0.1, 0.3);
  } else {
    node_leaf_3_96.position.set(0.05, 1.05, -1.32);
    node_leaf_3_96.rotation.set(0.6, 0.1, 0.3);
  }
  node_leaf_3_96.userData.sculptComponent = {"id": "leaf-3", "name": "Leaf 3", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 3 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.26, "height": 0.12, "depth": 0.3, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.05, 1.05, -1.32], "rotation": [0.6, 0.1, 0.3], "scale": [0.26, 0.12, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_3_96.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["root"] ?? root).add(node_leaf_3_96);
  nodes["leaf-3"] = node_leaf_3_96;
  const mesh_leaf_3_96Geometry = endpoint_leaf_3_96
    ? new THREE.CylinderGeometry(endpoint_leaf_3_96.endRadius, endpoint_leaf_3_96.baseRadius, endpoint_leaf_3_96.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_leaf_3_96) {
    mesh_leaf_3_96Geometry.scale(0.26, 0.12, 0.3);
  }
  const mesh_leaf_3_96 = new THREE.Mesh(
    mesh_leaf_3_96Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_3_96.name = "Leaf 3";
  if (endpoint_leaf_3_96) {
    mesh_leaf_3_96.position.copy(endpoint_leaf_3_96.midpoint);
    mesh_leaf_3_96.quaternion.copy(endpoint_leaf_3_96.quaternion);
  }
  mesh_leaf_3_96.castShadow = options.castShadow ?? true;
  mesh_leaf_3_96.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_3_96.userData.sculptComponent = {"id": "leaf-3", "name": "Leaf 3", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 3 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.26, "height": 0.12, "depth": 0.3, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.05, 1.05, -1.32], "rotation": [0.6, 0.1, 0.3], "scale": [0.26, 0.12, 0.3]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_3_96.add(mesh_leaf_3_96);
  meshes["leaf-3"] = mesh_leaf_3_96;
  colliders["leaf-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["leaf-3"] ??= [];
  destructionGroups["leaf-3"].push(node_leaf_3_96);

  const endpoint_leaf_4_97 = makeAttachmentEndpoint(null);
  const node_leaf_4_97 = new THREE.Group();
  node_leaf_4_97.name = "Leaf 4__pivot";
  node_leaf_4_97.scale.set(1, 1, 1);
  if (endpoint_leaf_4_97) {
    node_leaf_4_97.position.copy(endpoint_leaf_4_97.start);
    node_leaf_4_97.rotation.set(-0.4, 0.5, 0.1);
  } else {
    node_leaf_4_97.position.set(0.28, 1.15, -1.3);
    node_leaf_4_97.rotation.set(-0.4, 0.5, 0.1);
  }
  node_leaf_4_97.userData.sculptComponent = {"id": "leaf-4", "name": "Leaf 4", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 4 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.08, "depth": 0.28, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.28, 1.15, -1.3], "rotation": [-0.4, 0.5, 0.1], "scale": [0.22, 0.08, 0.28]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_4_97.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["root"] ?? root).add(node_leaf_4_97);
  nodes["leaf-4"] = node_leaf_4_97;
  const mesh_leaf_4_97Geometry = endpoint_leaf_4_97
    ? new THREE.CylinderGeometry(endpoint_leaf_4_97.endRadius, endpoint_leaf_4_97.baseRadius, endpoint_leaf_4_97.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_leaf_4_97) {
    mesh_leaf_4_97Geometry.scale(0.22, 0.08, 0.28);
  }
  const mesh_leaf_4_97 = new THREE.Mesh(
    mesh_leaf_4_97Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_4_97.name = "Leaf 4";
  if (endpoint_leaf_4_97) {
    mesh_leaf_4_97.position.copy(endpoint_leaf_4_97.midpoint);
    mesh_leaf_4_97.quaternion.copy(endpoint_leaf_4_97.quaternion);
  }
  mesh_leaf_4_97.castShadow = options.castShadow ?? true;
  mesh_leaf_4_97.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_4_97.userData.sculptComponent = {"id": "leaf-4", "name": "Leaf 4", "level": "macro", "role": "foliage", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Leaf 4 is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.08, "depth": 0.28, "units": "relative", "confidence": 0.6}, "transform": {"position": [0.28, 1.15, -1.3], "rotation": [-0.4, 0.5, 0.1], "scale": [0.22, 0.08, 0.28]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-4", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(63, 143, 85, 1.0)", "secondaryAlbedo": "rgba(51, 117, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_leaf_4_97.add(mesh_leaf_4_97);
  meshes["leaf-4"] = mesh_leaf_4_97;
  colliders["leaf-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["leaf-4"] ??= [];
  destructionGroups["leaf-4"].push(node_leaf_4_97);

  const endpoint_guitar_body_98 = makeAttachmentEndpoint(null);
  const node_guitar_body_98 = new THREE.Group();
  node_guitar_body_98.name = "Guitar body__pivot";
  node_guitar_body_98.scale.set(1, 1, 1);
  if (endpoint_guitar_body_98) {
    node_guitar_body_98.position.copy(endpoint_guitar_body_98.start);
    node_guitar_body_98.rotation.set(0.15, 0.2, 0.55);
  } else {
    node_guitar_body_98.position.set(-1.48, 0.32, 0.55);
    node_guitar_body_98.rotation.set(0.15, 0.2, 0.55);
  }
  node_guitar_body_98.userData.sculptComponent = {"id": "guitar-body", "name": "Guitar body", "level": "macro", "role": "instrument", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Guitar body is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.46, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.48, 0.32, 0.55], "rotation": [0.15, 0.2, 0.55], "scale": [0.34, 0.46, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "guitar"}}, "material": "guitar", "materialLayers": ["guitar"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 58, 40, 1.0)", "secondaryAlbedo": "rgba(75, 47, 32, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_guitar_body_98.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "guitar"}};
  (nodes["root"] ?? root).add(node_guitar_body_98);
  nodes["guitar-body"] = node_guitar_body_98;
  const mesh_guitar_body_98Geometry = endpoint_guitar_body_98
    ? new THREE.CylinderGeometry(endpoint_guitar_body_98.endRadius, endpoint_guitar_body_98.baseRadius, endpoint_guitar_body_98.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_guitar_body_98) {
    mesh_guitar_body_98Geometry.scale(0.34, 0.46, 0.14);
  }
  const mesh_guitar_body_98 = new THREE.Mesh(
    mesh_guitar_body_98Geometry,
    materialMap["guitar"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guitar_body_98.name = "Guitar body";
  if (endpoint_guitar_body_98) {
    mesh_guitar_body_98.position.copy(endpoint_guitar_body_98.midpoint);
    mesh_guitar_body_98.quaternion.copy(endpoint_guitar_body_98.quaternion);
  }
  mesh_guitar_body_98.castShadow = options.castShadow ?? true;
  mesh_guitar_body_98.receiveShadow = options.receiveShadow ?? true;
  mesh_guitar_body_98.userData.sculptComponent = {"id": "guitar-body", "name": "Guitar body", "level": "macro", "role": "instrument", "importance": 0.8, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Guitar body is a discrete ellipsoid mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.34, "height": 0.46, "depth": 0.14, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.48, 0.32, 0.55], "rotation": [0.15, 0.2, 0.55], "scale": [0.34, 0.46, 0.14]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "guitar"}}, "material": "guitar", "materialLayers": ["guitar"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(92, 58, 40, 1.0)", "secondaryAlbedo": "rgba(75, 47, 32, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_guitar_body_98.add(mesh_guitar_body_98);
  meshes["guitar-body"] = mesh_guitar_body_98;
  colliders["guitar-body"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["guitar-body"] ??= [];
  destructionGroups["guitar-body"].push(node_guitar_body_98);

  const attachment_guitar_neck_99 = null;
  const endpoint_guitar_neck_99 = makeAttachmentEndpoint(attachment_guitar_neck_99);
  const node_guitar_neck_99 = new THREE.Group();
  node_guitar_neck_99.name = "Guitar neck__pivot";
  node_guitar_neck_99.scale.set(1, 1, 1);
  if (endpoint_guitar_neck_99) {
    node_guitar_neck_99.position.copy(endpoint_guitar_neck_99.start);
    node_guitar_neck_99.rotation.set(0.15, 0.0, 0.45);
  } else {
    node_guitar_neck_99.position.set(-1.68, 0.72, 0.42);
    node_guitar_neck_99.rotation.set(0.15, 0.0, 0.45);
  }
  node_guitar_neck_99.userData.sculptComponent = {"id": "guitar-neck", "name": "Guitar neck", "level": "macro", "role": "instrument", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Guitar neck is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.04, "height": 0.7, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.68, 0.72, 0.42], "rotation": [0.15, 0, 0.45], "scale": [0.04, 0.7, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_guitar_neck_99.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}};
  (nodes["root"] ?? root).add(node_guitar_neck_99);
  nodes["guitar-neck"] = node_guitar_neck_99;
  const mesh_guitar_neck_99Geometry = endpoint_guitar_neck_99
    ? new THREE.CylinderGeometry(endpoint_guitar_neck_99.endRadius, endpoint_guitar_neck_99.baseRadius, endpoint_guitar_neck_99.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_guitar_neck_99) {
    mesh_guitar_neck_99Geometry.scale(0.04, 0.7, 0.04);
  }
  const mesh_guitar_neck_99 = new THREE.Mesh(
    mesh_guitar_neck_99Geometry,
    materialMap["wood"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guitar_neck_99.name = "Guitar neck";
  if (endpoint_guitar_neck_99) {
    mesh_guitar_neck_99.position.copy(endpoint_guitar_neck_99.midpoint);
    mesh_guitar_neck_99.quaternion.copy(endpoint_guitar_neck_99.quaternion);
  }
  mesh_guitar_neck_99.castShadow = options.castShadow ?? true;
  mesh_guitar_neck_99.receiveShadow = options.receiveShadow ?? true;
  mesh_guitar_neck_99.userData.sculptComponent = {"id": "guitar-neck", "name": "Guitar neck", "level": "macro", "role": "instrument", "importance": 0.8, "confidence": 0.72, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Guitar neck is a discrete cylinder mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.04, "height": 0.7, "depth": 0.04, "units": "relative", "confidence": 0.6}, "transform": {"position": [-1.68, 0.72, 0.42], "rotation": [0.15, 0, 0.45], "scale": [0.04, 0.7, 0.04]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guitar-neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wood"}}, "material": "wood", "materialLayers": ["wood"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 146, 90, 1.0)", "secondaryAlbedo": "rgba(160, 119, 73, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_guitar_neck_99.add(mesh_guitar_neck_99);
  meshes["guitar-neck"] = mesh_guitar_neck_99;
  colliders["guitar-neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["guitar-neck"] ??= [];
  destructionGroups["guitar-neck"].push(node_guitar_neck_99);

  const endpoint_cushion_a_100 = makeAttachmentEndpoint(null);
  const node_cushion_a_100 = new THREE.Group();
  node_cushion_a_100.name = "Cushion A__pivot";
  node_cushion_a_100.scale.set(1, 1, 1);
  if (endpoint_cushion_a_100) {
    node_cushion_a_100.position.copy(endpoint_cushion_a_100.start);
    node_cushion_a_100.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cushion_a_100.position.set(1.0, 0.06, -0.72);
    node_cushion_a_100.rotation.set(0.0, 0.0, 0.0);
  }
  node_cushion_a_100.userData.sculptComponent = {"id": "cushion-a", "name": "Cushion A", "level": "macro", "role": "soft", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cushion A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.48, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.0, 0.06, -0.72], "rotation": [0, 0, 0], "scale": [0.48, 0.1, 0.28]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}}, "material": "cushion", "materialLayers": ["cushion"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 228, 212, 1.0)", "secondaryAlbedo": "rgba(195, 186, 173, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_cushion_a_100.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}};
  (nodes["root"] ?? root).add(node_cushion_a_100);
  nodes["cushion-a"] = node_cushion_a_100;
  const mesh_cushion_a_100Geometry = endpoint_cushion_a_100
    ? new THREE.CylinderGeometry(endpoint_cushion_a_100.endRadius, endpoint_cushion_a_100.baseRadius, endpoint_cushion_a_100.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cushion_a_100) {
    mesh_cushion_a_100Geometry.scale(0.48, 0.1, 0.28);
  }
  const mesh_cushion_a_100 = new THREE.Mesh(
    mesh_cushion_a_100Geometry,
    materialMap["cushion"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cushion_a_100.name = "Cushion A";
  if (endpoint_cushion_a_100) {
    mesh_cushion_a_100.position.copy(endpoint_cushion_a_100.midpoint);
    mesh_cushion_a_100.quaternion.copy(endpoint_cushion_a_100.quaternion);
  }
  mesh_cushion_a_100.castShadow = options.castShadow ?? true;
  mesh_cushion_a_100.receiveShadow = options.receiveShadow ?? true;
  mesh_cushion_a_100.userData.sculptComponent = {"id": "cushion-a", "name": "Cushion A", "level": "macro", "role": "soft", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cushion A is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.48, "height": 0.1, "depth": 0.28, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.0, 0.06, -0.72], "rotation": [0, 0, 0], "scale": [0.48, 0.1, 0.28]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}}, "material": "cushion", "materialLayers": ["cushion"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 228, 212, 1.0)", "secondaryAlbedo": "rgba(195, 186, 173, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_cushion_a_100.add(mesh_cushion_a_100);
  meshes["cushion-a"] = mesh_cushion_a_100;
  colliders["cushion-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cushion-a"] ??= [];
  destructionGroups["cushion-a"].push(node_cushion_a_100);

  const endpoint_cushion_b_101 = makeAttachmentEndpoint(null);
  const node_cushion_b_101 = new THREE.Group();
  node_cushion_b_101.name = "Cushion B__pivot";
  node_cushion_b_101.scale.set(1, 1, 1);
  if (endpoint_cushion_b_101) {
    node_cushion_b_101.position.copy(endpoint_cushion_b_101.start);
    node_cushion_b_101.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cushion_b_101.position.set(1.35, 0.05, -0.42);
    node_cushion_b_101.rotation.set(0.0, 0.0, 0.0);
  }
  node_cushion_b_101.userData.sculptComponent = {"id": "cushion-b", "name": "Cushion B", "level": "macro", "role": "soft", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cushion B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.4, "height": 0.08, "depth": 0.26, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.35, 0.05, -0.42], "rotation": [0, 0, 0], "scale": [0.4, 0.08, 0.26]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}}, "material": "cushion", "materialLayers": ["cushion"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 228, 212, 1.0)", "secondaryAlbedo": "rgba(195, 186, 173, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_cushion_b_101.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}};
  (nodes["root"] ?? root).add(node_cushion_b_101);
  nodes["cushion-b"] = node_cushion_b_101;
  const mesh_cushion_b_101Geometry = endpoint_cushion_b_101
    ? new THREE.CylinderGeometry(endpoint_cushion_b_101.endRadius, endpoint_cushion_b_101.baseRadius, endpoint_cushion_b_101.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_cushion_b_101) {
    mesh_cushion_b_101Geometry.scale(0.4, 0.08, 0.26);
  }
  const mesh_cushion_b_101 = new THREE.Mesh(
    mesh_cushion_b_101Geometry,
    materialMap["cushion"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cushion_b_101.name = "Cushion B";
  if (endpoint_cushion_b_101) {
    mesh_cushion_b_101.position.copy(endpoint_cushion_b_101.midpoint);
    mesh_cushion_b_101.quaternion.copy(endpoint_cushion_b_101.quaternion);
  }
  mesh_cushion_b_101.castShadow = options.castShadow ?? true;
  mesh_cushion_b_101.receiveShadow = options.receiveShadow ?? true;
  mesh_cushion_b_101.userData.sculptComponent = {"id": "cushion-b", "name": "Cushion B", "level": "macro", "role": "soft", "importance": 0.8, "confidence": 0.72, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cushion B is a discrete box mass in the 4.png cutaway, assembled into the room rather than modeled as one continuous sculpt.", "geometryDescriptor": {"topologyIntent": "stylized hard-surface diorama part", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": null, "attachment": null, "dimensions": {"width": 0.4, "height": 0.08, "depth": 0.26, "units": "relative", "confidence": 0.6}, "transform": {"position": [1.35, 0.05, -0.42], "rotation": [0, 0, 0], "scale": [0.4, 0.08, 0.26]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cushion-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cushion"}}, "material": "cushion", "materialLayers": ["cushion"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 228, 212, 1.0)", "secondaryAlbedo": "rgba(195, 186, 173, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout"};
  node_cushion_b_101.add(mesh_cushion_b_101);
  meshes["cushion-b"] = mesh_cushion_b_101;
  colliders["cushion-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["cushion-b"] ??= [];
  destructionGroups["cushion-b"].push(node_cushion_b_101);
  // repetition system "chair-casters" describes 5 parts that are already built individually; not instanced.

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCutawayGamingRoomLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cutaway Gaming Room look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: small white practical at the desk lamp, warm-neutral, high intensity.", "Fill light: blue-violet wash on the left wall. Cool color temperature. Not part of the wall albedo.", "Rim light: magenta wash on the right wall around the TV.", "Exposure stays moderate under ACES filmic tone mapping against a black background.", "Contact shadow: short soft ground shadows under the sofa, chair, table, and guitar."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCutawayGamingRoomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameCutawayGamingRoomCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createCutawayGamingRoomPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureCutawayGamingRoomRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCutawayGamingRoomInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
