import * as twgl from "twgl.js";
import { rgb } from "d3-color";
import { Matrix4 } from "math.gl";
import { getPlatformShaderDefines, fp64ify } from "../gl/includes/fp64-utils";
import Track from "./track";

export default class WebGlTrack extends Track {
    constructor(genomeSpy, config) {
        super(genomeSpy, config);
    }

    async initialize(trackContainer) {
        await super.initialize(trackContainer);
    }

    initializeWebGL() {
        // Canvas for WebGL
        this.glCanvas = this.createCanvas();

        const gl = twgl.getContext(this.glCanvas);

        if (!gl) {
            throw new Error(
                "Unable to initialize WebGL. Your browser or machine may not support it."
            );
        }

        this.gl = gl;

        const bg = rgb(this.config.plotBackground || "white");

        gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, 1);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this._shaderDefines = getPlatformShaderDefines(gl);
    }

    /**
     * @param {string} shaderCode
     */
    processShader(shaderCode) {
        return this._shaderDefines + "\n" + shaderCode;
    }

    adjustGl() {
        const gl = this.gl;

        gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
        gl.canvas.height = this.getHeight() * window.devicePixelRatio;

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        this.viewportProjection = Object.freeze(
            new Matrix4().ortho({
                left: 0,
                right: gl.canvas.clientWidth,
                bottom: this.getHeight() || 1,
                top: 0,
                near: 0,
                far: 500
            })
        );
    }

    getDomainUniforms() {
        const domain = this.genomeSpy.getViewportDomain();
        // TODO: const range = domain.transform()

        return {
            uXScale: fp64ify(1.0 / domain.width()),
            uXTranslate: fp64ify(-domain.lower / domain.width()),
            ONE: 1.0
        };
    }
}
