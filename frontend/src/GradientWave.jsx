import { useEffect, useRef } from 'react';

const vertexShader = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision mediump float;
varying vec2 vUv;
uniform vec2 resolution;
uniform float time;

void main() {
  vec2 uv = vUv;
  float t = time * 0.16;
  float contour = uv.y
    + 0.105 * sin(uv.x * 5.3 + t)
    + 0.047 * sin(uv.x * 10.1 - t * 0.76)
    + 0.018 * sin(uv.x * 19.0 + t * 0.55);

  vec3 deep = vec3(0.035, 0.145, 0.255);
  vec3 blue = vec3(0.055, 0.285, 0.465);
  vec3 sky = vec3(0.20, 0.53, 0.75);
  vec3 ice = vec3(0.59, 0.81, 0.93);
  vec3 white = vec3(0.83, 0.93, 0.98);

  vec3 color = mix(deep, blue, smoothstep(0.0, 0.46, contour));
  color = mix(color, sky, smoothstep(0.40, 0.51, contour));
  color = mix(color, ice, smoothstep(0.53, 0.59, contour));
  color = mix(color, white, smoothstep(0.595, 0.63, contour));
  color = mix(color, sky, smoothstep(0.655, 0.715, contour));
  color = mix(color, deep, smoothstep(0.82, 1.0, contour));

  float softLight = 0.5 + 0.5 * sin(uv.x * 3.8 - t * 1.2);
  color += vec3(0.025, 0.075, 0.105) * softLight * (1.0 - smoothstep(0.45, 0.9, uv.y));
  color *= 0.92 + 0.08 * uv.y;
  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function GradientWave() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    let gl;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    } catch {
      gl = null;
    }
    if (!gl) return () => canvas.remove();

    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    if (!vertex || !fragment) return () => canvas.remove();

    const program = gl.createProgram();
    if (!program) return () => canvas.remove();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => canvas.remove();

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'position');
    const resolution = gl.getUniformLocation(program, 'resolution');
    const time = gl.getUniformLocation(program, 'time');
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let startTime = 0;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
      const width = Math.max(1, Math.round(container.clientWidth * ratio));
      const height = Math.max(1, Math.round(container.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      draw(performance.now());
    }

    function draw(timestamp) {
      if (!startTime) startTime = timestamp;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, motionPreference.matches ? 0 : (timestamp - startTime) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function animate(timestamp) {
      draw(timestamp);
      if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate);

    function handleMotionChange() {
      window.cancelAnimationFrame(frameId);
      draw(performance.now());
      if (!motionPreference.matches) frameId = window.requestAnimationFrame(animate);
    }
    motionPreference.addEventListener?.('change', handleMotionChange);

    return () => {
      window.cancelAnimationFrame(frameId);
      motionPreference.removeEventListener?.('change', handleMotionChange);
      resizeObserver.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      canvas.remove();
    };
  }, []);

  return <div ref={containerRef} className="auth-wave" />;
}
