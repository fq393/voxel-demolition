# 拆楼实验室

在线试玩：[拆楼实验室](https://voxel-demolition-vanche.vercel.app)。

基于 [sbobyn/three-voxel-destruction](https://github.com/sbobyn/three-voxel-destruction) 的改作，保留 MIT 许可和 Poly Haven / NASA 资产来源。新增中文界面、90 秒拆除挑战、匿名昵称、共享排行榜和无法锁定鼠标时的拖动视角。

进入时会生成一个随机昵称，可以直接用，也可以修改。无需注册。默认是没有倒计时的自由拆除，显示本局积分但不上传排行榜。每个原本固定的方块首次松脱或移除得 1 分；选择 90 秒挑战后，结束时自动上传，排行榜保存每个玩家的最高分，展示前 20 名和个人排名。1800 分是入门目标，达到后仍可继续冲分直到时间结束。昵称和身份保存在当前浏览器；清除站点数据或更换浏览器会得到新身份。

菜单、暂停和后台不计入挑战时间。上传失败可点击重试，重复上传同一局不会重复计分。昵称修改会同步到已经保存的成绩。

```sh
npm ci
npm run build
npm run preview
```

打开 http://127.0.0.1:5189 。需要支持 WebGPU 的浏览器；首次启动需要加载材质、编译着色器和校准性能。中文菜单可选自由拆除或 90 秒挑战。

- WASD 移动，鼠标转向，左键使用工具，滚轮切换工具。
- 无法锁定鼠标时按住右键拖动视角，左键仍可发射。
- Space / E 上升，Q / C 下降；F 切换飞行与步行，Shift 加速。
- X 慢动作，T 切换时间，R 重建，Esc 暂停。
- 手机：左摇杆移动，右侧拖动看向，右下角使用工具。

打底层或用激光切承重处会比零散打窗户更有效。

本地开发排行榜需要服务端 Redis 环境变量（仅放在被 Git 忽略的 `.env.local`），先运行 `node --env-file=.env.local --experimental-transform-types scripts/local-api.ts`，再运行 `npm run dev`。开发服务器会把 `/api` 代理到 5190 端口。静态 `npm run preview` 只用于查看构建，不提供本地排行榜 API。

构建产物在 dist/；本地预览使用该产物。不属于从零重写的引擎，尚未做大规模设备兼容测试。
