# 小型开放城市：GitHub 参考检视

2026-10-14 实查 GitHub 仓库信息、完整文件树和选定源码；随后实现本项目的城市驾驶版。没有更换引擎或导入外部代码/模型。gta7 的在线演示实际试玩了驾驶和上下车，其余外部项目仅检视源码；没有运行外部仓库测试。

当前游戏已有 Three 0.186 WebGPU、约 9.4 万可破坏体素、汽车/赛道和 F 上下车功能。建议增加城市交通与角色表现，保留已有 GPU voxel 破坏系统；不整套替换成其他项目的物理引擎。

## 优先参考的 5 个仓库

### 1. depixeled-chris/gta7：最清楚的功能拆分和分块生成

[仓库](https://github.com/depixeled-chris/gta7) · [MIT](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/LICENSE) · 主线提交 `bd5ee61af4759881c235077605d33be9342108e8`，2026-06-01，未归档。Three 0.160，现有源码为 WebGL 路线。

- 上下车：[`src/main.ts` 的 toggleVehicle](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/main.ts#L245) 查询最近车辆、切换 foot/driving、将角色放到车侧。[`src/entities/Player.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/entities/Player.ts) 提供步行移动。[`src/systems/FollowCamera.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/systems/FollowCamera.ts) 用独立步行/驾驶参数、指数阻尼和速度前瞻，不是直接固定相机到车上。
- 交通：[`src/systems/Vehicles.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/systems/Vehicles.ts) 让 AI 沿 x/z 直车道循环，横向偏离后回归车道，按距离/制动能力对前方行人降速。并不是完整带转弯和路口调度的道路网络。[`Pedestrians.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/systems/Pedestrians.ts) 有 walk/shoved/gibbed 状态；解压游戏可只借鉴走动/避车，没必要复制伤害玩法。
- 世界：[`src/world/streaming.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/world/streaming.ts) 用 `(seed, i, j)` 固定生成街区；[`ChunkManager.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/systems/ChunkManager.ts) 分离 load/unload hooks，有不同载入/卸载半径防边界抖动；[`StreamedWorld.ts`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/world/StreamedWorld.ts) 同步增删碰撞网格与灯具。
- **不要照搬的缺口**：[`main.ts#L78`](https://github.com/depixeled-chris/gta7/blob/bd5ee61af4759881c235077605d33be9342108e8/src/main.ts#L78) 明确 TODO，卸载 chunk 目前只移除场景组，尚未 pool/dispose geometry。对长时间游逛，这不构成可靠 GPU 内存释放。我们的破坏状态还需另行保存，不能每次重新生成街区就恢复成完整建筑。

### 2. swift502/Sketchbook：角色—车门—座位状态机

[仓库](https://github.com/swift502/Sketchbook) · [MIT](https://github.com/swift502/Sketchbook/blob/62f4b7986fd1ce1e4f91daba89ef032c20a6ce55/LICENSE) · **已归档**，主线提交 `62f4b7986fd1ce1e4f91daba89ef032c20a6ce55`，2024-10-10。Three **0.113**、TS 3.9、旧 Cannon 体系，不是 WebGPU 即插即用库。

- [`Character.ts`](https://github.com/swift502/Sketchbook/blob/62f4b7986fd1ce1e4f91daba89ef032c20a6ce55/src/ts/characters/Character.ts) 找最近可用座位、entryPoint，并转移输入控制权。
- [`EnteringVehicle.ts`](https://github.com/swift502/Sketchbook/blob/62f4b7986fd1ce1e4f91daba89ef032c20a6ce55/src/ts/characters/character_states/vehicles/EnteringVehicle.ts) 关闭人物自身物理，attach 到车辆，按左右侧播放动作，从车门位置插值到座位，结束后进入 Driving/Sitting。
- [`ExitingVehicle.ts`](https://github.com/swift502/Sketchbook/blob/62f4b7986fd1ce1e4f91daba89ef032c20a6ce55/src/ts/characters/character_states/vehicles/ExitingVehicle.ts) 负责下车插值和退出后 falling/rolling/idle/关门状态；[`CameraOperator.ts`](https://github.com/swift502/Sketchbook/blob/62f4b7986fd1ce1e4f91daba89ef032c20a6ce55/src/ts/core/CameraOperator.ts) 是目标/球面半径轨道相机。
- 可借鉴状态边界、车门/座位锚点和动画结束事件。不要搬旧渲染/物理依赖，也不要把源码 MIT 自动当成所有角色/动作素材已经完成授权核查。

### 3. StarKnightt/ocean-drive：暖色城市、实际交通和安全下车

[仓库](https://github.com/StarKnightt/ocean-drive) · [MIT 主许可证](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/LICENSE) · 提交 `9b61e33161c5c2bdfcdf83b7f7485be51107d1ac`，2026-09-30，未归档。包依赖 Three **0.186.1**，但 [`main.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/main.js) 实际使用 **WebGLRenderer**。

- [`src/world/traffic-sim.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/world/traffic-sim.js) 是不依赖 Three 的交通核心：IDM 跟车，红黄灯制动，人行横道让行，障碍阻塞与绕行。适合先做“一条双向城市道路”；不等同于通用全城路网寻路。
- [`src/vehicles/index.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/vehicles/index.js) 按车门接近判定上车；下车枚举出口、比较地面高度并调用 walker.blocked，空间不够则继续留在车内。比固定将玩家瞬移到左侧更适合拥挤街区。
- [`src/world/cars-glb.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/world/cars-glb.js) 使用 Blender 汽车、独立车轮/方向盘轴心和座位锚点；同材质停放车辆合批，设 LOD 与距离裁剪。[`src/world/lod.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/world/lod.js) 隐藏远处设施、车辆；这是有限街区的可见性优化，不是真正卸载/流式城市。
- **移植边界**：GLSL `onBeforeCompile` 材质、WebGL 后处理不能直接复用到现有 WebGPU；[`batched-cull.js`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/src/renderer/batched-cull.js) 还读 BatchedMesh 私有内部，宜参考思路，使用公开 API 重做。
- **素材边界**：[`assets/mixamo/MANIFEST.md`](https://github.com/StarKnightt/ocean-drive/blob/9b61e33161c5c2bdfcdf83b7f7485be51107d1ac/assets/mixamo/MANIFEST.md) 明确角色/动作来自 Adobe Mixamo，raw FBX 不可独立重新分发。主 MIT 不覆盖这条单独素材规则。`package.json` 写 ISC，与根 MIT 不一致，保留实际根许可并逐件核查素材。

### 4. Mugen87/yuka：渲染无关的路径/避障工具

[仓库](https://github.com/Mugen87/yuka) · [MIT](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/LICENSE) · 主线提交 `10591304811222d6856020d5de129b39ef43b58d`，日期 **2023-01-16**；GitHub metadata pushed_at 是 2026-10-04，这不代表主线代码最近有更新。

- [`FollowPathBehavior.js`](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/src/steering/behaviors/FollowPathBehavior.js) 逐路点推进并 Seek/Arrive；[`OnPathBehavior.js`](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/src/steering/behaviors/OnPathBehavior.js) 对预测位置投影到路径，约束道路走廊；[`ObstacleAvoidanceBehavior.js`](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/src/steering/behaviors/ObstacleAvoidanceBehavior.js) 生成局部避障力。
- [`NavMeshLoader.js`](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/src/navigation/navmesh/NavMeshLoader.js) 从 glTF/GLB 建 navmesh；[`examples/steering/followPath/index.html`](https://github.com/Mugen87/yuka/blob/10591304811222d6856020d5de129b39ef43b58d/examples/steering/followPath/index.html) 展示 setRenderComponent/sync，使模拟与画面分离。
- 可运行在 WebGPU 场景旁边，因为 AI 不依赖渲染器；旧 Three 示例不能直接当新版 API 样板。它不自带红绿灯、路权或破坏后的动态导航更新。第一版固定 sidewalk/车道路线更简单，之后再按需引入库。

### 5. mrdoob/three.js：当前 WebGPU 地貌和角色实例化

[仓库](https://github.com/mrdoob/three.js) · MIT · 固定检视提交 `286e2d8cba7088982eb9068d4bb8f68e42c3bf67`，2026-10-13；dev 分支继续活跃，例子使用的版本应与我们的 0.186 对齐，避免直接使用未来 dev API。

- [`examples/webgpu_tsl_procedural_terrain.html`](https://github.com/mrdoob/three.js/blob/286e2d8cba7088982eb9068d4bb8f68e42c3bf67/examples/webgpu_tsl_procedural_terrain.html)：WebGPURenderer + MeshStandardNodeMaterial，TSL noise 形变、采邻点算法线、按高度/坡度混色。适合外围山地/公园背景，不是 chunk streamer；GPU 顶点变形也不会自动修改我们的 CPU/voxel 碰撞。
- [`examples/webgpu_skinning_instancing_individual.html`](https://github.com/mrdoob/three.js/blob/286e2d8cba7088982eb9068d4bb8f68e42c3bf67/examples/webgpu_skinning_instancing_individual.html)：当前 WebGPU 骨骼角色实例化方向，可作为较多 NPC 的后续优化参考。先做少量角色，再用真实 CPU/GPU 预算决定是否迁移。

## 扩大检索后的筛选

GitHub 实搜 `open-world language:JavaScript`、`procedural-city` 等，另外检查了 imNauman/mini-gta6、YukihiroKimuraJ/mini-gta-3d、obecerra3/OpenWorldJS、t-mw/citygen、jeromeetienne/threex.proceduralcity。前 3 个 GitHub 未识别到根许可证，先不作为可直接复制代码/素材的推荐。`threex.proceduralcity` 有 MIT 代码，但最后推送 2014-01-25，源码用已移除的 Geometry/GeometryUtils/CubeGeometry；images/LICENSE.txt 另有 **CC BY-NC-SA 3.0** flare 图片，不能随 MIT 任意商用。因此没有把“搜到项目”当成“适合直接导入”。

## 第一段可玩的范围建议

这是从参考源码与现有架构推导的分阶段方向，其中首段驾驶与拆除回路已实现；第三人称人物、NPC、交通、任务和流式世界仍待后续：

1. 保留现有可破坏中心街区；外围先加 2×2 左右的静态街区与循环道路，只有玩家附近一个拆除区进入昂贵 GPU voxel 模拟。附近 NPC/车辆用统一碰撞查询，远处保持便宜网格显示。
2. 一名第三人称角色、一辆可驾驶车，步行/驾驶相机切换，F 上下车，堵门时检查多个安全出口；优先复用自己的 Car/Player，而不是装另一套完整引擎。
3. 少量行人沿 sidewalk 路点循环，车辆在固定车道跟车/让行；先证明连续漫游不卡死、不穿模、停止后继续走，再扩展转弯/路口。
4. 一个轻量跑腿/拆除任务，沿用积分与排行榜。将 GTA 类的城市自由活动作为结构参考，维持“开车、逛街、拆楼解压”的原创定位。
5. 小地图、快速重置、车辆重生；世界流式卸载和“已破坏街区如何保存”独立设计并验证。不要靠把 9.4 万体素街区整片复制多次来实现开放世界。

首个验收回路：步行 → 找车 → 上车 → 驾驶穿过外围街道 → 对人车/建筑碰撞作出反应 → 下车落在可站立位置 → 拆除目标 → 重置/刷新后计分与玩家记录保持一致。随后才值得增加无限世界、复杂交通或大量 NPC。

## 本项目 v0.2.0 已实现

- 复用原有 Car/Player 与 three-avbd：城市从步行开始，F 上下车，WASD 驾驶、Space 手刹、B 加速；手机摇杆与按钮可用。
- 驾驶撞坏可破坏物体、继续累积拆除分数，再下车拆楼。外圈 89 栋原有背景建筑增加静态碰撞，避免人物、车辆、镜头和工具穿过；主楼仍是唯一可拆楼体。
- 安全下车检查实际平面车速，堵门时枚举其他出口；离车后可召回，复用同一个车辆物理槽。
- 城市小地图显示玩家、车辆和建筑，并区分可拆主楼与实心外围。
- 此版本未加入 NPC、AI 交通、人物动画、新任务、城市流式加载或全部建筑破坏；不是完整 GTA5 规模的世界。

验证：41 个自动化测试、3 个 GPU 测试、TypeScript 与生产构建通过。Ego 浏览器实测驾驶、刹车、安全下车、撞物计分（944 分）、下车继续拆除（1695 分）、实心建筑阻挡，以及 390×844 触控摇杆和 844×390 横屏。触屏使用浏览器模拟，尚未覆盖真实手机机型。

## X 上的关卡表现参考

[Techartist 的 Vice City 风格原型](https://x.com/techartist_/status/2108960267359117371)，发于 2026-10-11 00:38（北京时间）：沿霓虹海滨城镇、大道与码头的首个任务。作者在帖子中提到 Three.js / Rapier / Blender；所检查的帖子没有 GitHub 链接，因此仅用作城市氛围与任务动线参考，不作为开源代码来源。

## v0.3.0 的后续实现

2026-10-14 用户明确继续加入路人、自动交通、简单小任务和 ocean-drive 暖色城市。现有渲染/体素引擎继续保留；8 辆车沿两条圆角道路循环，路口阶段、跟车距离、过街路人和玩家阻挡由自己的确定性 CPU 模拟实现。14 位程序化服装与四肢动画路人采用双向人行路线和过街路径。暖色店铺、棕榈与咖啡露台由项目自身模型套件编写，没有导入外部代码或 Mixamo 素材。

新任务是三段路口兜风、街角取件后到南部公园步行交付、拆除街角指定区域；徽章按首次完成保存，不混入原拆除排行榜。当前地图仍是有限街区，未实现无限流式世界、复杂城市路网或驾驶其他 NPC 车辆。
