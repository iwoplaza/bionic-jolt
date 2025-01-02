import { quat } from 'wgpu-matrix';
import { meshAsset } from 'jolted/assets';
import { vec3f, vec4f } from 'typegpu/data';
import { trait, type World, type ExtractSchema, Not } from 'koota';
import { MaterialTrait, MeshTrait, TransformTrait, getOrAdd } from 'jolted';

import pentagonPath from '../assets/pentagon.obj?url';

/**
 * Settings given to a world.
 */
export const MapSettings = trait({
  farDistance: 100,
  deSpawnThreshold: 100,
});

/**
 * The entity who's position is used to determine the progress of the map.
 * Typically the player.
 */
export const MapProgressMarker = trait({});

export type MapChunk = ExtractSchema<typeof MapChunk>;
export const MapChunk = trait({
  length: 1,
});

/**
 * The chunk that's at end of the currently generated map.
 * Used to know where to append new chunks.
 */
export const MapTail = trait({});

const pentagonMesh = meshAsset({ url: pentagonPath });

export function updateMapSystem(world: World) {
  const settings = getOrAdd(world, MapSettings);
  const progressMarker = world.queryFirst(MapProgressMarker);
  const progressMarkerPos = progressMarker?.get(TransformTrait).position;

  if (!progressMarkerPos) return;

  world
    .query(MapChunk, TransformTrait, Not(MapTail))
    .updateEach(([chunk, transform], entity) => {
      // Is well above the marker?
      if (
        transform.position.y - chunk.length >
        progressMarkerPos.y + settings.deSpawnThreshold
      ) {
        entity.destroy();
      }
    });

  // Add new chunks
  let limit = 10;
  do {
    const tail = world.queryFirst(MapTail);
    const tailPosition = tail?.get(TransformTrait).position;
    const tailChunk = tail?.get(MapChunk);

    if (
      !tail ||
      !tailPosition ||
      tailPosition.y > progressMarkerPos.y - settings.farDistance
    ) {
      const xPos = (Math.random() * 2 - 1) * 0.3;
      const zPos = (Math.random() * 2 - 1) * 0.3;
      const yPos = (tailPosition?.y ?? 0) - (tailChunk?.length ?? 0);
      world.spawn(
        MapChunk({ length: 1 + Math.random() * 5 }),
        TransformTrait({
          position: vec3f(xPos, yPos, zPos),
          rotation: quat.fromEuler(
            0,
            Math.random() * Math.PI,
            0,
            'xyz',
            vec4f(),
          ),
        }),
        MeshTrait(pentagonMesh),
        MapTail,
        MaterialTrait({ albedo: vec3f(1, 0.5, 0) }),
      );
      tail?.remove(MapTail);
    } else {
      break;
    }

    limit--;
  } while (limit > 0);
}