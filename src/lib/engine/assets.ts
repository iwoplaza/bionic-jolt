import { type DataType, type Loader, load } from '@loaders.gl/core';
import { OBJLoader } from '@loaders.gl/obj';
import { vec2f, vec3f, type v2f, type v3f } from 'typegpu/data';
import type { ExperimentalTgpuRoot as TgpuRoot } from 'typegpu/experimental';

import { type Mesh, vertexLayout } from './mesh.ts';

export type MeshAssetOptions = {
  url: string;
};

export type MeshAsset = {
  preload(): Promise<MeshAsset>;
  get(root: TgpuRoot): Promise<Mesh> | Mesh;
  peek(root: TgpuRoot): Mesh | undefined;
  readonly url: string;
};

export const meshAsset = ({ url }: MeshAssetOptions): MeshAsset => {
  let meshDataPromise: Promise<MeshData> | null = null;
  let meshData: MeshData | null = null;

  const meshPromiseStore = new WeakMap<TgpuRoot, Promise<Mesh>>();
  const meshStore = new WeakMap<TgpuRoot, Mesh>();

  return {
    async preload(): Promise<MeshAsset> {
      if (meshData) {
        return this;
      }

      if (!meshDataPromise) {
        meshDataPromise = loadModel(url).then((data) => {
          meshData = data;
          return data;
        });
      }

      meshData = await meshDataPromise;
      return this;
    },

    get(root: TgpuRoot): Promise<Mesh> | Mesh {
      let mesh = meshStore.get(root);
      // The mesh has already been created for this root
      if (mesh) {
        return mesh;
      }

      let meshPromise = meshPromiseStore.get(root);
      // The mesh is being loaded, return the existing promise.
      if (meshPromise) {
        return meshPromise;
      }

      meshPromise = (async () => {
        await this.preload();

        mesh = await createMeshFromData(root, meshData as MeshData);
        meshStore.set(root, mesh);
        return mesh;
      })();
      meshPromiseStore.set(root, meshPromise);

      return meshPromise;
    },

    peek(root: TgpuRoot): Mesh | undefined {
      const value = this.get(root);
      if (value instanceof Promise) {
        return undefined;
      }
      return value;
    },

    url,
  };
};

type MeshData = {
  vertices: { position: v3f; normal: v3f; uv: v2f }[];
};

async function loadModel(
  src: string | DataType,
  loader: Loader = OBJLoader,
): Promise<MeshData> {
  const rawData = await load(src, loader);

  const POSITION = rawData.attributes.POSITION.value;
  const NORMAL = rawData.attributes.NORMAL.value;
  const TEXCOORD_0 = rawData.attributes.TEXCOORD_0.value;
  const vertexCount = POSITION.length / 3;

  return {
    vertices: Array.from({ length: vertexCount }, (_, i) => ({
      position: vec3f(
        POSITION[i * 3],
        POSITION[i * 3 + 1],
        POSITION[i * 3 + 2],
      ),
      normal: vec3f(NORMAL[i * 3], NORMAL[i * 3 + 1], NORMAL[i * 3 + 2]),
      uv: vec2f(TEXCOORD_0[i * 2], TEXCOORD_0[i * 2 + 1]),
    })),
  };
}

function createMeshFromData(root: TgpuRoot, data: MeshData): Mesh {
  const vertexCount = data.vertices.length;

  const vertexBuffer = root
    .createBuffer(vertexLayout.schemaForCount(vertexCount), data.vertices)
    .$usage('vertex');

  return { vertexCount, vertexBuffer };
}
