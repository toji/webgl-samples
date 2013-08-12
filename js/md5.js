/* 
 * md5Mesh.js - Parses MD5 Mesh and Animation files (idTech 4) for use in WebGL
 */
 
/*
 * Copyright (c) 2011 Brandon Jones
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
    "util/gl-util",
    "util/gl-matrix-min"
], function(glUtil) {

    "use strict";

    var BASE_PATH = "root/"
    var MAX_WEIGHTS = 6;
    var VERTEX_ELEMENTS = 11; // 3 Pos, 2 UV, 3 Norm, 3 Tangent
    var VERTEX_STRIDE = 44;
    
    var Md5Mesh = function() {
        this.joints = null;
        this.meshes = null;
    };

    Md5Mesh.prototype.load = function(gl, url, callback) {
        this.joints = new Array();
        this.meshes = new Array();
        
        var self = this;
        
        var request = new XMLHttpRequest();
        request.addEventListener("load", function() {
            self._parse(request.responseText);
            self._initializeTextures(gl);
            self._initializeBuffers(gl);
            if(callback) { callback(self); }
        });
        request.open('GET', BASE_PATH + url, true);
        request.overrideMimeType('text/plain');
        request.setRequestHeader('Content-Type', 'text/plain');
        request.send(null);

        return this;
    };

    /*
     * Md5Mesh
     */

    Md5Mesh.prototype._parse = function(src) {
        var model = this;
        
        src.replace(/joints \{([^}]*)\}/m, function($0, jointSrc) {
            jointSrc.replace(/\"(.+)\"\s(.+) \( (.+) (.+) (.+) \) \( (.+) (.+) (.+) \)/g, function($0, name, parent, x, y, z, ox, oy, oz) {

                model.joints.push({
                    name: name,
                    parent: parseInt(parent), 
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)], 
                    orient: quat4.calculateW([parseFloat(ox), parseFloat(oy), parseFloat(oz), 0])
                });
            });
        });

        src.replace(/mesh \{([^}]*)\}/mg, function($0, meshSrc) {
            var mesh = {
                shader: '',
                verts: new Array(),
                tris: new Array(),
                weights: new Array(),
                vertBuffer: null,
                indexBuffer: null,
                vertArray: null,
                elementCount: 0
            };

            meshSrc.replace(/shader \"(.+)\"/, function($0, shader) {
                mesh.shader = shader;
            });

            meshSrc.replace(/vert .+ \( (.+) (.+) \) (.+) (.+)/g, function($0, u, v, weightIndex, weightCount) {
                mesh.verts.push({
                    pos: [0, 0, 0],
                    normal: [0, 0, 0],
                    tangent: [0, 0, 0],
                    texCoord: [parseFloat(u), parseFloat(v)],
                    weight: {
                        index: parseInt(weightIndex), 
                        count: parseInt(weightCount)
                    }
                });
            });

            mesh.tris = new Array();
            meshSrc.replace(/tri .+ (.+) (.+) (.+)/g, function($0, i1, i2, i3) {
                mesh.tris.push(parseInt(i1));
                mesh.tris.push(parseInt(i2));
                mesh.tris.push(parseInt(i3));
            });
            mesh.elementCount = mesh.tris.length;

            meshSrc.replace(/weight .+ (.+) (.+) \( (.+) (.+) (.+) \)/g, function($0, joint, bias, x, y, z) {
                mesh.weights.push({
                    joint: parseInt(joint), 
                    bias: parseFloat(bias), 
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)],
                    normal: [0, 0, 0],
                    tangent: [0, 0, 0]
                });
            });

            model._compile(mesh);

            model.meshes.push(mesh);
        });
    };
    
    Md5Mesh.prototype._compile = function(mesh) {
        var joints = this.joints;
        var rotatedPos = [0, 0, 0];

        // Calculate transformed vertices in the bind pose
        for(var i = 0; i < mesh.verts.length; ++i) {
            var vert = mesh.verts[i];

            vert.pos = [0, 0, 0];
            for (var j = 0; j < vert.weight.count; ++j) {
                var weight = mesh.weights[vert.weight.index + j];
                var joint = joints[weight.joint];

                // Rotate position
                quat4.multiplyVec3(joint.orient, weight.pos, rotatedPos);

                // Translate position
                // The sum of all weight biases should be 1.0
                vert.pos[0] += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                vert.pos[1] += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                vert.pos[2] += (joint.pos[2] + rotatedPos[2]) * weight.bias;
            }
        }

        // Calculate normals/tangents
        var a = [0, 0, 0], b = [0, 0, 0];
        var triNormal = [0, 0, 0];
        var triTangent = [0, 0, 0];
        for(var i = 0; i < mesh.tris.length; i+=3) {
            var vert1 = mesh.verts[mesh.tris[i]];
            var vert2 = mesh.verts[mesh.tris[i+1]];
            var vert3 = mesh.verts[mesh.tris[i+2]];

            // Normal
            vec3.subtract(vert2.pos, vert1.pos, a);
            vec3.subtract(vert3.pos, vert1.pos, b);

            vec3.cross(b, a, triNormal);
            vec3.add(vert1.normal, triNormal);
            vec3.add(vert2.normal, triNormal);
            vec3.add(vert3.normal, triNormal);

            // Tangent
            var c2c1t = vert2.texCoord[0] - vert1.texCoord[0];
            var c2c1b = vert2.texCoord[1] - vert1.texCoord[1];
            var c3c1t = vert3.texCoord[0] - vert1.texCoord[0];
            var c3c1b = vert3.texCoord[0] - vert1.texCoord[1];

            triTangent = [c3c1b * a[0] - c2c1b * b[0], c3c1b * a[1] - c2c1b * b[1], c3c1b * a[2] - c2c1b * b[2]];
            vec3.add(vert1.tangent, triTangent);
            vec3.add(vert2.tangent, triTangent);
            vec3.add(vert3.tangent, triTangent);
        }

        var invOrient = [0, 0, 0, 0];
        // Get the "weighted" normal and tangent
        for(var i = 0; i < mesh.verts.length; ++i) {
            var vert = mesh.verts[i];

            vec3.normalize(vert.normal);
            vec3.normalize(vert.tangent);

            for (var j = 0; j < vert.weight.count; ++j) {
                var weight = mesh.weights[vert.weight.index + j];
                if(weight.bias != 0) {
                    var joint = joints[weight.joint];

                    // Rotate position
                    quat4.inverse(joint.orient, invOrient);
                    quat4.multiplyVec3(invOrient, vert.normal, weight.normal);
                    quat4.multiplyVec3(invOrient, vert.tangent, weight.tangent);
                }
            }
        }
    };
    
    Md5Mesh.prototype._initializeTextures = function(gl) {
        for(var i = 0; i < this.meshes.length; ++i) {
            var mesh = this.meshes[i];

            // Set defaults
            mesh.diffuseMap = glUtil.createSolidTexture(gl, [200, 200, 200, 255]);
            mesh.specularMap = glUtil.createSolidTexture(gl, [0, 0, 0, 255]);
            mesh.normalMap = glUtil.createSolidTexture(gl, [0, 0, 255, 255]);
            
            this._loadMeshTextures(gl, mesh);
        }
    };
    
    // Finds the meshes texures
    // Confession: Okay, so this function is a big giant cheat... 
    // but have you SEEN how those mtr files are structured?
    Md5Mesh.prototype._loadMeshTextures = function(gl, mesh) {
        // Attempt to load actual textures
        glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '.png', function(texture) {
            mesh.diffuseMap = texture;
        });
        glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '_s.png', function(texture) {
            mesh.specularMap = texture;
        });
        glUtil.loadTexture(gl, BASE_PATH + mesh.shader + '_local.png', function(texture) {
            mesh.normalMap = texture;
        });
    };
        
    // Creates the model's gl buffers and populates them with the bind-pose mesh
    Md5Mesh.prototype._initializeBuffers = function(gl) {
        var meshes = this.meshes;
        var i;
        
        var vertBufferLength = 0;
        var indexBufferLength = 0;
        for(i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            mesh.vertOffset = vertBufferLength;
            vertBufferLength += VERTEX_ELEMENTS * mesh.verts.length;
            
            mesh.indexOffset = indexBufferLength;
            indexBufferLength += mesh.elementCount;
        }
        
        // Fill the vertex buffer
        this.vertArray = new Float32Array(vertBufferLength);
        this._skin();
        this.vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertArray, gl.STATIC_DRAW);
        
        // Fill the index buffer
        var indexArray = new Uint16Array(indexBufferLength);
        for(i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            indexArray.set(mesh.tris, mesh.indexOffset);
        }
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArray, gl.STATIC_DRAW);
    };
    
    // Skins the vertexArray with the given joint set
    // Passing null to joints results in the bind pose
    Md5Mesh.prototype._skin = function(joints, vertArray, arrayOffset) {
        if(!joints) { joints = this.joints; }
        if(!vertArray) { vertArray = this.vertArray }
        if(!arrayOffset) { arrayOffset = 0; }

        var rotatedPos = [0, 0, 0];

        var vx, vy, vz;
        var nx, ny, nz;
        var tx, ty, tz;
        
        var meshes = this.meshes;
        
        for(var i = 0; i < meshes.length; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.vertOffset + arrayOffset;

            // Calculate transformed vertices in the bind pose
            for(var j = 0; j < mesh.verts.length; ++j) {
                var vertOffset = (j * VERTEX_ELEMENTS) + meshOffset;
                var vert = mesh.verts[j];

                vx = 0; vy = 0; vz = 0;
                nx = 0; ny = 0; nz = 0;
                tx = 0; ty = 0; tz = 0;

                vert.pos = [0, 0, 0];

                for (var k = 0; k < vert.weight.count; ++k) {
                    var weight = mesh.weights[vert.weight.index + k];
                    var joint = joints[weight.joint];

                    // Rotate position
                    quat4.multiplyVec3(joint.orient, weight.pos, rotatedPos);

                    // Translate position
                    vert.pos[0] += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                    vert.pos[1] += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                    vert.pos[2] += (joint.pos[2] + rotatedPos[2]) * weight.bias;
                    vx += (joint.pos[0] + rotatedPos[0]) * weight.bias;
                    vy += (joint.pos[1] + rotatedPos[1]) * weight.bias;
                    vz += (joint.pos[2] + rotatedPos[2]) * weight.bias;

                    // Rotate Normal
                    quat4.multiplyVec3(joint.orient, weight.normal, rotatedPos);
                    nx += rotatedPos[0] * weight.bias;
                    ny += rotatedPos[1] * weight.bias;
                    nz += rotatedPos[2] * weight.bias;

                    // Rotate Tangent
                    quat4.multiplyVec3(joint.orient, weight.tangent, rotatedPos);
                    tx += rotatedPos[0] * weight.bias;
                    ty += rotatedPos[1] * weight.bias;
                    tz += rotatedPos[2] * weight.bias;
                }

                // Position
                vertArray[vertOffset] = vx;
                vertArray[vertOffset+1] = vy;
                vertArray[vertOffset+2] = vz;

                // TexCoord
                vertArray[vertOffset+3] = vert.texCoord[0];
                vertArray[vertOffset+4] = vert.texCoord[1];

                // Normal
                vertArray[vertOffset+5] = nx;
                vertArray[vertOffset+6] = ny;
                vertArray[vertOffset+7] = nz;

                // Tangent
                vertArray[vertOffset+8] = tx;
                vertArray[vertOffset+9] = ty;
                vertArray[vertOffset+10] = tz;
            }
        }
    };
        
    Md5Mesh.prototype.setAnimationFrame = function(gl, animation, frame) {
        var joints = animation.getFrameJoints(frame);
        this._skin(joints);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertArray, gl.STATIC_DRAW);
    };
        
    Md5Mesh.prototype.draw =function(gl, shader) {
        if(!this.vertBuffer || !this.indexBuffer) { return; }
        
        // Bind the appropriate buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        var meshes = this.meshes;
        var meshCount = meshes.length;
        for(var i = 0; i < meshCount; ++i) {
            var mesh = meshes[i];
            var meshOffset = mesh.vertOffset * 4;

            // Set Textures
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, mesh.diffuseMap);
            gl.uniform1i(shader.uniform.diffuse, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, mesh.specularMap);
            gl.uniform1i(shader.uniform.specular, 1);

            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, mesh.normalMap);
            gl.uniform1i(shader.uniform.normalMap, 2);

            // Enable vertex arrays
            gl.enableVertexAttribArray(shader.attribute.position);
            gl.enableVertexAttribArray(shader.attribute.texture);
            gl.enableVertexAttribArray(shader.attribute.normal);
            gl.enableVertexAttribArray(shader.attribute.tangent);

            // Draw the mesh
            gl.vertexAttribPointer(shader.attribute.position, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+0);
            gl.vertexAttribPointer(shader.attribute.texture, 2, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+12);
            gl.vertexAttribPointer(shader.attribute.normal, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+20);
            gl.vertexAttribPointer(shader.attribute.tangent, 3, gl.FLOAT, false, VERTEX_STRIDE, meshOffset+32);
            
            gl.drawElements(gl.TRIANGLES, mesh.elementCount, gl.UNSIGNED_SHORT, mesh.indexOffset*2);
        }
    };

    /*
     * Md5Anim
     */

    var Md5Anim = function() {
        this.frameRate = 24;
        this.frameTime = 1000.0 / this.frameRate;
        this.hierarchy = null;
        this.baseFrame = null;
        this.frames = null;
    };
        
    Md5Anim.prototype.load = function(url, callback) {
        this.hierarchy = new Array();
        this.baseFrame = new Array();
        this.frames = new Array();
        
        var self = this;
        
        var request = new XMLHttpRequest();
        request.addEventListener("load", function() {
            self._parse(request.responseText);
            if(callback) { callback(self); }
        });
        
        request.open('GET', BASE_PATH + url, true);
        request.overrideMimeType('text/plain');
        request.setRequestHeader('Content-Type', 'text/plain');
        request.send(null);

        return this;
    };
        
    Md5Anim.prototype._parse = function(src) {
        var anim = this;
        
        src.replace(/frameRate (.+)/, function($0, frameRate) {
            anim.frameRate = parseInt(frameRate);
            anim.frameTime = 1000 / frameRate;
        });

        src.replace(/hierarchy \{([^}]*)\}/m, function($0, hierarchySrc) {
            hierarchySrc.replace(/\"(.+)\"\s([-\d]+) (\d+) (\d+)\s/g, function($0, name, parent, flags, index) {
                anim.hierarchy.push({
                    name: name,
                    parent: parseInt(parent), 
                    flags: parseInt(flags), 
                    index: parseInt(index)
                });
            });
        });

        src.replace(/baseframe \{([^}]*)\}/m, function($0, baseframeSrc) {
            baseframeSrc.replace(/\( (.+) (.+) (.+) \) \( (.+) (.+) (.+) \)/g, function($0, x, y, z, ox, oy, oz) {
                anim.baseFrame.push({
                    pos: [parseFloat(x), parseFloat(y), parseFloat(z)], 
                    orient: [parseFloat(ox), parseFloat(oy), parseFloat(oz)]
                });
            });
        });


        src.replace(/frame \d+ \{([^}]*)\}/mg, function($0, frameSrc) {
            var frame = new Array();

            frameSrc.replace(/([-\.\d]+)/g, function($0, value) {
                frame.push(parseFloat(value));
            });

            anim.frames.push(frame);
        });
    };
        
    Md5Anim.prototype.getFrameJoints = function(frame) {
        frame = frame % this.frames.length;
    
        var frameData = this.frames[frame]; 
        var joints = new Array();

        for (var i = 0; i < this.baseFrame.length; ++i) {
            var baseJoint = this.baseFrame[i];
            var offset = this.hierarchy[i].index;
            var flags = this.hierarchy[i].flags;

            var aPos = [baseJoint.pos[0], baseJoint.pos[1], baseJoint.pos[2]];
            var aOrient = [baseJoint.orient[0], baseJoint.orient[1], baseJoint.orient[2], 0];

            var j = 0;

            if (flags & 1) { // Translate X
                aPos[0] = frameData[offset + j];
                ++j;
            }

            if (flags & 2) { // Translate Y
                aPos[1] = frameData[offset + j];
                ++j;
            }

            if (flags & 4) { // Translate Z
                aPos[2] = frameData[offset + j];
                ++j;
            }

            if (flags & 8) { // Orient X
                aOrient[0] = frameData[offset + j];
                ++j;
            }

            if (flags & 16) { // Orient Y
                aOrient[1] = frameData[offset + j];
                ++j;
            }

            if (flags & 32) { // Orient Z
                aOrient[2] = frameData[offset + j];
                ++j;
            }

            // Recompute W value
            quat4.calculateW(aOrient);

            // Multiply against parent 
            //(assumes parents always have a lower index than their children)
            var parentIndex = this.hierarchy[i].parent;

            if(parentIndex >= 0) {
                var parentJoint = joints[parentIndex];

                quat4.multiplyVec3(parentJoint.orient, aPos);
                vec3.add(aPos, parentJoint.pos);
                quat4.multiply(parentJoint.orient, aOrient, aOrient);
            }

            joints.push({pos: aPos, orient: aOrient}); // This could be so much better!
        }

        return joints;
    };

    return {
        Md5Mesh: Md5Mesh,
        Md5Anim: Md5Anim
    };
});