import { HTTPException } from 'hono/http-exception';

export const ASSET_LIMIT = 2 * 1024 * 1024;
export const PREVIEW_LIMIT = 512 * 1024;
export const UPLOAD_LIMIT = ASSET_LIMIT + PREVIEW_LIMIT + 32 * 1024;

const shapes = ['box', 'sphere', 'cylinder', 'cone', 'torus'] as const;
const vectorSchema = {
  type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -8, maximum: 8 },
};
const colorPattern = '^#[0-9a-fA-F]{6}$';

export const assetSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Beech item asset v1',
  description: 'An editable low-poly beach prop. See the Beechshore item asset specification for units and orientation.',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'parts'],
  properties: {
    version: { const: 1 },
    parts: {
      type: 'array', minItems: 1, maxItems: 32,
      items: {
        type: 'object', additionalProperties: false,
        required: ['shape', 'position', 'size', 'color'],
        properties: {
          shape: { enum: shapes },
          position: vectorSchema,
          size: { ...vectorSchema, items: { type: 'number', exclusiveMinimum: 0, maximum: 8 } },
          rotation: { ...vectorSchema, description: 'Optional XYZ Euler angles in radians, default [0, 0, 0].' },
          color: { type: 'string', pattern: colorPattern },
        },
      },
    },
  },
};

export const assetExample = {
  version: 1,
  parts: [
    { shape: 'cylinder', position: [0, 0.16, 0], size: [0.52, 0.32, 0.52], color: '#D28365' },
    { shape: 'cylinder', position: [0, 0.33, 0], size: [0.56, 0.055, 0.56], color: '#F0BD8F' },
    { shape: 'torus', position: [0, 0.38, 0], size: [0.35, 0.12, 0.35], rotation: [0, 0, 1.57], color: '#EAD1AD' },
  ],
};

export const badSubmission = (message: string): never => {
  throw new HTTPException(400, { message });
};

type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const vector = (v: unknown, positive = false) => Array.isArray(v) && v.length === 3 &&
  v.every((n) => typeof n === 'number' && (positive ? n > 0 : n >= -8) && n <= 8);
const utf8 = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return badSubmission('Upload a UTF-8 text file.');
  }
};
const json = (bytes: Uint8Array): JsonObject => {
  let data: unknown;
  try { data = JSON.parse(utf8(bytes)); } catch { return badSubmission('The asset is not valid UTF-8 JSON.'); }
  return object(data) ? data : badSubmission('The asset must be a JSON object.');
};

function beechAsset(data: JsonObject) {
  const spec = assetSchema.properties.parts;
  const { parts } = data;
  if (data.version !== 1 || Object.keys(data).some((k) => !Object.hasOwn(assetSchema.properties, k)) ||
      !Array.isArray(parts) || parts.length < spec.minItems || parts.length > spec.maxItems) {
    return badSubmission('Beech JSON must use version 1 and contain 1 to 32 parts.');
  }
  for (const [i, part] of parts.entries()) {
    if (!object(part) || Object.keys(part).some((k) => !Object.hasOwn(spec.items.properties, k)) ||
        !shapes.some((shape) => shape === part.shape) || !vector(part.position) || !vector(part.size, true) ||
        (Object.hasOwn(part, 'rotation') && !vector(part.rotation)) ||
        typeof part.color !== 'string' || !new RegExp(colorPattern).test(part.color)) {
      badSubmission(`Beech JSON part ${i + 1} does not match the asset schema.`);
    }
  }
  return { parts: parts.length };
}

function gltfAsset(data: JsonObject, binary: boolean) {
  if (!object(data.asset) || data.asset.version !== '2.0' || !Array.isArray(data.meshes) || !data.meshes.length) {
    badSubmission('Upload a glTF 2.0 model with at least one mesh.');
  }
  // Core glTF uses URIs on buffers and images. Require embedded data even
  // in extensions so review never needs to resolve a submitted URL.
  const pending: unknown[] = [data];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
    } else if (object(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'uri' && (typeof entry !== 'string' || !/^data:[^;,]*;base64,[a-z\d+/]+={0,2}$/i.test(entry))) {
          badSubmission('Embed all model resources. External links and files are not supported.');
        }
        pending.push(entry);
      }
    }
  }
  if (!binary && Array.isArray(data.buffers) && data.buffers.some((b) => !object(b) || !b.uri)) {
    badSubmission('Embed glTF buffers as base64 data URIs.');
  }
  return { meshes: (data.meshes as unknown[]).length };
}

function glbJson(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) {
    return badSubmission('Upload a valid glTF 2.0 binary (.glb).');
  }
  const jsonLength = view.getUint32(12, true);
  if (jsonLength % 4 || 20 + jsonLength > bytes.length || view.getUint32(16, true) !== 0x4e4f534a) {
    return badSubmission('The GLB is missing a valid JSON chunk.');
  }
  const end = 20 + jsonLength;
  if (end !== bytes.length && (bytes.length < end + 8 || view.getUint32(end + 4, true) !== 0x004e4942 ||
      view.getUint32(end, true) % 4 || end + 8 + view.getUint32(end, true) !== bytes.length)) {
    return badSubmission('The GLB binary chunk is invalid.');
  }
  return bytes.subarray(20, end);
}

export async function readAsset(file: FormDataEntryValue | null) {
  if (!file || typeof file === 'string' || !file.size) return badSubmission('Choose an item asset to upload.');
  if (file.size > ASSET_LIMIT) throw new HTTPException(413, { message: 'The item asset exceeds 2 MiB.' });
  const extension = file.name.match(/\.([a-z]+)$/i)?.[1].toLowerCase();
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'item';
  const filename = `${stem}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  switch (extension) {
    case 'json': return { format: 'beech-json', filename, mime: 'application/json', bytes, summary: beechAsset(json(bytes)) };
    case 'glb': return { format: 'glb', filename, mime: 'model/gltf-binary', bytes, summary: gltfAsset(json(glbJson(bytes)), true) };
    case 'gltf': return { format: 'gltf', filename, mime: 'model/gltf+json', bytes, summary: gltfAsset(json(bytes), false) };
    case 'ts': {
      const source = utf8(bytes);
      if (!source.trim() || source.includes('\0')) return badSubmission('Upload a plain-text TypeScript source file.');
      return { format: 'ts', filename, mime: 'text/plain', bytes, summary: {} };
    }
    default: return badSubmission('Choose a .json, .glb, .gltf or .ts item asset.');
  }
}

export async function readPreview(file: FormDataEntryValue | null) {
  if (!file || (typeof file !== 'string' && !file.name && !file.size)) return null;
  if (typeof file === 'string' || !file.size) return badSubmission('Choose a PNG or JPEG preview.');
  if (file.size > PREVIEW_LIMIT) throw new HTTPException(413, { message: 'The preview exceeds 512 KiB.' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (!png && !jpeg) return badSubmission('Choose a PNG or JPEG preview.');
  return { bytes, mime: png ? 'image/png' : 'image/jpeg' };
}
