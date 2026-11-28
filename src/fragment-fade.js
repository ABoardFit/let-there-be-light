import {Material} from '@babylonjs/core/Materials/material.js';
import {MaterialPluginBase} from '@babylonjs/core/Materials/materialPluginBase.js';

const installed = new WeakMap();

class FragmentFade extends MaterialPluginBase {
  constructor(material) {
    super(material, 'FragmentFade', 900, { FRAGMENT_DITHER_FADE: true }, true, true);
    this.doNotSerialize = true;
  }

  getClassName() { return 'FragmentFade'; }

  getCustomCode(shaderType) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        float fragmentFadeBayer2(vec2 pixel) {
          vec2 bit = mod(floor(pixel), 2.0);
          return 2.0 * bit.x + 3.0 * bit.y - 4.0 * bit.x * bit.y;
        }
      `,
      // StandardMaterial multiplies color.a by the mesh visibility immediately
      // before this hook. Surviving pixels must restore alpha=1 as well as write
      // depth, otherwise the transparent canvas still reveals what is behind.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        if (visibility < 1.0) {
          vec2 pixel = floor(gl_FragCoord.xy);
          float coverage = (16.0 * fragmentFadeBayer2(pixel)
            + 4.0 * fragmentFadeBayer2(pixel * 0.5)
            + fragmentFadeBayer2(pixel * 0.25) + 0.5) / 64.0;
          if (visibility <= coverage) discard;
          color.a = 1.0;
        }
      `,
    };
  }
}

/**
 * Make mesh.visibility fade coverage instead of making a solid see-through.
 * Install on each grass, exterior-stone and interior-stone submaterial before
 * its first render. All use the same screen-pixel mask, so an erased front pixel
 * cannot reveal the back of that same fragment. Visibility=1 changes no pixels.
 * RGB, textures, UVs and existing material plugins are left untouched.
 */
export function enableFragmentFade(material) {
  if (installed.has(material)) return installed.get(material);
  // Explicit opaque mode prevents mesh.visibility from moving just the grass
  // submesh into Babylon's transparent queue. Opaque rendering keeps depth writes.
  material.transparencyMode = Material.MATERIAL_OPAQUE;
  const plugin = new FragmentFade(material);
  installed.set(material, plugin);
  return plugin;
}
