/* 
 * faceted-mesh.js - Processes a simple indexec mesh into a mesh where each triangle renders as a flat face
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

define([
    "js/util/gl-matrix-min.js"
], function(glUtil) {

    var FacetedMesh = function(gl, verts, indices, smoothFactor) {
        this.generateVertsWithNormals(verts, indices);

        this.vertBuffer = gl.createBuffer();
        this.setNormalSmoothing(gl, smoothFactor);
    }

    FacetedMesh.prototype.generateVertsWithNormals = function(verts, indices) {
        var i, j, l, idx;
        var buffer = new Float32Array(indices.length * 6);
        var vertCount = verts.length / 3;
        var smoothedNormals = [];
        var vertNormals = new Array(indices.length);
        var faceNormals = new Array(indices.length);

        for(i = 0; i < vertCount; ++i) {
            smoothedNormals.push(vec3.create([0, 0, 0]));
        }

        // Calculate normals/tangents
        var idx0, idx1, idx2;

        var a = vec3.create(), 
            b = vec3.create(),
            pos0 = vec3.create(), 
            pos1 = vec3.create(), 
            pos2 = vec3.create();

        l = indices.length;
        for(i = 0; i < l; i+=3) {
            j = i * 6;

            idx0 = indices[i];
            idx1 = indices[i+1];
            idx2 = indices[i+2];

            buffer[j + 0] = pos0[0] = verts[idx0*3 + 0];
            buffer[j + 1] = pos0[1] = verts[idx0*3 + 1];
            buffer[j + 2] = pos0[2] = verts[idx0*3 + 2];

            buffer[j + 6] = pos1[0] = verts[idx1*3 + 0];
            buffer[j + 7] = pos1[1] = verts[idx1*3 + 1];
            buffer[j + 8] = pos1[2] = verts[idx1*3 + 2];

            buffer[j + 12] = pos2[0] = verts[idx2*3 + 0];
            buffer[j + 13] = pos2[1] = verts[idx2*3 + 1];
            buffer[j + 14] = pos2[2] = verts[idx2*3 + 2];
            
            // Face normal calculation
            vec3.subtract(pos2, pos0, a);
            vec3.subtract(pos1, pos0, b);
            vec3.cross(a, b, a);
            vec3.normalize(a);

            vec3.add(smoothedNormals[idx0], a);
            vec3.add(smoothedNormals[idx1], a);
            vec3.add(smoothedNormals[idx2], a);

            faceNormals[i] = vec3.create(a);
            faceNormals[i+1] = vec3.create(a);
            faceNormals[i+2] = vec3.create(a);
        }

        // Normalize the summed up vertex normals
        for(i = 0; i < l; ++i) {
            vertNormals[i] = vec3.normalize(smoothedNormals[indices[i]]);
        }

        this.vertCount = indices.length;
        this.vertArray = buffer;
        this.vertNormals = vertNormals;
        this.faceNormals = faceNormals
        return buffer;
    };

    FacetedMesh.prototype.setNormalSmoothing = function(gl, smoothFactor) {
        var i, j, l;

        if(!smoothFactor) { smoothFactor = 0.0; }

        var a = vec3.create();
        var faceNormals = this.faceNormals;
        var vertNormals = this.vertNormals;
        var vertArray = this.vertArray;

        // Mix the per-vertex normals and face normals for a bit more interest
        for(i = 0, l = this.vertCount; i < l; ++i) {
            j = i * 6;

            vec3.lerp(faceNormals[i], vertNormals[i], smoothFactor, a);
            vec3.normalize(a);

            vertArray[j + 3] = a[0];
            vertArray[j + 4] = a[1];
            vertArray[j + 5] = a[2];
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertArray, gl.STATIC_DRAW);
    }

    FacetedMesh.prototype.draw = function(gl, shader) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.enableVertexAttribArray(shader.attribute.position);
        gl.enableVertexAttribArray(shader.attribute.normal);
        gl.vertexAttribPointer(shader.attribute.position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(shader.attribute.normal, 3, gl.FLOAT, false, 24, 12);

        gl.drawArrays(gl.TRIANGLES, 0, this.vertCount);
    };

    return FacetedMesh;
});