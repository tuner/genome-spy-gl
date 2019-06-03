precision mediump float;

@import ./includes/xdomain;
@import ./includes/sampleTransition;

attribute float y;
attribute lowp vec4 color;
attribute float size; // Diameter or width/height

attribute float zoomThreshold;

uniform float viewportHeight;
uniform lowp float devicePixelRatio;

/** Maximum point size in pixels */
uniform lowp float maxMaxPointSizeAbsolute;

/** Minimum Maximum point size in pixels */
uniform lowp float minMaxPointSizeAbsolute;

/** Maximum point size as the fraction of sample height */
uniform lowp float maxPointSizeRelative;

uniform float zoomLevel;
uniform float fractionToShow;

varying vec4 vColor;
varying float vOpacity;
varying float vSize;


float computeThresholdFactor() {
    float margin = zoomLevel * 0.005;
    return 1.0 - sqrt(smoothstep(zoomThreshold, zoomThreshold + margin, 1.0 - zoomLevel * fractionToShow));
}

float computeMaxSize(float height) {
    return max(smoothstep(0.0, 3.0, viewportHeight * height) * minMaxPointSizeAbsolute,
        min(maxMaxPointSizeAbsolute, viewportHeight * height * maxPointSizeRelative));
}

void main(void) {

    float thresholdFactor = computeThresholdFactor();
    float normalizedX = normalizeX();

    vec2 translated = transit(normalizedX, (1.0 - y));
    float translatedY = translated[0];
    float height = translated[1];

    vec2 ndc = vec2(normalizedX, 1.0 - translatedY) * 2.0 - 1.0;

    gl_Position = vec4(ndc, 0.0, 1.0);

    vSize = size * computeMaxSize(height) * thresholdFactor * devicePixelRatio;

    gl_PointSize = vSize;

    vColor = color;
    vOpacity = thresholdFactor;
}