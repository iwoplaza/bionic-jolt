import {
  type Vec4f,
  builtin,
  looseArrayOf,
  looseStruct,
  type m4x4f,
  mat4x4f,
  struct,
  type v3f,
  type v4f,
  vec2f,
  vec3f,
  vec4f,
} from 'typegpu/data';
import tgpu, {
  type Vertex,
  type ExperimentalTgpuRoot,
  type TgpuBuffer,
  type TgpuRenderPipeline,
  type Uniform,
} from 'typegpu/experimental';
import { mat4 } from 'wgpu-matrix';
import { Viewport } from './viewport.ts';

export const vertexLayout = tgpu.vertexLayout((n) =>
  looseArrayOf(looseStruct({ position: vec3f, normal: vec3f, uv: vec2f }), n),
);

const UniformsStruct = struct({
  modelMat: mat4x4f,
  normalModelMat: mat4x4f,
}).$name('Uniforms');

const POVStruct = struct({
  viewProjMat: mat4x4f,
}).$name('POV');

const bindGroupLayout = tgpu
  .bindGroupLayout({
    uniforms: { uniform: UniformsStruct },
    pov: { uniform: POVStruct },
  })
  .$name('uniforms');

const vertexFn = tgpu
  .vertexFn(
    { idx: builtin.vertexIndex, pos: vec3f, normal: vec3f, uv: vec2f },
    { pos: builtin.position, normal: vec3f, uv: vec2f },
  )
  .does(`(
    @builtin(vertex_index) idx: u32,
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f
  ) -> Output {
    var out: Output;
    out.pos = pov.viewProjMat * uniforms.modelMat * vec4f(pos, 1.0);
    out.normal = (uniforms.normalModelMat * vec4f(normal, 0.0)).xyz;
    out.uv = uv;
    return out;
  }`)
  .$uses({
    uniforms: bindGroupLayout.bound.uniforms,
    pov: bindGroupLayout.bound.pov,
  });

const fragmentFn = tgpu
  .fragmentFn({}, vec4f)
  .does(`(@location(0) normal: vec3f, @location(1) uv: vec2f) -> @location(0) vec4f {
    let ambient = vec3f(0.1, 0.15, 0.2);
    let diffuse = vec3f(1.0, 0.9, 0.7);
    let att = max(0., dot(normalize(normal), vec3f(0., 1., 0.)));
    let albedo = vec3f(1., 1., 1.);
    return vec4f((ambient + diffuse * att) * albedo, 1.0);
  }`);

export interface Mesh {
  vertexCount: number;
  vertexBuffer: TgpuBuffer<
    ReturnType<(typeof vertexLayout)['schemaForCount']>
  > &
    Vertex;
}

export interface Transform {
  position: v3f;
  rotation: v4f;
  scale: v3f;
}

export class Renderer {
  private _objects: { mesh: Mesh; transform: Transform }[] = [];
  private readonly _matrices: {
    proj: m4x4f;
    view: m4x4f;
    model: m4x4f;
    normalModel: m4x4f;
  };
  private readonly _viewport: Viewport;
  private readonly _context: GPUCanvasContext;
  private readonly _uniformsBuffer: TgpuBuffer<typeof UniformsStruct> & Uniform;
  private readonly _povBuffer: TgpuBuffer<typeof POVStruct> & Uniform;
  private readonly _renderPipeline: TgpuRenderPipeline<Vec4f>;

  constructor(
    public readonly root: ExperimentalTgpuRoot,
    public readonly canvas: HTMLCanvasElement,
  ) {
    const device = root.device;

    this._context = canvas.getContext('webgpu') as GPUCanvasContext;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this._context.configure({
      device: device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

    this._viewport = new Viewport(root, canvas.width, canvas.height);

    this._matrices = {
      proj: mat4.identity(mat4x4f()),
      view: mat4.identity(mat4x4f()),
      model: mat4.identity(mat4x4f()),
      normalModel: mat4.identity(mat4x4f()),
    };

    this._uniformsBuffer = root
      .createBuffer(UniformsStruct, {
        modelMat: mat4.identity(mat4x4f()),
        normalModelMat: mat4.identity(mat4x4f()),
      })
      .$usage('uniform');

    this._povBuffer = root
      .createBuffer(POVStruct, {
        viewProjMat: mat4.identity(mat4x4f()),
      })
      .$usage('uniform');

    // Listen to changes in window size and resize the canvas
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this._viewport.resize(canvas.width, canvas.height);
      this._updateProjection();
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const uniformsBindGroup = root.createBindGroup(bindGroupLayout, {
      uniforms: this._uniformsBuffer,
      pov: this._povBuffer,
    });

    this._renderPipeline = root
      .withVertex(vertexFn, {
        pos: vertexLayout.attrib.position,
        normal: vertexLayout.attrib.normal,
        uv: vertexLayout.attrib.uv,
      })
      .withFragment(fragmentFn, { format: presentationFormat })
      .withPrimitive({ topology: 'triangle-list' })
      .withDepthStencil({
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      })
      .createPipeline()
      .with(bindGroupLayout, uniformsBindGroup);
  }

  private _updateProjection() {
    mat4.perspective(
      (45 / 180) * Math.PI, // fov
      this.canvas.width / this.canvas.height, // aspect
      0.1, // near
      1000.0, // far
      this._matrices.proj,
    );
  }

  private _updatePOV() {
    this._povBuffer.write({ viewProjMat: this._matrices.proj });
  }

  private _updateUniforms() {
    this._uniformsBuffer.write({
      modelMat: this._matrices.model,
      normalModelMat: this._matrices.normalModel,
    });
  }

  private _updateModel(transform: Transform) {
    const model = this._matrices.model;
    mat4.identity(model);

    mat4.scale(model, transform.scale, model);
    mat4.translate(model, transform.position, model);
    mat4.multiply(model, mat4.fromQuat(transform.rotation), model);

    mat4.invert(model, this._matrices.normalModel);
    mat4.transpose(this._matrices.normalModel, this._matrices.normalModel);
  }

  render() {
    this._updatePOV();

    for (const { mesh, transform } of this._objects) {
      this._updateModel(transform);
      this._updateUniforms();

      this._renderPipeline
        .withColorAttachment({
          view: this._context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        })
        .withDepthStencilAttachment({
          view: this._viewport.depthTextureView,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1.0,
        })
        .with(vertexLayout, mesh.vertexBuffer)
        .draw(mesh.vertexCount);
    }

    this._objects = [];

    this.root.flush();
  }

  addObject(mesh: Mesh, transform: Transform) {
    this._objects.push({ mesh, transform });
  }
}