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
    "light",
    "util/gl-util",
    "util/gl-matrix-min"
], function (Light, GLUtil) {

    "use strict";
    
    var MAX_BONES_PER_MESH = 50;

    // Skinned Model Shader
    var skinnedModelVS = [
        Light.SpotLight.vertexFunction,

        "attribute vec3 position;",
        "attribute vec2 texture;",
        "attribute vec3 normal;",
        "attribute vec3 weights;",
        "attribute vec3 bones;",

        "uniform mat4 viewMat;",
        "uniform mat4 modelMat;",
        "uniform mat4 projectionMat;",
        "uniform mat4 boneMat[" + MAX_BONES_PER_MESH + "];",
        
        "varying vec2 vTexture;",
        "varying vec3 vNormal;",
        
        "mat4 accumulateSkinMat() {",
        "   mat4 result = weights.x * boneMat[int(bones.x)];",
        "   result = result + weights.y * boneMat[int(bones.y)];",
        "   result = result + weights.z * boneMat[int(bones.z)];",
        "   return result;",
        "}",
        
        // A "manual" rotation matrix transpose to get the normal matrix
        "mat3 getNormalMat(mat4 mat) {",
        "   return mat3(mat[0][0], mat[1][0], mat[2][0], mat[0][1], mat[1][1], mat[2][1], mat[0][2], mat[1][2], mat[2][2]);",
        "}",

        "void main(void) {",
        "   mat4 skinMat = modelMat * accumulateSkinMat();",
        "   mat3 normalMat = getNormalMat(skinMat);",
        
        "   vec4 vPosition = skinMat * vec4(position, 1.0);",
        "   gl_Position = projectionMat * viewMat * vPosition;",

        "   vTexture = texture;",
        "   vNormal = normalize(normal * normalMat);",
        "   setupLight(vPosition.xyz);",
        "   setupShadow(vPosition);",
        "}"
    ].join("\n");

    var skinnedModelFS = [
        "precision mediump float;",

        Light.SpotLight.fragmentFunction,

        "uniform vec3 ambient;",
        "uniform sampler2D diffuse;",

        "varying vec2 vTexture;",
        "varying vec3 vNormal;",

        "void main(void) {",
        "   vec4 diffuseColor = texture2D(diffuse, vTexture);",
        "   vec3 lightValue = computeLight(vNormal, diffuseColor.a);",
        "   float shadowValue = computeShadow();",
        "   vec3 finalColor = diffuseColor.rgb * ambient;",
        "   finalColor += diffuseColor.rgb * lightValue * shadowValue;",
        "   gl_FragColor = vec4(finalColor, 1.0);",
        "}"
    ].join("\n");

    var skinnedModelShader = null;

    var identityMat = mat4.identity();

    // Vertex Format Flags
    var ModelVertexFormat = {
        Position: 0x0001,
        UV: 0x0002,
        UV2: 0x0004,
        Normal: 0x0008,
        Tangent: 0x0010,
        Color: 0x0020,
        BoneWeights: 0x0040
    };

    function GetLumpId(id) {
        var str = "";
        str += String.fromCharCode(id & 0xff);
        str += String.fromCharCode((id >> 8) & 0xff);
        str += String.fromCharCode((id >> 16) & 0xff);
        str += String.fromCharCode((id >> 24) & 0xff);
        return str;
    }

    var SkinnedModel = function () {
        this.vertexFormat = 0;
        this.vertexStride = 0;
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.meshes = null;
        this.complete = false;
        this.bones = null;
        this.boneMatrices = null;
        this._dirtyBones = true;
    };

    SkinnedModel.prototype.load = function (gl, url, callback) {
            var self = this,
            vertComplete = false,
            modelComplete = false;

        // Load the binary portion of the model
        var vertXhr = new XMLHttpRequest();
        vertXhr.open('GET', url + ".wglvert", true);
        vertXhr.responseType = "arraybuffer";
        vertXhr.onload = function() {
            var arrays = self._parseBinary(this.response);
            self._compileBuffers(gl, arrays);
            vertComplete = true;
            
            if (modelComplete) {
                self.complete = true;
                if (callback) { callback(self); }
            }
        };
        vertXhr.send(null);

        // Load the json portion of the model
        var jsonXhr = new XMLHttpRequest();
        jsonXhr.open('GET', url + ".wglmodel", true);
        jsonXhr.onload = function() {
            // TODO: Error Catch!
            var model = JSON.parse(this.responseText);
            self._parseModel(model);
            self._compileMaterials(gl, self.meshes);
            modelComplete = true;

            if (vertComplete) {
                self.complete = true;
                if (callback) { callback(self); }
            }
        };
        jsonXhr.send(null);

        if (!skinnedModelShader) {
            skinnedModelShader = GLUtil.createProgram(gl, skinnedModelVS, skinnedModelFS);
        }
    };

    SkinnedModel.prototype._parseBinary = function (buffer) {
        var arrays = {
            vertexArray: null,
            indexArray: null
        };

        var header = new Uint32Array(buffer, 0, 3);
        if(GetLumpId(header[0]) !== "wglv") {
            throw new Error("Binary file magic number does not match expected value.");
        }
        if(header[1] > 1) {
            throw new Error("Binary file version is not supported.");
        }
        var lumpCount = header[2];

        header = new Uint32Array(buffer, 12, lumpCount * 3);

        var i, lumpId, offset, length;
        for(i = 0; i < lumpCount; ++i) {
            lumpId = GetLumpId(header[i * 3]);
            offset = header[(i * 3) + 1];
            length = header[(i * 3) + 2];

            switch(lumpId) {
                case "vert":
                    arrays.vertexArray = this._parseVert(buffer, offset, length);
                    break;

                case "indx":
                    arrays.indexArray = this._parseIndex(buffer, offset, length);
                    break;
            }
        }

        if(this.vertexFormat & ModelVertexFormat.BoneWeights) {
            this.boneMatrices = new Float32Array(16 * MAX_BONES_PER_MESH);
        }
        
        return arrays;
    };

    SkinnedModel.prototype._parseVert = function(buffer, offset, length) {
        var vertHeader = new Uint32Array(buffer, offset, 2);
        this.vertexFormat = vertHeader[0];
        this.vertexStride = vertHeader[1];

        return new Uint8Array(buffer, offset + 8, length - 8);
    };

    SkinnedModel.prototype._parseIndex = function(buffer, offset, length) {
        return new Uint16Array(buffer, offset, length / 2);
    };

    SkinnedModel.prototype._compileBuffers = function (gl, arrays) {
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, arrays.vertexArray, gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arrays.indexArray, gl.STATIC_DRAW);
    };

    quat4.fromAngleAxis = function(angle, axis, dest) {
        // The quaternion representing the rotation is
        //   q = cos(A/2)+sin(A/2)*(x*i+y*j+z*k)
        if (!dest) dest = quat4.create();
        
        var half = angle * 0.5;
        var s = Math.sin(half);
        dest[3] = Math.cos(half);
        dest[0] = s * axis[0];
        dest[1] = s * axis[1];
        dest[2] = s * axis[2];
        
        return dest;
    };

    SkinnedModel.prototype._parseModel = function(doc) {
        var i, bone;

        this.meshes = doc.meshes;
        this.bones = doc.bones ? doc.bones : [];

        var tempMat = mat4.create();
        // Force all bones to use efficient data structures
        for (i in this.bones) {
            bone = this.bones[i];

            bone.pos = vec3.create(bone.pos);
            bone.rot = quat4.create(bone.rot);
            bone.bindPoseMat = mat4.create(bone.bindPoseMat);
            bone.boneMat = mat4.create();
            if (bone.parent == -1) {
                // These two lines apply a 90 deg rotation to the root node to make the model z-up
                var rotAdjustment = quat4.fromAngleAxis(Math.PI * 0.5, [1, 0, 0]);
                quat4.multiply(bone.rot, rotAdjustment, bone.rot);
                
                bone.worldPos = bone.pos;
                bone.worldRot = bone.rot;
            } else {
                bone.worldPos = vec3.create();
                bone.worldRot = quat4.create();
            }
        }
    };

    SkinnedModel.prototype._compileMaterials = function (gl, meshes) {
        var i, mesh;
        for (i in meshes) {
            mesh = meshes[i];
            mesh.diffuse = GLUtil.loadTexture(gl, mesh.defaultTexture);
        }
    };

    SkinnedModel.prototype.draw = function (gl, viewMat, projectionMat, light) {
        if (!this.complete) { return; }

        var shader = skinnedModelShader,
            i, j,
            mesh, submesh, boneSet,
            indexOffset, indexCount;

        // Bind the appropriate buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        gl.useProgram(shader.program);

        gl.uniform3f(shader.uniform.ambient, 0.15, 0.15, 0.15);

        gl.uniformMatrix4fv(shader.uniform.viewMat, false, viewMat);
        gl.uniformMatrix4fv(shader.uniform.modelMat, false, identityMat);
        gl.uniformMatrix4fv(shader.uniform.projectionMat, false, projectionMat);

        if(light) {
            light.bindUniforms(gl, shader.uniform);
        }

        gl.enableVertexAttribArray(shader.attribute.position);
        gl.enableVertexAttribArray(shader.attribute.texture);
        gl.enableVertexAttribArray(shader.attribute.normal);

        gl.enableVertexAttribArray(shader.attribute.weights);
        gl.enableVertexAttribArray(shader.attribute.bones);

        // Setup the vertex layout
        gl.vertexAttribPointer(shader.attribute.position, 3, gl.FLOAT, false, this.vertexStride, 0);
        gl.vertexAttribPointer(shader.attribute.texture, 2, gl.FLOAT, false, this.vertexStride, 12);
        gl.vertexAttribPointer(shader.attribute.normal, 3, gl.FLOAT, false, this.vertexStride, 20);
        gl.vertexAttribPointer(shader.attribute.weights, 3, gl.FLOAT, false, this.vertexStride, 48);
        gl.vertexAttribPointer(shader.attribute.bones, 3, gl.FLOAT, false, this.vertexStride, 60);

        if(this._dirtyBones) {
            for(i = 0; i < this.bones.length; ++i) {
                var bone = this.bones[i];
                this.boneMatrices.set(bone.boneMat, i * 16);
            }
        }

        for (i in this.meshes) {
            mesh = this.meshes[i];
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, mesh.diffuse);
            gl.uniform1i(shader.uniform.diffuse, 0);
            
            for (j in mesh.submeshes) {
                submesh = mesh.submeshes[j];
                
                boneSet = this.boneMatrices.subarray(submesh.boneOffset * 16, (submesh.boneOffset + submesh.boneCount) * 16);
                gl.uniformMatrix4fv(shader.uniform.boneMat, false, boneSet);
                
                gl.drawElements(gl.TRIANGLES, submesh.indexCount, gl.UNSIGNED_SHORT, submesh.indexOffset*2);
            }
        }
    };

    return SkinnedModel;
});