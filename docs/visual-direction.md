# Folio 2025：拆楼解压游戏的画质参考

研究日期：2026-10-12。只读检查 GitHub 仓库树和选定源码，不下载整个资源库；本报告本身不代表游戏已应用以下变化。

参考仓库 [fq393/folio-2025](https://github.com/fq393/folio-2025) 是 [brunosimon/folio-2025](https://github.com/brunosimon/folio-2025) 的 fork。检视提交：`41046b57eeed8d156d9c3fd7fa259900baef7816`。下方链接固定到这个提交，避免参考漂移。

## 源码中实际用了什么

| 表面效果/流程 | 证据 | 对拆楼游戏的意义 |
|---|---|---|
| Blender 创作、GLB 导出，运行时统一材质 | [readme.md 的 Blender Export/Compress](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/readme.md)、`resources/folio-2025.blend`、`static/*/*Visual.glb`/`*Physical.glb` | 高辨识度道具首先来自作者设计的几何轮廓、比例和组件，不能仅靠增加 bloom 复制。导出时先关闭 palette 节点，运行时再设置。未在 Blender 内逐一检查模型拓扑，所以不把特定 bevel 参数或烘焙方法当成已确认事实。 |
| 共享色板，不是全场靠复杂 PBR | [Materials.js createPalette/createFromMaterial/updateObject](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Materials.js)、[MeshDefaultMaterial.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Materials/MeshDefaultMaterial.js) | 自定义 `MeshLambertNodeMaterial` 用 palette 基色、按法线方向形成 core shadow，接收投影并用彩色阴影混合。近地反射色采样地形，不是完整实时 GI。统一色彩与明暗关系可以让简单几何看起来像同一套玩具。 |
| 单个定向光、有限范围阴影、按画质降档 | [Ligthing.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Ligthing.js)、[Quality.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Quality.js) | 阴影跟随相机有效区域，地图尺寸高档 2048 / 低档 512，radius 3 / 2；默认移动设备低档。适合做清楚的落地关系，避免全场多个昂贵投影光。 |
| 温和 bloom 与模拟微缩摄影模糊 | [Rendering.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Rendering.js)、[Passes/cheapDOF.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Passes/cheapDOF.js) | WebGPU/TSL RenderPipeline；bloom threshold 1 / strength 0.25。高档才加 cheapDOF：按照屏幕 Y 距中心远近混合 hash blur，不根据真实相机深度计算景深。拆楼第一人称模式不宜照搬边缘模糊，否则影响瞄准；可用于菜单远景/可选俯视镜头。 |
| 显示模型与物理代理分离 | [Objects.js getFromModel](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/Objects.js)、[References.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/References.js) | 名字带 physical 表示物理对象，fixed/dynamic 表示类型；子节点 trimesh/hull/cuboid/tube/ball 生成碰撞体，生成后从显示树移除。glTF userData 读出摩擦、回弹和分类；ref/reference 命名作为摆放点。当前游戏是 GPU voxel 破坏，不能把这些完整 Rapier 物理对象直接代替可破坏方块。 |
| 成批道具实例化、只更新变化对象 | [World/Benches.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/World/Benches.js)、[InstancedGroup.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/InstancedGroup.js) | 一套几何+材质生成多份 InstancedMesh；长椅物理体初始 sleeping，活动才标记 needsUpdate。适合周围装饰/多套关卡物品，不给每个细节单独创建更新逻辑。 |
| 资源压缩与解码流程 | [scripts/compress.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/scripts/compress.js)、[ResourcesLoader.js](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/sources/Game/ResourcesLoader.js) | GLB 先 ETC1S 再 Draco，独立贴图 KTX，UI WebP；GLTFLoader 接入 DRACO/KTX2Loader。资源解码器缓存复用。导入少量原创模型时才引入这套链，不必为了纯程序化方块增加解码包。 |

## 建议按这 5 件事借鉴

1. **先提升物品轮廓与结构层次。** 做一套原创“玩具城市”道具：长椅木条/金属腿、路灯底座/灯罩、广告牌边框/支柱、花盆土层/植物簇、垃圾桶桶身/盖子。已有 `src/world.ts` 道具多数尺寸较小，先让结构读得清楚。仍需由当前 voxel 数据表达可破坏部分，不能把漂亮不可破坏的 GLB 蒙在方块外面。
2. **收敛色板和材质角色。** 灰蓝建筑、暖木/橙色设施、柔和绿色植物，点亮交互目标；让同角色材质共用色彩与明暗规则，减少不相关随机颜色。借鉴 Folio 的 palette/colored-shadow 方向，逐步调整当前材料而非复制整个 Game 单例依赖。
3. **沿用已有渲染能力，调好实际观感。** 当前 `src/render.ts` 已有 4096 阴影、AO、bloom、ACES、雾和半球光；并不缺“再加一个 bloom”。优先调阴影有效区域/方向、地面接触关系、曝光、环境色，让木条和金属支架可读。质量降档再降低阴影/后处理成本，模糊只给非瞄准镜头。
4. **增加“玩具桌面”场景构图。** 保留破坏主体，外围布置少量有设计的设施、植栽、围栏和地面标线，让主楼和散落碎片有尺度参照。重复的外围装饰用实例化；需要参与破坏的设施继续进入同一个 voxel 世界，防止出现视觉/计分/碰撞不一致。
5. **服务于解压节奏。** 把自由拆除做成醒目的默认选择，挑战/排行榜保留为可选；击中和倒塌反馈短促清楚，快速再来一局。Folio 的明快模型和弱发光能支持轻松氛围，避免直接照搬其汽车探索玩法或全部地图。此项是针对用户“解压小游戏”定位的设计建议，而不是参考仓库已有拆楼功能。

## 授权与署名边界

- 根目录 [license.md](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/license.md) 是 MIT，著作权写 **Copyright (c) 2025 Bruno Simon**。如复制实质性源码或相应资源，应保留版权与 MIT 许可，不写成原创全作。
- `package.json` 的 `license` 字段写 ISC，与根许可证不一致；本次按实际 MIT 文本记录，不静默把它当统一 ISC。下载/复用具体资源前再检查它所在目录的独立来源或许可。
- [static/sounds/musics/license.md](https://github.com/fq393/folio-2025/blob/41046b57eeed8d156d9c3fd7fa259900baef7816/static/sounds/musics/license.md) 单独提供 CC0 文本；不能据此推断所有外部音频/品牌标志都适用同一授权。
- 当前最稳妥路径是参考结构/渲染方法，制作原创道具。没有复制参考仓库的模型、音乐、个人品牌标识或整个地图，也没有在本报告中声称这些美术变化已经发布。
