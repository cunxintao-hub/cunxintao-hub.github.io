/* ============================================================
   src/config.js · 数值配置总表（唯一数值来源）
   依据：文档 11《数值配置总表》
   规则（00 §4.1）：所有概率、时长、速度、消耗写在这里，
   业务代码禁止出现魔法数字；调手感只改这张表，不改逻辑。
   ============================================================ */
(function (FG) {
  'use strict';

  const CONFIG = {
    /* 01 核心循环：钓鱼 */
    fishing: {
      waitMin: 2500, waitMax: 6000,       // 抛竿→咬钩等待(ms)
      /* 玩家反应窗口：在文档默认值基础上各 +1s（手感调简单，01 §2 基准值见注释） */
      biteWindow: 4000,                   // 咬钩响应窗口(ms)（基准 3000，+1s）
      biteBaseRate: 0.9,                  // 基础咬钩概率
      roundsMin: 3, roundsMax: 4,         // 张力判定轮次
      requiredHitsRatio: 0.6,             // 需要命中比例（4 轮需 3 次、3 轮需 2 次；基准 0.75）
      cursorSpeed: 0.105,                 // 指针速度 %/ms（≈105%/s，单程约 950ms）
      targetWidthMin: 0.20, targetWidthMax: 0.28, // 绿区宽度占比
      reelDuration: 6000,                 // 收杆时长(ms)（基准 5000，+1s）
      /* 🆕 收杆改造（真实手感 + 总难度不升）：
         - reelStartPerHit：张力阶段每个「命中」给收杆的初始进度（预判越准，起手越高）
         - reelDecayPerSec：不点击时每秒回退（鱼在挣，松线就退）
         - reelStartMax：初始进度上限，防止轮次多时直接白给
         难度核算（初始装备 gain≈6.93%/次、窗口 6s）：
           旧：需 100/6/6.27 ≈ 2.66 次/秒（约 16 次满）
           新·刚好达标(命中 2)：(84/6+4)/6.93 ≈ 2.60 次/秒（约 14 次）
           新·全中(命中 3~4)：≈2.2 次/秒 —— 更轻松，作为预判奖励 */
      reelGainPerClick: 6.3,              // 每次点击进度增益 %（原 5.7，上调以抵消回退带来的额外消耗）
      reelStartPerHit: 8,                 // 🆕 每个命中 → 收杆初始进度 %
      reelStartMax: 40,                   // 🆕 初始进度上限 %
      /* 🆕 松线速度 = 基础 × 稀有度系数 × 重量系数（越贵的鱼挣得越凶），再夹上限 */
      reelDecayPerSec: 4,                 // 松线基础速度 %/秒（common 鱼；0 = 不回退）
      reelDecayByRarity: {                // 稀有度系数：越稀有松线越快
        common: 1, uncommon: 1.3, rare: 1.7, epic: 2.2, legendary: 2.8
      },
      reelDecayWeightInfluence: 0.3,      // 同稀有度内「越重越猛」：重量归一后最多 +30%
      reelDecayMax: 10,                   // 松线上限 %/秒：再贵的鱼也保证拉得上来
      tensionTimeout: 10000,              // 张力阶段超时(ms)
      hitFeedbackMs: 420,                 // 单轮命中/未命中反馈时长，期间忽略连点
      maxTargetWidthRatio: 0.6,           // 绿区宽度上限（叠加装备加成后裁剪，避免满屏）
      reelTarget: 100,                    // 收杆目标进度 %
      minTensionBarWidth: 520,            // 判定条最小宽度(px)，桌面易辨识

      /* 🆕 阶段背景视频（只做视觉演出，交互逻辑与状态机完全不变）
         阶段映射：idle→idle、waiting→cast（播完接 wait）、biting→wait、
                   tension/reel→reel（鱼咬钩拉扯）、caught→success、失败瞬间→fail
         seconds = 该阶段目标时长：>0 时把视频时长拉伸/压缩到这个长度（playbackRate 夹在 videoRateRange）；
         0 = 按原速循环；once = 播完自动切到下一个视频（抛竿动作）
         🆕 拉扯视频（fight.mp4，12.26s）用 seconds:0 原速循环：
            搏斗多久就播多久，不强行播完；鱼一钓上来（caught）或跑掉（fail）立刻切下一个视频 */
      videos: {
        idle:    { src: 'assets/video/idle.mp4',    seconds: 0 },
        cast:    { src: 'assets/video/cast.mp4',    seconds: 0, once: true },
        wait:    { src: 'assets/video/wait.mp4',    seconds: 0 },
        reel:    { src: 'assets/video/fight.mp4',   seconds: 0 },   // 长镜头拉扯：原速循环，结果一出即切
        success: { src: 'assets/video/success.mp4', seconds: 0 },
        fail:    { src: 'assets/video/fail.mp4',    seconds: 0 }
      },
      videoRateRange: [0.35, 1.6],        // 拉伸范围（防止过快/过慢失真）
      castVideoMaxMs: 2600,               // 抛竿视频最长播放时长，超时兜底切「等待」
      resultVideoMs: 2800,                // 失败演出时长，播完回到 idle 视频
      catchShowMs: 1400,                  // 🆕 上鱼演出时长：先播「4.上了」视频，再弹结算卡片（否则卡片立刻盖住视频）
      catchClickGuardMs: 250,             // 🆕 结算卡片「防误选」：卡片刚出现的这段时间吞掉收杆连点的尾巴，必须重新点按钮
      /* 🆕 线上（http）换片防黑屏：双缓冲 + 预热 */
      videoSwitchTimeoutMs: 2500,         // 新片源缓冲上限：超时则保留上一画面，绝不切黑屏
      preloadAllVideos: true              // 进入钓鱼页后按顺序静默预下载全部阶段视频（首播/换片不卡）
    },

    /* 01 §6 鱼类数据表（首版 7 种，其余钓场同结构扩展） */
    fish: {
      crucian_carp:   { name: '鲫鱼',   icon: '🐟', rarity: 'common',   weightMin: 0.3,  weightMax: 2.0, desc: '最常见的小河鱼' },
      common_carp:    { name: '鲤鱼',   icon: '🎏', rarity: 'common',   weightMin: 0.8,  weightMax: 4.0, desc: '力气不小，容易脱钩' },
      snakehead:      { name: '黑鱼',   icon: '🐍', rarity: 'rare',     weightMin: 2.0,  weightMax: 6.0, desc: '凶猛的淡水霸主，力大无穷' },
      catfish:        { name: '鲶鱼',   icon: '🐱', rarity: 'uncommon', weightMin: 1.0,  weightMax: 5.0, desc: '夜行的底栖鱼' },
      mandarin_fish:  { name: '鳜鱼',   icon: '🐡', rarity: 'uncommon', weightMin: 0.8,  weightMax: 3.5, desc: '肉质鲜美，价值不菲' },
      bitterling:     { name: '鳑鲏',   icon: '🐠', rarity: 'common',   weightMin: 0.05, weightMax: 0.3, desc: '色彩斑斓的小鱼' },
      yellow_catfish: { name: '黄颡鱼', icon: '🐟', rarity: 'common',   weightMin: 0.2,  weightMax: 1.0, desc: '会「咕咕」叫' }
    },

    /* 01 §6 / 05 §3 钓场表（7 个，等级解锁）：先按钓场取鱼种，再按稀有度权重抽鱼
       - unlockLevel 达标才可进入；未解锁可在右栏预览（看描述/鱼种/解锁等级），但不能钓鱼
       - 场景：每个钓场一张 1080×603 插画（assets/scene/{id}.png，图里已含人物/竿/浮漂）
         · bobberAt = 画中那枚浮漂（或钓线入水处）在**图片内的百分比**，CSS 浮标/涟漪按它对齐，
           咬钩时下沉、等待时轻晃都发生在这一点的水面上
         · 图里自带角色 → 不再叠 Lottie 人物动画层（scene.imageClean 仅早期底图用，可忽略）
       - 鱼种池暂用 01 的 7 种：海水钓场（offshore/deepsea/mystic）的专属鱼种待 05 轮补齐 */
    locations: {
      river: {
        name: '村口河滩', emoji: '🏞️', unlockLevel: 1, desc: '阳光照耀下的乡村小河，水流平缓，起点',
        fish: ['crucian_carp', 'common_carp', 'snakehead', 'catfish', 'mandarin_fish', 'bitterling', 'yellow_catfish'],
        rarityWeight: { common: 60, uncommon: 25, rare: 12, epic: 2.5, legendary: 0.5 },
        scene: {
          image: 'assets/scene/river.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.31, y: 0.81 }
        }
      },
      stream: {
        name: '幽静小溪', emoji: '🌊', unlockLevel: 6, desc: '山间清澈的溪流，石缝中藏着惊喜',
        fish: ['crucian_carp', 'catfish', 'mandarin_fish', 'bitterling', 'yellow_catfish'],
        rarityWeight: { common: 52, uncommon: 30, rare: 14, epic: 3.5, legendary: 0.5 },
        scene: {
          image: 'assets/scene/stream.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.67, y: 0.86 }
        }
      },
      lake: {
        name: '碧波湖泊', emoji: '🏔️', unlockLevel: 16, desc: '广阔天然湖泊，水草丰茂，大鱼潜伏',
        fish: ['common_carp', 'snakehead', 'catfish', 'mandarin_fish', 'crucian_carp'],
        rarityWeight: { common: 44, uncommon: 32, rare: 18, epic: 5, legendary: 1 },
        scene: {
          image: 'assets/scene/lake.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.35, y: 0.76 }
        }
      },
      river_big: {
        name: '奔腾江河', emoji: '💧', unlockLevel: 31, desc: '水流湍急的大江，暗流涌动',
        fish: ['snakehead', 'common_carp', 'catfish', 'mandarin_fish', 'yellow_catfish'],
        rarityWeight: { common: 36, uncommon: 33, rare: 22, epic: 7.5, legendary: 1.5 },
        scene: {
          image: 'assets/scene/river_big.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.20, y: 0.80 }
        }
      },
      offshore: {
        name: '金色近海', emoji: '🌅', unlockLevel: 51, desc: '温暖近海，礁石遍布，海鱼丰富',
        fish: ['mandarin_fish', 'snakehead', 'catfish', 'common_carp', 'yellow_catfish'],
        rarityWeight: { common: 28, uncommon: 34, rare: 26, epic: 10, legendary: 2 },
        scene: {
          image: 'assets/scene/offshore.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.33, y: 0.88 }
        }
      },
      deepsea: {
        name: '深蓝深海', emoji: '🌌', unlockLevel: 71, desc: '光线昏暗，栖息罕见深海巨物',
        fish: ['snakehead', 'catfish', 'mandarin_fish', 'common_carp'],
        rarityWeight: { common: 20, uncommon: 32, rare: 30, epic: 15, legendary: 3 },
        scene: {
          image: 'assets/scene/deepsea.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.77, y: 0.92 }
        }
      },
      mystic: {
        name: '神秘海域', emoji: '✨', unlockLevel: 91, desc: '传说中的终极钓场，只有顶级钓手才能到达',
        fish: ['snakehead', 'mandarin_fish', 'catfish'],
        rarityWeight: { common: 12, uncommon: 28, rare: 34, epic: 20, legendary: 6 },
        scene: {
          image: 'assets/scene/mystic.png', imageWidth: 1080, imageHeight: 603,
          bobberAt: { x: 0.37, y: 0.85 }
        }
      }
    },

    /* 02 装备系统 · 属性 → 玩法数值换算（02 §5.3 公式，只在 equip.getDerived 里用） */
    equip: {
      powerToReelGain: 0.02,          // 力量 → 收杆每次点击进度
      accuracyToTargetWidth: 0.002,   // 钩率(60~90) → 张力绿区宽度（按参考稿的百分比口径重新标定）
      attractToBiteRate: 0.01,        // 吸引 → 咬钩概率
      toughToBiteWindow: 40,          // 拉力/强度 → 咬钩响应窗口(ms)
      stealthToBiteRate: 0.004,       // 🆕 隐蔽(20~70) → 咬钩概率小幅加成（参考稿只给数值，换算为自有口径）
      /* 🆕 补齐「原本白写」的三条属性：运气 / 范围 / 渔网加成
         （此前它们只出现在物品表里，没有任何玩法消费点） */
      luckToRareRate: 0.01,           // 运气 → 稀有鱼概率加成（龙王竿 luck 12 → +12%）
      rangeToWaitReduce: 0.05,        // 范围 → 抛竿等待缩短（每点 5%）
      rangeToWaitReduceCap: 0.35,     // 等待缩短上限（防止直接秒咬钩）
      bonusToFishPrice: 0.01,         // 渔网加成 → 售鱼价加成（每点 1%，撒网 35 → +35%）
      /* 🆕 吸引超过「必咬钩」的部分不再浪费：转为缩短等待
         （基础咬钩率 0.9 + attract×0.01 → attract ≥10 就必咬钩，秘制饵 45 的溢出部分此前完全没用） */
      attractOverflowToWait: 0.01,    // 溢出吸引 → 等待缩短（每点 1%）
      attractOverflowCap: 0.4,        // 上限 40%
      waitMinMs: 900,                 // 等待时间下限（再多的缩短也保留一点节奏）
      baitConsumePerCast: 1,
      lowStockThreshold: 1,
      lockedSlots: []                 // 🆕 渔网按参考稿补齐后启用（原先 lockedSlots:['net']）
    },

    /* 02 §6 物品表：名称/图标/类型/稀有度/属性（数据即数值，集中在此） */
    items: {
      /* 02 §6 新手装备（对齐参考稿的数值口径） */
      bamboo_rod:   { name: '竹制鱼竿', icon: '🎣', type: 'rod',  rarity: 'common',   stats: { power: 5, range: 1 } },
      bone_hook:    { name: '骨制鱼钩', icon: '🦴', type: 'hook', rarity: 'common',   stats: { accuracy: 60, tough: 3 } },
      fiber_line:   { name: '纤维鱼线', icon: '〰️', type: 'line', rarity: 'common',   stats: { tough: 5, stealth: 20 } },
      /* 04 §2 / 07 §2 饵料表（7 种，对齐参考稿：稀有度、吸引、解锁等级）
         饵料为消耗品：每次抛竿消耗 1 个（CONFIG.equip.baitConsumePerCast） */
      earthworm_bait: { name: '蚯蚓饵',   icon: '🪱', type: 'bait', rarity: 'common',    stats: { attract: 5 },  consumable: true },
      corn_bait:      { name: '玉米饵',   icon: '🌽', type: 'bait', rarity: 'common',    stats: { attract: 8 },  consumable: true },
      bread_bait:     { name: '面包饵',   icon: '🥐', type: 'bait', rarity: 'common',    stats: { attract: 6 },  consumable: true },
      shrimp_bait:    { name: '虾肉饵',   icon: '🍤', type: 'bait', rarity: 'uncommon',  stats: { attract: 22 }, consumable: true },
      red_bug_bait:   { name: '红虫饵',   icon: '🔻', type: 'bait', rarity: 'uncommon',  stats: { attract: 15 }, consumable: true },
      catfish_bait:   { name: '鲇鱼饵',   icon: '🐟', type: 'bait', rarity: 'rare',      stats: { attract: 30 }, consumable: true },
      secret_bait:    { name: '秘制饵料', icon: '🧪', type: 'bait', rarity: 'epic',      stats: { attract: 45 }, consumable: true },

      /* ---------------- 04 §2 配方产出装备（对齐参考稿的数值口径） ----------------
         鱼竿：力量 / 范围（+运气）　鱼钩：钩率 / 强度
         鱼线：拉力 / 隐蔽　　　　　渔网：加成
         说明：钩率(accuracy) 影响张力判定绿区宽度；拉力/强度(tough) 影响咬钩响应窗口；
              拉力线还会按 stealthToBiteRate 小幅提升咬钩率；加成为渔网专属（玩法待 06 接入） */
      /* 鱼竿 6 种 */
      wood_rod:     { name: '木质鱼竿',   icon: '🏑', type: 'rod',  rarity: 'common',    stats: { power: 8,  luck: 2,  range: 2 } },
      glass_rod:    { name: '玻璃钢鱼竿', icon: '🔹', type: 'rod',  rarity: 'uncommon',  stats: { power: 14, luck: 3,  range: 3 } },
      carbon_rod:   { name: '碳素鱼竿',   icon: '🖤', type: 'rod',  rarity: 'rare',      stats: { power: 22, luck: 5,  range: 4 } },
      titanium_rod: { name: '钛合金鱼竿', icon: '🥈', type: 'rod',  rarity: 'epic',      stats: { power: 35, luck: 8,  range: 5 } },
      dragon_rod:   { name: '龙王竿',     icon: '🐉', type: 'rod',  rarity: 'legendary', stats: { power: 60, luck: 12, range: 7 } },

      /* 鱼钩 5 种 */
      iron_hook:      { name: '铁制鱼钩',   icon: '🪝', type: 'hook', rarity: 'common',    stats: { accuracy: 70, tough: 6 } },
      barbed_hook:    { name: '倒刺鱼钩',   icon: '⚓', type: 'hook', rarity: 'uncommon',  stats: { accuracy: 75, tough: 10 } },
      golden_hook:    { name: '黄金鱼钩',   icon: '🥇', type: 'hook', rarity: 'rare',      stats: { accuracy: 82, tough: 15 } },
      dragon_fang_hook: { name: '龙牙钩',   icon: '🦷', type: 'hook', rarity: 'epic',      stats: { accuracy: 90, tough: 25 } },

      /* 鱼线 5 种 */
      silk_line:     { name: '蚕丝鱼线',   icon: '🕸️', type: 'line', rarity: 'uncommon',  stats: { tough: 12, stealth: 50 } },
      nylon:         { name: '尼龙线',     icon: '🪡', type: 'line', rarity: 'uncommon',  stats: { tough: 18, stealth: 35 } },
      fluorocarbon:  { name: '碳氟线',     icon: '🔆', type: 'line', rarity: 'rare',      stats: { tough: 25, stealth: 60 } },
      pe_line:       { name: 'PE编织线',   icon: '🧶', type: 'line', rarity: 'epic',      stats: { tough: 35, stealth: 70 } },

      /* 渔网 3 种（02 §9 原计划首版不做，🆕 现按参考稿补齐并在装备槽启用） */
      simple_net:    { name: '简易渔网',   icon: '🥅', type: 'net',  rarity: 'common',    stats: { bonus: 10 } },
      fine_net:      { name: '精编渔网',   icon: '🕸️', type: 'net',  rarity: 'uncommon',  stats: { bonus: 20 } },
      cast_net:      { name: '撒网',       icon: '🪢', type: 'net',  rarity: 'rare',      stats: { bonus: 35 } }
    },

    /* 02 §6 新手礼包：注册后发放，前三者自动装备 */
    starterPack: [
      { id: 'bamboo_rod',   count: 1, autoEquip: true },
      { id: 'bone_hook',    count: 1, autoEquip: true },
      { id: 'fiber_line',   count: 1, autoEquip: true },
      { id: 'corn_bait',    count: 5, autoEquip: true },
      { id: 'red_bug_bait', count: 5, autoEquip: false }
    ],

    /* 09 §6 设置面板默认值 */
    settings: { soundDefault: true, cloudEnabled: false },

    /* 01 §5 人物动画（Lottie）：阶段 → 动作名 + 是否循环；after = 播完接哪个动作 */
    actor: {
      enabled: true,
      actions: {
        idle:    { name: null,       loop: false },                              // 静止姿态
        waiting: { name: 'cast',     loop: false, after: { name: 'wait', loop: true } },  // 抛竿 → 等待轻晃
        biting:  { name: 'bite',     loop: true },                               // 咬钩急抖
        tension: { name: 'tension',  loop: true },                               // 张力收线
        reel:    { name: 'reel',     loop: true },                               // 疯狂收杆
        caught:  { name: 'win',      loop: false }                               // 举竿定格
      }
    },

    /* 03 材料与二合合成 */
    merge: {
      gridSize: 36,
      gridCols: 6,
      cellSize: 76,                       // 格子尺寸(px)，桌面规定 76×76
      cellGap: 6,
      maxLevel: 8,                        // 全局上限；实际以各链长度为准
      /* 是否按合成次数逐条解锁链条：
         false（本期默认）= 8 条链全部解锁，任何基础材料都能合成
         true            = 参考实现的做法：开局只解锁前 2 条，达到 chainUnlockAtMergeCount 后逐条开放 */
      progressiveUnlock: false,

      /* 九条链：数组顺序即等级顺序（index+1 = Lv）
         unlockLevel = 需要达到的玩家等级（等级系统上线后才有意义，当前全 0）
         🆕 谷物链：麦粒 → 面粉 → 面包 → 蛋糕（麦粒来自采集，面包是「面包饵」配方原料） */
      chains: {
        soil:  { name: '泥土链', unlockLevel: 0, items: ['clay', 'resin', 'brick', 'ceramic'] },
        plant: { name: '植物链', unlockLevel: 0, items: ['hay', 'wood', 'hardwood', 'ebony'] },
        grain: { name: '谷物链', unlockLevel: 0, items: ['wheat', 'flour', 'bread', 'cake'] },
        ore:   { name: '矿石链', unlockLevel: 0, items: ['ore', 'iron_bar', 'steel', 'alloy'] },
        forge: { name: '锻造链', unlockLevel: 0, items: ['scrap', 'nail', 'gear', 'spring'] },
        paint: { name: '涂料链', unlockLevel: 0, items: ['sap', 'glue', 'varnish', 'lacquer'] },
        food:  { name: '食材链', unlockLevel: 0, items: ['worm', 'corn', 'paste', 'bait_mix'] },
        gem:   { name: '宝石链', unlockLevel: 0, items: ['pebble', 'crystal', 'gem', 'diamond_shard'] },
        cloth: { name: '织物链', unlockLevel: 0, items: ['fiber', 'thread', 'cloth', 'brocade'] }
      },
      chainOrder: ['soil', 'plant', 'grain', 'ore', 'forge', 'paint', 'food', 'gem', 'cloth'],
      /* 逐条解锁阈值（仅当 progressiveUnlock = true 时生效）：开局 3 条，随后按合成次数开放 */
      chainUnlockAtMergeCount: [0, 0, 0, 3, 8, 15, 25, 40, 60],
      rarityByLevel: ['common', 'common', 'uncommon', 'rare', 'uncommon', 'rare', 'epic', 'legendary'],

      /* 挖掘 / 采集：一次消耗 1 点体力，从下列候选基础材料里随机产出 producePerAction 个 */
      source: {
        dig: ['ore', 'scrap', 'clay'],          // 可开采：矿石 / 废料 / 黏土
        gather: ['hay', 'sap', 'worm', 'wheat'] // 可采集：干草 / 树液 / 红虫 / 麦粒（麦粒是饵料主料）
      },
      producePerAction: 3,                      // 单次挖掘/采集的产出数量

      /* 一键收获：只收**已合成过的材料**（Lv.2 及以上）进背包 bag.materials；
         Lv.1 原始材料（未二合过）还不能收，要留在台上先合成一次 */
      harvest: { free: true, minLevel: 2 },

      randomPlacement: true,        // 新材料的落点从空位里随机取，而不是按格子顺序填空

      /* 合成台自动随机生成：每隔 intervalMs 随机产出一个材料（基础材料为主，小概率高级材料） */
      autoSpawn: {
        enabled: true,
        intervalMs: 10000,                       // 每 10 秒产出 1 个
        levelWeights: [88, 9.5, 2, 0.5]          // 依次对应 Lv1~Lv4 的权重（百分比，总和 100）
      }
    },

    /* 03 §5 材料字典（04 §2 要求统一定义）：chain=null 表示非链条材料（市场/特殊） */
    materials: {
      clay:   { name: '黏土', icon: '🟤', chain: 'soil' },
      resin:  { name: '松脂', icon: '🫠', chain: 'soil' },
      brick:  { name: '砖块', icon: '🧱', chain: 'soil' },
      ceramic: { name: '陶瓷', icon: '🏺', chain: 'soil' },
      hay:    { name: '干草', icon: '🌿', chain: 'plant' },   // 🆕 换图标：原 🌾 与「麦粒」撞脸
      wood:   { name: '木材', icon: '🪵', chain: 'plant' },
      hardwood: { name: '硬木', icon: '🎋', chain: 'plant' },
      ebony:  { name: '乌木', icon: '🌑', chain: 'plant' },
      ore:    { name: '铁矿石', icon: '🪨', chain: 'ore' },   // 对齐配方稿写法
      iron_bar: { name: '铁条', icon: '🔩', chain: 'ore' },
      steel:  { name: '钢件', icon: '⚙️', chain: 'ore' },
      alloy:  { name: '合金', icon: '🔗', chain: 'ore' },
      scrap:  { name: '废料', icon: '🔧', chain: 'forge' },
      nail:   { name: '钉子', icon: '📌', chain: 'forge' },
      gear:   { name: '齿轮', icon: '🔘', chain: 'forge' },
      spring: { name: '弹簧', icon: '🌀', chain: 'forge' },
      sap:    { name: '树液', icon: '🍯', chain: 'paint' },
      glue:   { name: '胶水', icon: '🫗', chain: 'paint' },
      varnish: { name: '清漆', icon: '🎨', chain: 'paint' },
      lacquer: { name: '精漆', icon: '✨', chain: 'paint' },
      worm:   { name: '红虫', icon: '🪱', chain: 'food' },
      corn:   { name: '玉米粒', icon: '🌽', chain: 'food' },   // 对齐饵料配方稿的写法
      paste:  { name: '饵团', icon: '🟠', chain: 'food' },
      bait_mix: { name: '混合饵', icon: '🥣', chain: 'food' },
      pebble: { name: '石头', icon: '⚪', chain: 'gem' },     // 对齐配方稿写法
      crystal: { name: '水晶', icon: '🔮', chain: 'gem' },
      gem:    { name: '宝石', icon: '💠', chain: 'gem' },
      diamond_shard: { name: '钻石原石', icon: '🔷', chain: 'gem' },
      fiber:  { name: '植物纤维', icon: '🍃', chain: 'cloth' },  // 对齐配方稿写法
      thread: { name: '细线', icon: '🧵', chain: 'cloth' },
      cloth:  { name: '布料', icon: '🟫', chain: 'cloth' },
      brocade: { name: '锦缎', icon: '🟪', chain: 'cloth' },
      /* 非链条材料（本期由调试入口补给，07 市场接入后从市场获得） */
      rope:   { name: '绳索', icon: '🪢', chain: null, rarity: 'common' },
      bamboo: { name: '竹子', icon: '🎍', chain: null, rarity: 'common' },
      bone:   { name: '兽骨', icon: '🦴', chain: null, rarity: 'common' },
      silk:   { name: '蚕丝', icon: '🧶', chain: null, rarity: 'uncommon' },
      titanium: { name: '钛材', icon: '🥈', chain: null, rarity: 'epic' },
      carbon_cloth: { name: '碳布', icon: '🖤', chain: null, rarity: 'rare' },
      dragon_scale: { name: '龙鳞', icon: '🐲', chain: null, rarity: 'legendary' },
      float:  { name: '浮漂', icon: '🎈', chain: null, rarity: 'common' },
      sinker: { name: '铅坠', icon: '⚫', chain: null, rarity: 'common' },   // 🆕 换图标：原 🔘 与「齿轮」撞脸
      /* 🆕 谷物链（麦粒采集可得 → 面粉 → 面包 → 蛋糕）：面包是「面包饵」配方原料，
         现在靠二合就能做出来，不用再等市场；蛋糕是这条链的顶端产物 */
      wheat:  { name: '麦粒', icon: '🌾', chain: 'grain' },
      flour:  { name: '面粉', icon: '🫓', chain: 'grain' },
      bread:  { name: '面包', icon: '🍞', chain: 'grain' },
      cake:   { name: '蛋糕', icon: '🍰', chain: 'grain' }
    },

    /* 背包（06 §4）：材料卡片上的来源标签。没列出的按等级推导：Lv.1=自然，Lv.2+=加工 */
    materialTag: {
      natural: ['bamboo', 'bone', 'silk', 'resin'],                 // 天然物（含参考稿判为「自然」的松脂）
      bait: ['worm', 'corn', 'paste', 'bait_mix', 'wheat',                       // 可当饵料用的材料
             'earthworm_bait', 'corn_bait', 'bread_bait', 'shrimp_bait',         // 成品饵（07 §2 配方产出）
             'red_bug_bait', 'catfish_bait', 'secret_bait']
    },

    /* 03 体力/次数 */
    /* 挖掘/采集体力：每 regenIntervalMs 恢复 regenAmount 点（10 分钟 1 点） */
    charges: {
      digMax: 8, gatherMax: 8, regenIntervalMs: 600000, regenAmount: 1,
      /* 「补充探索次数」面板：可用金币快速补充挖掘/采集次数 */
      buy: {
        enabled: true,
        buyAmount: 3,        // 「+3」按钮一次补几次
        buyCost: 15,         // 「+3」的金币价
        fullCost: 20         // 「满充」的金币价（补到上限）
      }
    },

    /* 04 钓具配方合成 */
    craft: {
      categories: ['rod', 'hook', 'bait', 'line', 'net', 'other'],
      allowDuplicateCraft: true,
      lockByLevel: true,
      showOwnedCount: true,
      firstCraftDiamond: 3,               // 首次合成某物品写入图鉴奖励的钻石数（06 负责领取 UI）
      categoryName: { rod: '鱼竿', hook: '鱼钩', bait: '饵料', line: '鱼线', net: '渔网', other: '其他' },
      categoryIcon: { rod: '🎋', hook: '🪝', bait: '🪱', line: '🧵', net: '🥅', other: '📦' },
      /* 04 §2 配方表（对齐参考稿：材料需求与解锁等级逐个照抄）
         产出物品定义在 CONFIG.items，此处只写材料需求与解锁等级 */
      recipes: [
        /* 鱼竿 6 种：0 / 0 / 5 / 8 / 12 / 15 */
        { id: 'bamboo_rod',  unlockLevel: 0, cost: { bamboo: 3, rope: 1, glue: 1 } },
        { id: 'wood_rod',    unlockLevel: 0, cost: { wood: 3, iron_bar: 1, rope: 2, glue: 1 } },
        { id: 'glass_rod',   unlockLevel: 5, cost: { hardwood: 2, steel: 1, varnish: 1 } },
        { id: 'carbon_rod',  unlockLevel: 8, cost: { alloy: 2, carbon_cloth: 1, varnish: 2 } },
        { id: 'titanium_rod', unlockLevel: 12, cost: { titanium: 2, carbon_cloth: 2, lacquer: 1 } },
        { id: 'dragon_rod',  unlockLevel: 15, cost: { dragon_scale: 1, titanium: 3, lacquer: 3 } },

        /* 鱼钩 5 种：0 / 0 / 5 / 8 / 12 */
        { id: 'bone_hook',   unlockLevel: 0, cost: { pebble: 2, rope: 1 } },
        { id: 'iron_hook',   unlockLevel: 0, cost: { ore: 2, iron_bar: 1 } },
        { id: 'barbed_hook', unlockLevel: 5, cost: { steel: 2, iron_bar: 1 } },
        { id: 'golden_hook', unlockLevel: 8, cost: { alloy: 2, gem: 1 } },
        { id: 'dragon_fang_hook', unlockLevel: 12, cost: { dragon_scale: 1, alloy: 3 } },

        /* 鱼线 5 种：0 / 0 / 5 / 8 / 12 */
        { id: 'fiber_line',  unlockLevel: 0, cost: { fiber: 3 } },
        { id: 'silk_line',   unlockLevel: 0, cost: { silk: 3, glue: 1 } },
        { id: 'nylon',       unlockLevel: 5, cost: { glue: 2, steel: 1 } },
        { id: 'fluorocarbon', unlockLevel: 8, cost: { carbon_cloth: 1, glue: 2 } },
        { id: 'pe_line',     unlockLevel: 12, cost: { carbon_cloth: 2, silk: 3 } },

        /* 渔网 3 种：0 / 5 / 8 */
        { id: 'simple_net',  unlockLevel: 0, cost: { fiber: 5, rope: 3 } },
        { id: 'fine_net',    unlockLevel: 5, cost: { fiber: 8, thread: 3 } },
        { id: 'cast_net',    unlockLevel: 8, cost: { thread: 5, rope: 5 } },

        /* 饵料 7 种（07 §2 配方稿）：前 3 种开局可做，后 4 种按等级解锁
           🆕 yield = 一次合成产出几个：饵料是消耗品（1 个只能钓 1 次），
           原来固定产出 1 个 → 「合成一次钓两次就没了」；现在基础饵一次给 3 个，高级饵给 2 个 */
        { id: 'earthworm_bait', unlockLevel: 0,  cost: { worm: 3, wheat: 2 }, yield: 3 },
        { id: 'corn_bait',      unlockLevel: 0,  cost: { corn: 3, wheat: 2 }, yield: 3 },
        { id: 'bread_bait',     unlockLevel: 0,  cost: { bread: 2, wheat: 1 }, yield: 3 },
        { id: 'shrimp_bait',    unlockLevel: 5,  cost: { paste: 2, worm: 2 }, yield: 2 },
        { id: 'red_bug_bait',   unlockLevel: 0,  cost: { worm: 3 }, yield: 3 },
        { id: 'catfish_bait',   unlockLevel: 8,  cost: { paste: 2, bait_mix: 1 }, yield: 2 },
        { id: 'secret_bait',    unlockLevel: 12, cost: { bait_mix: 2, silk: 1 }, yield: 2 }
      ]
    },

    /* 调试开关（仅本轮用于验证配方合成：07 市场接入前材料来源有限） */
    debug: {
      showGrantButton: true,              // 合成台操作区显示「🧪 补给材料(调试)」
      grantAmount: 6                      // 每个材料补给的份数
    },

    /* 05 成长：等级 / 钓场 / 技能树 */
    level: {
      expBase: 100,                             // 升级所需经验 = expBase × expGrowth^(level-1)
      expGrowth: 1.25,
      expPerFish: { common: 10, uncommon: 20, rare: 40, epic: 80, legendary: 150 },  // 10 × 稀有度系数
      expPerCodex: 30,                          // 首次收录图鉴
      expPerCraft: 15,                          // 首次合成物品
      expPerExpo: 100                           // 完成博览会
    },

    /* 05 §4 技能树：三条线，消耗金币、永久生效、不可重置
       效果一律由 systems.growth.getSkillEffect(key) 读取，禁止硬编码进判定逻辑 */
    skills: {
      maxLevel: 3,                // 每个技能最高等级
      costGrowth: 1.6,            // 每升一级成本 ×1.6
      lines: [
        {
          key: 'feel', name: '手感', icon: '🎯',
          skills: [
            { id: 'steady',   name: '稳如泰山', desc: '绿区宽度 +5%',     cost: 200, effect: { targetWidth: 0.05 } },
            { id: 'slow',     name: '慢条斯理', desc: '指针速度 -10%',    cost: 350, effect: { cursorSpeed: -0.10 } },
            { id: 'quick',    name: '眼疾手快', desc: '咬钩窗口 +500ms',  cost: 500, effect: { biteWindow: 500 } }
          ]
        },
        {
          key: 'gain', name: '收益', icon: '🪙',
          skills: [
            { id: 'thrifty',  name: '精打细算', desc: '售鱼价 +10%',      cost: 300, effect: { fishPrice: 0.10 } },
            { id: 'studious', name: '勤学苦练', desc: '经验 +15%',        cost: 400, effect: { expGain: 0.15 } },
            { id: 'stamina',  name: '体力充沛', desc: '体力上限 +2',      cost: 600, effect: { chargeMax: 2 } }
          ]
        },
        {
          key: 'luck', name: '概率', icon: '🍀',
          skills: [
            { id: 'lucky',    name: '好运连连', desc: '稀有鱼概率 +3%',   cost: 800, effect: { rareRate: 0.03 } },
            { id: 'bigfish',  name: '巨物猎人', desc: '鱼重量 +10%',      cost: 1000, effect: { fishWeight: 0.10 } }
          ]
        },
        /* 🆕 采集系：作用于 03 挖掘/采集与合成台容量 */
        {
          key: 'gather', name: '采集系', icon: '⛏️',
          skills: [
            { id: 'miner_eye',   name: '矿工之眼', desc: '挖掘暴击率 0% → 10%',      cost: 500,  effect: { digCrit: 0.0334 } },
            { id: 'nature_love', name: '自然亲和', desc: '采集稀有材料概率 0% → 5%', cost: 500,  effect: { rareMaterial: 0.0167 } },
            { id: 'warehouse',   name: '仓库扩容', desc: '合成台格位 0 → 10',        cost: 1000, effect: { boardSlots: 3.34 } }
          ]
        },
        /* 🆕 钓技系：作用于 01 抛竿/张力/收杆 */
        {
          key: 'skill_fishing', name: '钓技系', icon: '🎣',
          skills: [
            { id: 'cast_precise', name: '精准抛竿', desc: '抛投距离 0% → 15%（咬钩率）', cost: 500,  effect: { castDistance: 0.05 } },
            { id: 'iron_wrist',   name: '铁腕遛鱼', desc: '命中区域宽度 0% → 5%',      cost: 1000, effect: { targetWidth: 0.0167 } },
            { id: 'mad_click',    name: '疯狂点击', desc: '收杆所需点击减少 0% → 10%',  cost: 1000, effect: { reelGain: 0.0334 } }
          ]
        },
        /* 🆕 经营系：作用于 06 工坊加工与 07 制品售价 */
        {
          key: 'business', name: '经营系', icon: '💰',
          skills: [
            { id: 'smart_merchant', name: '精明商人', desc: '制品售价提升 0% → 10%', cost: 500,  effect: { productPrice: 0.0334 } },
            { id: 'fast_process',   name: '高效加工', desc: '加工时间减少 0% → 15%',  cost: 1000, effect: { processSpeed: 0.05 } },
            { id: 'batch_produce',  name: '批量生产', desc: '同时加工数量 +1/级',     cost: 2000, effect: { processSlots: 1 } }
          ]
        }
      ]
    },

    /* 07 经济与市场 */
    economy: {
      fishBasePrice: 30,
      rarityPriceFactor: { common: 1, uncommon: 2.2, rare: 5, epic: 12, legendary: 30 },
      productPriceFactor: 1.6,
      diamondToGold: 100,
      challengeWinReward: 50,
      challengeDailyLimit: 3,
      /* 🆕 red_bug 是不存在的 id（材料表里叫 worm 红虫），买到的是无法使用的幽灵物品 → 改成 worm */
      marketStock: { rope: 3, float: 3, sinker: 3, corn: 5, worm: 5 },
      marketPrice: { rope: 8, float: 5, sinker: 5, corn: 6, worm: 12 },
      restockIntervalMs: 86400000
    },

    /* 06 图鉴 */
    codex: {
      fishMilestones: [5, 10, 20, 40],          // 各类收集数量里程碑
      percentMilestones: [0.25, 0.5, 0.75, 1],  // 各类完成度里程碑
      diamondPerMilestone: 3,                   // 里程碑奖励钻石
      firstDiamond: 3                           // 🆕 首次收录某物种的奖励钻石
    },

    /* 06 工坊 */
    workshop: {
      unlockLevel: 10, baseSlots: 1, processSeconds: 60,
      slotCost: 500, slotCostGrowth: 1.8,       // 🆕 升级工位：slotCost × slotCostGrowth^当前等级
      /* 🆕 工坊产出是钻石来源之一（03 §… / 钻石系统）：收取制品时按概率掉钻 */
      diamondChance: 0.2, diamondAmount: 1
    },

    /* 06 博览会：4 个展区同屏展示（参考稿卡片式），每个展区每日可提交一次 */
    expo: {
      refreshHour: 0,
      /* 展区列表：reward = 提交奖励；reqs 支持 4 种要求类型（判定见 systems/codex.js）
         - weight   { type:'weight',   fishId, minWeight }   持有该鱼且 ≥ X kg（提交时消耗）
         - species  { type:'species',  fishId, count }       指定鱼 ×N（提交时消耗）
         - discover { type:'discover', rarity, count }       图鉴已收录 N 种该稀有度鱼（不消耗）
         - bigFish  { type:'bigFish',  minWeight, count }    持有 N 条 ≥ X kg 的大物（提交时消耗） */
      stalls: [
        {
          id: 'freshwater_king', icon: '👑', name: '淡水鱼王', subtitle: '展出最大的淡水鱼',
          reward: { gold: 300, diamond: 10 },
          reqs: [
            { type: 'weight', fishId: 'common_carp', minWeight: 2.0 },
            { type: 'weight', fishId: 'crucian_carp', minWeight: 1.2 },
            { type: 'weight', fishId: 'snakehead', minWeight: 3.0 }
          ]
        },
        {
          id: 'rare_show', icon: '💎', name: '珍稀鱼展', subtitle: '展出稀有鱼类',
          reward: { gold: 600, diamond: 15 },
          reqs: [
            { type: 'discover', rarity: 'common', count: 3 },
            { type: 'discover', rarity: 'uncommon', count: 2 },
            { type: 'discover', rarity: 'rare', count: 1 }
          ]
        },
        {
          id: 'sea_overlord', icon: '🌊', name: '海洋霸主', subtitle: '展出大型海鱼',
          reward: { gold: 1200, diamond: 20 },
          reqs: [
            { type: 'weight', fishId: 'catfish', minWeight: 3.5 },
            { type: 'weight', fishId: 'mandarin_fish', minWeight: 2.5 },
            { type: 'bigFish', minWeight: 3.0, count: 3 }
          ]
        },
        {
          id: 'living_fossil', icon: '🦕', name: '活化石展', subtitle: '展出远古鱼类',
          reward: { gold: 3000, diamond: 30 },
          reqs: [
            { type: 'species', fishId: 'snakehead', count: 1 },
            { type: 'species', fishId: 'mandarin_fish', count: 1 },
            { type: 'species', fishId: 'catfish', count: 1 }
          ]
        }
      ]
    },

    /* 06 §4 排行榜（本地段位门槛：totalFishCaught + 完成度×50） */
    rank: {
      tiers: [
        { name: '新手', min: 0 }, { name: '熟练', min: 50 },
        { name: '高手', min: 150 }, { name: '大师', min: 400 }, { name: '传奇', min: 1000 }
      ]
    },

    /* 💎 钻石系统：商店（金币兑换 / 材料捆绑包 / 自动合成）+ 英雄招募（永久加成） */
    diamond: {
      /* 钻石来源说明（面板顶部展示，08 口径：图鉴/博览会/工坊） */
      sources: ['解锁图鉴', '完成博览会', '工坊产出'],
      /* 金币兑换三档：花 diamond 钻 → 得 gold 金（换算率取 economy.diamondToGold） */
      goldPacks: [
        { diamond: 1, gold: 100, desc: '少量金币补充' },
        { diamond: 10, gold: 1000, desc: '中量金币补充' },
        { diamond: 100, gold: 10000, desc: '大量金币补充' }
      ],
      /* 材料捆绑包：钻石价 vs 原价（金币估价）；「省 X%」由两者与 diamondToGold 实时算出，不写死 */
      bundles: [
        { id: 'starter', name: '新手材料包', icon: '📦', price: 5, originGold: 800,
          items: { clay: 10, hay: 10, wood: 5, rope: 5 } },
        { id: 'metal', name: '金属材料包', icon: '🔨', price: 10, originGold: 1800,
          items: { ore: 8, iron_bar: 6, nail: 4, alloy: 2 } },
        { id: 'advanced', name: '高级材料包', icon: '🎁', price: 20, originGold: 4500,
          items: { hardwood: 3, gear: 5, lacquer: 5, cloth: 4, silk: 2 } },
        { id: 'luxury', name: '尊享材料包', icon: '👑', price: 50, originGold: 15000,
          items: { alloy: 3, brocade: 5, titanium: 2, diamond_shard: 1 } },
        /* 🆕 原来给的是 worm/corn/paste/bait_mix（食材链「材料」，装不进饵料槽），
           名字叫饵料礼包却换不来能用的饵 → 改成直接给可装备的成品饵料 */
        { id: 'bait', name: '饵料大礼包', icon: '🪱', price: 8, originGold: 1200,
          items: { earthworm_bait: 10, corn_bait: 10, red_bug_bait: 5 } },
        { id: 'line', name: '编线材料包', icon: '🧵', price: 15, originGold: 3000,
          items: { thread: 8, fiber: 10, cloth: 4, brocade: 2 } }
      ],
      /* 自动合成：达到等级后可用钻石开通（开通后可挂机自动二合） */
      autoMerge: { unlockLevel: 15, cost: 50, intervalMs: 2000 },
      /* 英雄招募：等级门槛 + 钻石招募价 + 永久加成（effect 走 growth.getSkillEffect 的同一套 key） */
      heroes: [
        { id: 'laowang', name: '老王', icon: '🐣', rarity: 'common', unlockLevel: 5, cost: 10,
          effect: { expGain: 0.10 }, desc: '经验 +10%' },
        { id: 'chef', name: '李大厨', icon: '👨‍🍳', rarity: 'common', unlockLevel: 8, cost: 12,
          effect: { fishPrice: 0.15 }, desc: '售价 +15%' },
        { id: 'smith', name: '张铁匠', icon: '⚒️', rarity: 'uncommon', unlockLevel: 12, cost: 25,
          effect: { processSpeed: 0.20 }, desc: '制作速度 +20%' },
        { id: 'mr_sun', name: '孙先生', icon: '🧑‍🏫', rarity: 'uncommon', unlockLevel: 15, cost: 30,
          effect: { codexDiamond: 0.25 }, desc: '图鉴奖励 +25%' },
        { id: 'captain', name: '赵船长', icon: '🛳️', rarity: 'rare', unlockLevel: 20, cost: 60,
          effect: { rareRate: 0.15 }, desc: '稀有鱼概率 +15%' },
        { id: 'alchemist', name: '吴炼师', icon: '🧪', rarity: 'rare', unlockLevel: 25, cost: 70,
          effect: { doubleMaterial: 0.10 }, desc: '材料翻倍概率 +10%' },
        { id: 'pirate', name: '陈海盗', icon: '🏴‍☠️', rarity: 'epic', unlockLevel: 30, cost: 150,
          effect: { goldGain: 0.30 }, desc: '金币收益 +30%' },
        { id: 'dragon', name: '龙王使者', icon: '🐲', rarity: 'legendary', unlockLevel: 40, cost: 300,
          effect: { allAttr: 0.15 }, desc: '全属性 +15%' }
      ]
    },

    /* 08 社交（无后端 → 本地模拟云端；任何云端异常都降级为本地可用） */
    social: {
      nameMin: 2, nameMax: 8,
      friendBonusPerFriend: 0.05, friendBonusCap: 0.25,   // 每人 +5% 经验，上限 25%（=5 人）
      chatMinIntervalMs: 3000, chatMaxLength: 60,
      requestDelayMs: 600,        // 🆕 模拟云端往返耗时
      requestTimeoutMs: 8000,     // 🆕 云端请求超时（10 §2）：超时即降级本地
      inboxPerPull: 1,            // 🆕 每次刷新收件箱最多拉取到的挑战数
      nameCharset: /^[\u4e00-\u9fa5A-Za-z0-9_]+$/,   // 🆕 昵称允许的字符（中文/字母/数字/下划线）
      bannedWords: ['外挂', '作弊', '骗子', '代充', '私服', '广告'],   // 🆕 敏感词（替换为 *）
      /* 🆕 世界频道初始消息（本地模拟） */
      chatSeed: [
        { name: '老钓翁', text: '今天河口的鲫鱼口不错，早起的鸟儿有虫吃' },
        { name: '一竿风月', text: '谁有多余的绳索？我拿浮漂换' },
        { name: '小钓Cat', text: '刚入图鉴一条黑鱼 3.2kg，开心' }
      ],
      /* 🆕 模拟云端玩家：查找钓友 / 鱼王挑战对手 / 排行榜数据来源
         bestFishValue = 该 NPC 出战鱼的金币价值（用于「金币价值高者胜」判定） */
      npcPool: [
        { id: '#A1B2C3', name: '老钓翁', level: 12, fish: 128, codex: 0.62, biggest: 8.40, bestFishValue: 320 },
        { id: '#D4E5F6', name: '一竿风月', level: 9, fish: 96, codex: 0.48, biggest: 6.75, bestFishValue: 240 },
        { id: '#7A8B9C', name: '小钓Cat', level: 6, fish: 61, codex: 0.35, biggest: 4.30, bestFishValue: 180 },
        { id: '#3F5A7B', name: '夜钓阿强', level: 15, fish: 210, codex: 0.78, biggest: 11.20, bestFishValue: 460 },
        { id: '#9C8B7A', name: '空军司令', level: 3, fish: 24, codex: 0.18, biggest: 2.10, bestFishValue: 90 },
        { id: '#5E6F80', name: '江湖钓鱼佬', level: 11, fish: 142, codex: 0.55, biggest: 7.60, bestFishValue: 300 },
        { id: '#2B3C4D', name: '浮漂狂魔', level: 8, fish: 78, codex: 0.41, biggest: 5.50, bestFishValue: 210 },
        { id: '#6D7E8F', name: '锦鲤小妹', level: 13, fish: 166, codex: 0.66, biggest: 9.10, bestFishValue: 380 }
      ]
    },

    /* 10 UI 与节流 */
    ui: { toastDuration: 2200, buttonMinHeight: 48, throttleMs: 300 },

    /* 10 §2 超时兜底：每个等待玩家的阶段都必须有出口 */
    timeout: { bite: 3000, tension: 10000, reel: 5000, request: 8000 }
  };

  /* ------------------------------------------------------------
     钓场场景图兜底：若某个钓场没配 scene，就复用第一个有图的钓场，
     避免新加钓场时忘了配图导致主舞台只剩渐变底
     ------------------------------------------------------------ */
  (function fillScene() {
    let base = null;
    Object.keys(CONFIG.locations).forEach(function (id) {
      const loc = CONFIG.locations[id];
      if (loc && loc.scene && loc.scene.image && !base) base = loc.scene;
    });
    if (!base) return;
    Object.keys(CONFIG.locations).forEach(function (id) {
      const loc = CONFIG.locations[id];
      if (loc && !loc.scene) loc.scene = base;
    });
  })();

  /* ------------------------------------------------------------
     以下为 00 §6 全局枚举（非数值，供渲染与白名单校验共用）
     ------------------------------------------------------------ */
  const ENUM = {
    RARITY: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
    RARITY_NAME: { common: '普通', uncommon: '优良', rare: '稀有', epic: '史诗', legendary: '传说' },
    RARITY_STAR: { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 },
    RARITY_COLOR: {
      common: '#9E9E9E', uncommon: '#4CAF50', rare: '#2196F3',
      epic: '#9C27B0', legendary: '#FFC107'
    },
    SLOTS: ['rod', 'hook', 'bait', 'line', 'net'],
    SLOT_NAME: { rod: '鱼竿', hook: '鱼钩', bait: '饵料', line: '鱼线', net: '渔网' },
    SLOT_ICON: { rod: '🎋', hook: '🪝', bait: '🪱', line: '🧵', net: '🥅' },
    /* 02 §2 属性维度（🆕 按参考稿补 隐蔽 stealth / 加成 bonus，并把 命中→钩率、韧性→拉力） */
    STATS: ['power', 'accuracy', 'attract', 'tough', 'luck', 'capacity', 'range', 'stealth', 'bonus'],
    STAT_NAME: {
      power: '力量', accuracy: '钩率', attract: '吸引', tough: '拉力',
      luck: '运气', capacity: '容量', range: '范围', stealth: '隐蔽', bonus: '加成'
    },
    STAT_ICON: {
      power: '💪', accuracy: '🎯', attract: '🧲', tough: '🛡️',
      luck: '🍀', capacity: '📦', range: '📏', stealth: '🕶️', bonus: '✨'
    },
    /* 同一属性在不同装备上的叫法（参考稿：鱼钩叫「强度」、鱼线叫「拉力」，两者都是 tough） */
    STAT_NAME_BY_TYPE: {
      hook: { tough: '强度' },
      line: { tough: '拉力' },
      net:  { bonus: '加成' }
    },
    /** 属性显示名：优先取该装备类型的叫法，否则用通用名（UI 统一走这里，禁止各处硬编码） */
    statName: function (type, key) {
      const byType = ENUM.STAT_NAME_BY_TYPE || {};
      const mapped = (byType[type] || {})[key];
      return mapped || ENUM.STAT_NAME[key] || key;
    },
    /* 背包分类（白名单） */
    BAG_TYPES: ['materials', 'fish', 'equipment', 'products'],
    /* 底部导航（00 §1.2）；switchTab 的白名单即来自这里 */
    TABS: ['merge', 'fishing', 'craft', 'workshop', 'market', 'skill', 'diamond', 'social'],
    TAB_META: {
      merge:    { icon: '🧩', name: '二合' },
      fishing:  { icon: '🎣', name: '钓鱼' },
      craft:    { icon: '🔨', name: '合成' },
      workshop: { icon: '🏭', name: '工坊' },
      market:   { icon: '🏪', name: '市场' },
      skill:    { icon: '🌟', name: '技能' },
      diamond:  { icon: '💎', name: '钻石' },
      social:   { icon: '🌐', name: '社交' }
    },
    DEFAULT_TAB: 'fishing',
    /* 钓鱼状态机（01），骨架阶段仅声明，不实现逻辑 */
    FISH_PHASES: ['idle', 'waiting', 'biting', 'tension', 'reel', 'caught'],
    /* 操作流程反馈编号（参考图 ①~⑥）：每一步绑定一个钓鱼阶段，用于顶部进度条高亮 */
    FISH_STEPS: [
      { no: '1', icon: '🎣', name: '抛竿', phases: ['idle'] },
      { no: '2', icon: '⏳', name: '等待', phases: ['waiting'] },
      { no: '3', icon: '❗', name: '咬钩', phases: ['biting'] },
      { no: '4', icon: '⚡', name: '张力', phases: ['tension'] },
      { no: '5', icon: '🔥', name: '收杆', phases: ['reel'] },
      { no: '6', icon: '🎉', name: '结算', phases: ['caught'] }
    ]
  };

  /* 00 §1.2 布局尺寸：UI 层统一取用，禁止各模块自造容器尺寸
     宽度按需求放大到 1.5×：1280 → 1920，最小宽 1024 → 1536（窗口更窄时整体等比缩放） */
  const LAYOUT = {
    maxWidth: 1920, minWidth: 1536,
    leftWidth: 260, rightWidth: 300,
    topHeight: 56, navHeight: 64,
    stageMinHeight: 420
  };

  FG.CONFIG = CONFIG;
  FG.ENUM = ENUM;
  FG.LAYOUT = LAYOUT;
})(window.FG = window.FG || {});
