import { describe, expect, it } from 'vitest';

import { skirtFragment, skirtVertex } from '../src/render/shaders';

// A linked side's skirt is hidden where the neighbor runs as deep. Moving the
// hidden vertices off screen (gl_Position outside clip space) clips, rather
// than drops, a quad with hidden and shown corners: where a deeper beach (sand
// rows / inland sections) meets a shallower linked one, that drew a long
// striped sliver to the top-right corner of the screen. Hide by discard.
describe('skirt shader', () => {
  it('never throws a vertex outside clip space to hide it', () => {
    expect(skirtVertex).not.toMatch(/gl_Position\s*=\s*vec4\(\s*2\.0/);
    expect(skirtVertex).toMatch(/vHide\s*=/);
  });
  it('drops hidden fragments', () => {
    expect(skirtFragment).toMatch(/varying float vHide;/);
    expect(skirtFragment).toMatch(/if \(vHide > 0\.5\) discard;/);
  });
});
