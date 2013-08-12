/* 
 * fractal-terrain - Creates a patch of fractal terrain
 * Based off the code found at http://qiao.github.com/fractal-terrain-generator/demo/
 */

/*
 * Copyright (c) 2012 Brandon Jones
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

define([], function() {

    function nextPowerOfTwo(n) {
        --n;
        n = n | (n >> 1);
        n = n | (n >> 2);
        n = n | (n >> 4);
        n = n | (n >> 8);
        n = n | (n >> 16);
        return ++n;
    }

    var FractalTerrain = function(size) {
        size = nextPowerOfTwo(size) + 1;
        var indexCount = ((size-1) * 6) * (size -1);

        this.size = size;
        this.verts = new Float32Array(size*size*3);
        this.indices = new Uint16Array(indexCount);

        // Generate indices (these never change for a given terrain size)
        var x, y, i;
        for(y = 0; y < size-1; ++y) {
            for(x = 0; x < size-1; ++x) {
                i = (x + (y*size)) * 6;

                // Alternate the direction of the quad seam. Looks nicer IMO
                if((x+y)%2) {
                    this.indices[i + 0] = ((x) + ((y)*size));
                    this.indices[i + 1] = ((x+1) + ((y)*size));
                    this.indices[i + 2] = ((x) + ((y+1)*size));

                    this.indices[i + 3] = ((x) + ((y+1)*size));
                    this.indices[i + 4] = ((x+1) + ((y)*size));
                    this.indices[i + 5] = ((x+1) + ((y+1)*size));
                } else {
                    this.indices[i + 0] = ((x) + ((y)*size));
                    this.indices[i + 1] = ((x+1) + ((y+1)*size));
                    this.indices[i + 2] = ((x) + ((y+1)*size));

                    this.indices[i + 3] = ((x+1) + ((y+1)*size));
                    this.indices[i + 4] = ((x) + ((y)*size));
                    this.indices[i + 5] = ((x+1) + ((y)*size));
                }
            }
        }

        // Write out the X/Z positions, it's only the height (y) that changes
        for(y = 0; y < size; ++y) {
            for(x = 0; x < size; ++x) {
                i = (x + (y*size)) * 3;
                this.verts[i + 0] = x;
                this.verts[i + 1] = y;
            }
        }
    }

    FractalTerrain.prototype.getHeight = function(x, y) {
        return this.verts[((x + (y*this.size)) * 3) + 2];
    };

    FractalTerrain.prototype.setHeight = function(x, y, height) {
        this.verts[((x + (y*this.size)) * 3) + 2] = height;
    };

    FractalTerrain.prototype.generateTerrain = function(smoothness, height, xOff, yOff, seed) {
        var iter = 0;
        var iterCount = Math.log(this.size - 1) / Math.LN2;

        height = height || (this.size * 0.5);
        xOff = xOff || 0;
        yOff = yOff || 0;

        /*var simplex = new SimplexNoise(); // If we're gonna seed anything here's where you'd do it!

        function getOffset(x, y, depth) {
            var sign = simplex.noise((x + xOff) * 100, (y + yOff) * 100) > 0.5 ? 1 : -1;
            var reduce = 1;
            for (var i = 0; i < depth; ++i) { 
                reduce *= Math.pow(2, -smoothness);
            }
            return sign * simplex.noise((x + xOff) * 100, (y + yOff) * 100) * reduce * height;
        }*/

        function getOffset(x, y, depth) {
            var sign = Math.random() > 0.5 ? 1 : -1;
            var reduce = 1;
            for (var i = 0; i < depth; ++i) { 
                reduce *= Math.pow(2, -smoothness);
            }
            return sign * Math.random() * reduce * height;
        }

        while (iter++ < iterCount) {
            this.diamond(getOffset, iter);
            this.square(getOffset, iter);
        }
    };

    FractalTerrain.prototype.diamond = function(getOffset, iter) {
        var size = this.size - 1;
        var span = size / (1 << (iter - 1));
        var half = span * 0.5;

        var x, y, height, offset;
        for (x = 0; x < size; x += span) {
            for (y = 0; y < size; y += span) {
                // Calculate average height of surrounding verts
                height = this.getHeight(x, y);
                height += this.getHeight(x + span, y);
                height += this.getHeight(x, y + span);
                height += this.getHeight(x + span, y + span);
                height *= 0.25;

                // Get a random offset (This may need fixing)
                offset = getOffset(x + half, y + half, iter);

                // set center height
                this.setHeight(x + half, y + half, height + offset);
            }
        }
    };

    FractalTerrain.prototype.square = function(getOffset, iter) {
        var size = this.size - 1;
        var span = size / (1 << (iter - 1));
        var half = span / 2;

        // enumerate sub-dimaonds 
        var x, y, height, offset;
        for (x = 0; x < size; x += span) {
            for (y = 0; y < size; y += span) {
                var va = this.getHeight(x, y);
                var vc = this.getHeight(x + span, y);
                var vg = this.getHeight(x + half, y + half);
                var vk = this.getHeight(x, y + span);
                var vm = this.getHeight(x + span, y + span);

                var vhr = this.getHeight((x + half * 3) > size ? half : (x + half * 3), y + half);
                var vfl = this.getHeight((x - half) < 0 ? size - half : (x - half), y + half);
                var vlu = this.getHeight(x + half, (y + half * 3) > size ? half : (y + half * 3));
                var vba = this.getHeight(x + half, (y - half) < 0 ? size - half : (y - half));

                height = (va + vg + vk + vfl) * 0.25;
                offset = getOffset(x, y + half, iter);
                this.setHeight(x, y + half, height + offset);

                height = (va + vba + vc + vg) * 0.25;
                offset = getOffset(x + half, y, iter);
                this.setHeight(x + half, y, height + offset);

                height = (vc + vhr + vm + vg) * 0.25;
                offset = getOffset(x + span, y + half, iter);
                this.setHeight(x + span, y + half, height + offset);

                height = (vk + vg + vm + vlu) * 0.25;
                offset = getOffset(x + half, y + span, iter);
                this.setHeight(x + half, y + span, height + offset);
            }
        }

        // set the elevations of the rightmost and bottom vertices to 
        // equal the leftmost and topmost ones'.
        for (x = 0; x < size; x += span) {
            this.setHeight(x, size, this.getHeight(x, 0));
        }
        for (y = 0; y < size; y += span) {
            this.setHeight(size, y, this.getHeight(0, y));
        }
    };
    
    return FractalTerrain;
});