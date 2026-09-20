# 机械蝴蝶 · 交互式发条装置 — Design Spec

## 1. Concept + Subject

一座悬浮在虚空中的精密发条蝴蝶标本：不是生物学意义上的鳞翅，而是钟表匠与航空工程师合作的幻想造物。访客像站在博物馆展柜前，又像拆开后盖的机芯观察者——齿轮咬合、羽翼发光、能量沿翅脉流动。

**语气**：冷静、精密、略带赛博诗意。不是可爱的机械宠物，而是「被点亮的精密仪器」。

## 2. Inspiration DNA

| 维度 | 提取 |
|------|------|
| 材质 | 黄铜/青铜机身 + 枪灰金属骨架 + 半透明能量膜 + 发光线脉 |
| 运动 | 翅膀非线性扑动（升力相位差）+ 行星齿轮系同步旋转 + 翅脉能量脉冲 |
| 色调 | 深空蓝黑底 × 黄铜金属 × 冷青发光 × 琥珀高光 |
| 构图 | 中心主体占屏 55–70%，负空间留给粒子与 HUD 注记 |

## 3. Palette + Typography

### Palette

| 角色 | Hex | 用途 |
|------|-----|------|
| Void | `#05060a` | 场景背景 / 页面底色 |
| Deep Panel | `#0c0e16` | HUD 面板 |
| Brass | `#c9a66b` | 齿轮、机芯主金属 |
| Bronze Dark | `#5c4a38` | 机身接缝、暗部金属 |
| Gunmetal | `#2a2e3a` | 翅骨、骨架 |
| Energy Cyan | `#4de8ff` | 翅脉发光、能量膜、主强调色 |
| Warm Amber | `#ffb84d` | 齿轮高光、火花、次强调 |
| Bone | `#e8e0d4` | 正文文字 |
| Muted | `#8a8478` | 次级标注 |

### Typography

- **Display / Latin**: `"Segoe UI", "Segoe UI Variable", system-ui, sans-serif` — 细体大标题 + 宽字距英文小标
- **Body / CJK**: `"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`
- **Mono HUD**: `"Cascadia Code", "Consolas", "SF Mono", monospace` — 齿轮参数、转速读数
- Scale: Hero title 48–72px / Section 28–36px / HUD label 11–12px / Body 15–16px
- 字距：英文小标 `letter-spacing: 0.28em`；中文标题 `0.08em`

## 4. Style Lock（一句话）

> **Cyber-Steampunk × Editorial Dark HUD × PBR-Emissive 机械写实**：深空编辑排版叠在可发光的黄铜机芯之上，页面像展签，场景像机芯透视图。

## 5. Section Structure

| # | 类型 | 一点主张 |
|---|------|----------|
| 1 | Hero 全屏 3D | 机械蝴蝶是主角；标题与操作提示浮层 |
| 2 | 机芯解剖 | 滚动推近齿轮系，展示咬合传动链 |
| 3 | 羽翼能量 | 翅脉/膜片发光机制，能量脉冲可视化 |
| 4 | 交互控制台 | 转速、齿轮比、扑动幅度、能量强度可调 |
| 5 | Footer | 铭牌信息 + 重置视角 |

## 6. Interaction List

| 触发 | 视觉变化 |
|------|----------|
| 页面加载 | 蝴蝶从静止「上弦」：齿轮渐转、翅脉点亮、粒子苏醒 |
| 鼠标移动 | 相机轻微视差；蝴蝶朝向光源/指针微微侧倾 |
| 拖拽（Orbit） | 环绕观察机芯，默认阻尼平滑 |
| 滚动 | 相机沿样条推进：远景 → 齿轮特写 → 翅面 → 拉回全景；同步切换 HUD 注记 |
| 点击蝴蝶 / 能量脉冲按钮 | 能量爆发：翅膜亮度尖峰 + 粒子喷发 + 齿轮短暂加速 |
| 控制台滑杆 | 实时改 `flapSpeed` / `gearRatio` / `glowIntensity` / `spread` |
| 悬停齿轮组 | 该齿轮 emissive 提升，HUD 显示齿数与转速 |
| 双击空白 | 重置相机与参数 |

## 7. Tech Stack

- **Three.js**（本地 `vendor/three.module.js`，离线可跑）
- **OrbitControls**（本地模块）
- **后期**：UnrealBloomPass（发光翅脉/齿轮）
- **几何**：程序化生成（ExtrudeGeometry 齿轮齿、TubeGeometry 翅脉、LatheGeometry 机身）
- **材质**：MeshStandardMaterial（金属）+ MeshPhysicalMaterial（透膜）+ MeshBasicMaterial（发光核）
- **动画**：自写时钟 + 齿轮传动比耦合 + 扇贝曲线扑动（非匀速正弦，带攻角相位差）
- **DOM HUD**：绝对定位半透明面板，不同层叠于 canvas 上
- **无 GSAP/网络字体**：关键帧与缓动手写，保证离线

## 8. Signature Moments

1. **上弦启动**（0–2.4s）：主发条从 0 加速，行星齿轮依次咬合，翅脉 cyan 能量沿翅根→翅缘点亮。
2. **能量脉冲**（点击）：全身 emissive 尖峰 + bloom 增强 + 蝶群粒子逆时针喷出再回收。
3. **齿轮特写滚动段**：相机贴近 thorax 齿轮系，齿数/转速 HUD 浮现，背景压暗。

## 9. Priority

### Core Must
- 完整机械蝴蝶（机身段节 + 4 翅 + 翅骨翅脉 + 可见咬合齿轮系 + 触角）
- 扑动与齿轮传动同步动画
- Bloom 发光
- Orbit 交互 + 滚动相机路径
- 控制台（速度/齿轮比/发光/张开角）
- 深色 HUD 排版页面

### Optional Bonus
- 齿轮 hover 标注
- 粒子火花与浮尘
- 鼠标侧倾响应
- 双击重置
- 腿部微动

## 10. Build Paths

```
a1/
  design.md
  index.html
  css/style.css
  js/main.js
  js/butterfly.js
  js/gears.js
  js/materials.js
  js/scene.js
  js/ui.js
  js/controls.js
  vendor/three.module.js
  vendor/OrbitControls.js
  vendor/EffectComposer.js
  vendor/RenderPass.js
  vendor/UnrealBloomPass.js
  vendor/ShaderPass.js
  vendor/CopyShader.js
  vendor/LuminosityHighPassShader.js
  vendor/Pass.js
  vendor/MaskPass.js
```

Or `present_files` entry: `index.html`.
