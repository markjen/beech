import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Layer } from '@babylonjs/core/Layers/layer';
import '@babylonjs/core/Layers/layerSceneComponent';
import type { Scene } from '@babylonjs/core/scene';

import { rgbToCss, type Palette } from '../palette';

/** Full-screen background gradient, redrawn only when the palette changes. */
export class Sky {
  private readonly tex: DynamicTexture;
  private readonly layer: Layer;
  private lastKey = '';

  constructor(scene: Scene) {
    this.tex = new DynamicTexture('sky', { width: 4, height: 256 }, scene, false);
    this.layer = new Layer('skyLayer', null, scene, true);
    this.layer.texture = this.tex;
  }

  update(p: Palette): void {
    const key = rgbToCss(p.skyTop) + rgbToCss(p.skyBottom) + rgbToCss(p.fog);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    // texture v runs bottom-to-top on screen
    g.addColorStop(0, rgbToCss(p.fog));
    g.addColorStop(0.45, rgbToCss(p.skyBottom));
    g.addColorStop(1, rgbToCss(p.skyTop));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    this.tex.update(false);
  }
}
