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
    "util/gl-util",
    "util/gl-matrix-min"
], function (GLUtil) {

    "use strict";

    var DirectionalLight = function () {
        this.direction = vec3.create();
        this._dirty = true;

        this.color = vec3.createFrom(1.0, 1.0, 1.0);
        this.brightness = 0.8;
        this._scaledColor = vec3.create();
    };

    DirectionalLight.prototype.bindUniforms = function(gl, uniforms) {
        vec3.scale(this.color, this.brightness, this._scaledColor);
        
        gl.uniform3fv(uniforms.lightColor, this._scaledColor);
        gl.uniform3fv(uniforms.lightDirection, this.direction);
    };

    // Shaders
    DirectionalLight.vertexFunction = [
        "uniform vec3 lightDirection;",

        "varying vec3 vLightToPoint;",
        "varying vec3 vEyeToPoint;",

        "void setupLight(vec3 worldPosition) {",
        "   vLightToPoint = lightDirection;",
        "   vEyeToPoint = -worldPosition;",
        "}"
    ].join("\n");

    DirectionalLight.fragmentFunction = [
        "varying vec3 vLightToPoint;",
        "varying vec3 vEyeToPoint;",

        "uniform vec3 lightColor;",

        "vec3 computeLight(vec3 normal, float specularLevel) {",
        // Lambert term
        "   vec3 l = normalize(vLightToPoint);",
        "   vec3 n = normalize(normal);",
        "   float lambertTerm = max(dot(n, l), 0.0);",

        "   if(lambertTerm < 0.0) { return vec3(0.0, 0.0, 0.0); }",

        "   vec3 lightValue = (lightColor * lambertTerm);",

        // Specular
        "   vec3 e = normalize(vEyeToPoint);",
        "   vec3 r = reflect(-l, n);",
        "   float shininess = 8.0;",
        "   float specularFactor = pow(clamp(dot(r, e), 0.0, 1.0), shininess) * specularLevel;",
        "   vec3 specularColor = lightColor;",
        "   lightValue += (specularColor * specularFactor);",

        "   return lightValue;",
        "}"
    ].join("\n");
    
    var SpotLight = function () {
        this.position = vec3.create();
        this.target = vec3.create();
        this._direction = vec3.create();
        this._viewMat = mat4.create();
        this._projectionMat = mat4.create();
        this._dirty = true;

        this.color = vec3.createFrom(1.0, 1.0, 1.0);
        this.brightness = 1.5;
        this._scaledColor = vec3.create();
        this.radius = 10.0;
        this.innerAngle = Math.PI * 0.1;
        this.outerAngle = Math.PI * 0.15;
    };

    SpotLight.prototype.initShadowBuffer = function(gl, ext, size) {
        if(!ext) {
            this.depthTexture = GLUtil.createSolidTexture(gl, [255, 255, 255]);
            return;
        }

        if(!size) { size = 256; }
        // Create the FBO for the depth texture

        // Create a color texture
        this.colorTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Create the depth texture used as our shadow map
        this.depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);

        this.shadowFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);

        if(!gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
            console.error("Framebuffer incomplete!");
        }
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.depthTextureSize = size;
    };

    SpotLight.prototype.bindFramebuffer = function(gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.viewport(0, 0, this.depthTextureSize, this.depthTextureSize); // Match the viewport to the texture size
        gl.colorMask(false, false, false, false); // Don't write to the color channels at all
        gl.clear(gl.DEPTH_BUFFER_BIT); // Clear only the depth buffer
    };

    SpotLight.prototype.bindUniforms = function(gl, uniforms, textureUnit) {
        if(!textureUnit) { textureUnit = 1; }

        vec3.subtract(this.target, this.position, this._direction);
        vec3.scale(this.color, this.brightness, this._scaledColor);
        
        gl.uniform3fv(uniforms.lightPosition, this.position);
        gl.uniform3fv(uniforms.lightColor, this._scaledColor);
        gl.uniform3fv(uniforms.lightSpotDirection, this._direction);

        gl.uniform1f(uniforms.lightRadius, this.radius);
        gl.uniform1f(uniforms.lightSpotInnerAngle, Math.cos(this.innerAngle));
        gl.uniform1f(uniforms.lightSpotOuterAngle, Math.cos(this.outerAngle));

        // Bind the shadown map texture
        gl.uniformMatrix4fv(uniforms.lightViewMat, false, this.getViewMat());
        gl.uniformMatrix4fv(uniforms.lightProjectionMat, false, this.getProjectionMat());

        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.uniform1i(uniforms.shadowMap, textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    };

    var upVec = vec3.createFrom(0, 0, 1);
    SpotLight.prototype.getViewMat = function () {
        if (this._dirty) {
            mat4.lookAt(this.position, this.target, upVec, this._viewMat);
            //this._dirty = false;
        }

        return this._viewMat;
    };

    SpotLight.prototype.getProjectionMat = function () {
        if (this._dirty) {
            var angle = this.outerAngle * (180 / Math.PI) * 2.0;
            mat4.perspective(angle, 1.0, 1.0, 256, this._projectionMat);
            //this._dirty = false;
        }

        return this._projectionMat;
    };

    // Shaders
    SpotLight.vertexFunction = [
        "uniform vec3 lightPosition;",
        "uniform mat4 lightViewMat;",
        "uniform mat4 lightProjectionMat;",

        "varying vec3 vLightToPoint;",
        "varying vec3 vEyeToPoint;",
        "varying vec4 vShadowPosition;",

        "const mat4 depthScaleMatrix = mat4(0.5, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.5, 0.5, 0.5, 1.0);",

        "void setupLight(vec3 worldPosition) {",
        "   vLightToPoint = lightPosition - worldPosition;",
        "   vEyeToPoint = -worldPosition;",
        "}",

        "void setupShadow(vec4 worldPosition) {",
        "   vShadowPosition = depthScaleMatrix * lightProjectionMat * lightViewMat * worldPosition;",
        "}"
    ].join("\n");

    SpotLight.fragmentFunction = [
        "varying vec3 vLightToPoint;",
        "varying vec3 vEyeToPoint;",
        "varying vec4 vShadowPosition;",

        "uniform vec3 lightPosition;",
        "uniform sampler2D shadowMap;",
        "uniform vec3 lightColor;",
        "uniform float lightRadius;",

        "uniform vec3 lightSpotDirection;",
        "uniform float lightSpotInnerAngle;",
        "uniform float lightSpotOuterAngle;",

        "vec3 computeLight(vec3 normal, float specularLevel) {",
        // Lambert term
        "   vec3 l = normalize(vLightToPoint);",
        "   vec3 n = normalize(normal);",
        "   float lambertTerm = max(dot(n, l), 0.0);",

        "   if(lambertTerm < 0.0) { return vec3(0.0, 0.0, 0.0); }",

        // Light attenuation
        "   float lightDist = length(vLightToPoint);",
        "   float d = max(lightDist - lightRadius, 0.0) / lightRadius + 1.0;",
        "   float distAttn = 1.0 / (d * d);",
        
        // Spot attenuation
        "   vec3 sd = normalize(lightSpotDirection);",
        "   float spotAngleDelta = lightSpotInnerAngle - lightSpotOuterAngle;",
        "   float spotAngle = dot(-l, sd);",
        "   float spotAttn = clamp((spotAngle - lightSpotOuterAngle) / spotAngleDelta, 0.0, 1.0);",

        "   vec3 lightValue = (lightColor * lambertTerm * distAttn * spotAttn);",

        // Specular
        "   vec3 e = normalize(vEyeToPoint);",
        "   vec3 r = reflect(-l, n);",
        "   float shininess = 8.0;",
        "   float specularFactor = pow(clamp(dot(r, e), 0.0, 1.0), shininess) * specularLevel;",
        "   vec3 specularColor = lightColor;",
        "   lightValue += (specularColor * specularFactor);",

        "   return lightValue;",
        "}",

        "float computeShadow() {",
        "   vec3 depth = vShadowPosition.xyz / vShadowPosition.w;",
        "   float shadowValue = texture2D(shadowMap, depth.xy).r;",
        "   depth.z *= 0.999;",
        "   if(shadowValue < depth.z) { return 0.0; }",
        "   return 1.0;",
        "}"
    ].join("\n");

    return {
        DirectionalLight: DirectionalLight,
        SpotLight: SpotLight
    };
});