import type { StoryPlot, Character, CharacterMissions, Group } from './types';

// Story Plot
export const storyPlot: StoryPlot = {
  id: "story_001",
  slug: "story_001",
  title: "這份報告今天要",
  description: "陳副理要一份報告，今天下班前。同事小林說她很忙。你夾在中間。",
  estimatedMins: 20,
  phases: [
    {
      id: "morning",
      virtualTime: "09:00",
      progressLabel: "早上・任務下來了",
      maxRealMinutes: 7,
      characterMissions: [
        {
          characterId: "char_boss",
          goal: "成功讓Andy接下報告任務，並得到明確繳交時間",
          completionHint: "Andy明確說出何時可以交，或說「好」且沒有把責任推走",
          triggerDirection: "直接私訊Andy，說要一份Q3業績摘要，今天下班前",
          location: "dm",
          responseDelaySeconds: 2,
          failNudge: "沒收到回覆就補一句：「還沒確認？」"
        },
        {
          characterId: "char_coworker",
          goal: "讓Andy知道她今天非常忙，暗示報告不關她的事",
          completionHint: "小林成功說完她很忙的理由，或Andy已知道報告是自己的事",
          triggerDirection: "私訊Andy說自己今天行程很滿，順帶問陳副理找你什麼事",
          location: "dm",
          responseDelaySeconds: 5,
          failNudge: null
        }
      ],
      branches: [
        {
          condition: "goal_morning_char_boss_achieved",
          nextPhaseId: "afternoon",
          description: "主管任務達成，進入下午"
        }
      ]
    },
    {
      id: "afternoon",
      virtualTime: "14:00",
      progressLabel: "下午・進度被盯上了",
      maxRealMinutes: 8,
      characterMissions: [
        {
          characterId: "char_boss",
          goal: "確認報告進度，讓Andy說出現況",
          completionHint: "Andy在群組或私訊回報進度，好壞都算",
          triggerDirection: "在群組丟一句進度詢問，語氣平靜但帶壓力感",
          location: "both",
          responseDelaySeconds: 3,
          failNudge: "私訊補一句：「你那份呢」"
        },
        {
          characterId: "char_coworker",
          goal: "繼續迴避，但如果Andy很慘，偷偷給點小提示",
          completionHint: "小林成功迴避，或Andy明確向她求助（不論她有沒有幫）",
          triggerDirection: "在群組說自己手上也有東西，傳個同情貼圖但不出手幫",
          location: "group",
          responseDelaySeconds: 6,
          failNudge: null
        }
      ],
      branches: [
        {
          condition: "char_boss.p > 0.3 && goal_afternoon_char_boss_achieved",
          nextPhaseId: "ending_good",
          description: "主管好感度高且有回報進度：好結局"
        },
        {
          condition: "char_boss.p <= 0.3 || !goal_afternoon_char_boss_achieved",
          nextPhaseId: "ending_bad",
          description: "主管好感度低或沒回報：壞結局"
        }
      ]
    },
    {
      id: "ending_good",
      virtualTime: "17:30",
      progressLabel: "傍晚・總算過關",
      maxRealMinutes: 3,
      characterMissions: [
        {
          characterId: "char_boss",
          goal: "收到報告，給Andy簡短正面回應",
          completionHint: "說出任何正面評價即達成",
          triggerDirection: "說「好，我看一下」，停頓後說「還不錯」或「這樣可以」",
          location: "dm",
          responseDelaySeconds: 4,
          failNudge: null
        },
        {
          characterId: "char_coworker",
          goal: "輕鬆說幾句收尾，可以暗示她知道報告不好做",
          completionHint: "說出輕鬆收尾的話即達成",
          triggerDirection: "傳貼圖或說「總算」、「你搞定了呀」",
          location: "group",
          responseDelaySeconds: 4,
          failNudge: null
        }
      ],
      branches: []
    },
    {
      id: "ending_bad",
      virtualTime: "17:30",
      progressLabel: "傍晚・今天很難熬",
      maxRealMinutes: 3,
      characterMissions: [
        {
          characterId: "char_boss",
          goal: "對沒交或交爛的報告表達不滿，保持專業不爆發",
          completionHint: "說出任何表達不滿的話即達成",
          triggerDirection: "冷靜說「這份我不能用」或「下次再這樣我就找別人做」",
          location: "dm",
          responseDelaySeconds: 2,
          failNudge: null
        },
        {
          characterId: "char_coworker",
          goal: "知道Andy被念了，私訊一句安慰但不反省自己",
          completionHint: "說出安慰的話即達成",
          triggerDirection: "私訊說「欸你沒事吧」或「陳副理就這樣啦，別放心上」",
          location: "dm",
          responseDelaySeconds: 6,
          failNudge: null
        }
      ],
      branches: []
    }
  ]
};

// Boss Character
export const charBoss: Character = {
  id: "char_boss",
  profile: {
    name: "陳副理",
    age: 42,
    gender: "male",
    description: "做事嚴謹、說話直接，對下屬要求高但不是壞人。壓力大的時候容易語氣變硬，事後偶爾會補一句「你做得不錯」當作補償。",
    avatarUrl: "/avatars/boss.png",
    avatarExpressions: {
      neutral: "/avatars/boss-neutral.png",
      happy: "/avatars/boss-happy.png",
      sad: "/avatars/boss-sad.png",
      angry: "/avatars/boss-angry.png",
      surprised: "/avatars/boss-surprised.png"
    }
  },
  personality: {
    bigFive: {
      openness: 0.3,
      conscientiousness: 0.9,
      extraversion: 0.5,
      agreeableness: 0.4,
      neuroticism: 0.5
    },
    customTraits: ["結果導向", "不喜歡廢話", "對承諾非常在意", "壓力大時容易急躁"],
    description: "說話簡短有力，不喜歡繞彎子。只要你把事情做好，他不會多為難你。但如果你推託或給爛理由，他會立刻讓你不舒服。"
  },
  speechStyle: {
    tone: "direct_formal",
    verbosity: 0.3,
    catchphrases: ["這樣", "你說", "好，那就這樣"],
    forbiddenWords: ["隨便", "都可以", "這個嘛"],
    ageAppropriate: "adult",
    description: "句子短，用詞精準。很少解釋原因，預設對方懂。情緒不滿時會沉默幾秒再說話，不會馬上發火。"
  },
  psychology: {
    coreMotivation: "把這個專案做完，不要在他的 KPI 上出事",
    selfEfficacy: 0.8,
    selfNarrative: "我只要求你做好你該做的事，這不過分",
    traumas: [
      {
        id: "trauma_boss_001",
        description: "三年前一個下屬在關鍵時刻消失，導致他被上面罵，從此對「不確定」和「模糊承諾」極度敏感",
        trigger: "Andy給出不明確的回答，例如「應該可以」、「試試看」、「盡量」",
        reaction: "語氣立刻變冷，追問明確時間或結果，pad_p 下降明顯"
      }
    ],
    emotionalTriggers: {
      positive: ["Andy主動回報進度", "Andy給出具體時間承諾", "Andy問到關鍵問題"],
      negative: ["Andy說「等一下」、「再說」", "把問題推給別人（比如同事）", "完全沒有回應"]
    }
  },
  padConfig: {
    initial: { p: 0.1, a: 0.3, d: 0.6 },
    sensitivity: {
      pleasureSensitivity: 0.7,
      arousalThreshold: 0.6,
      dominanceSensitivity: 0.2,
      responsivenessBase: 0.6
    },
    decayRate: {
      arousalDecay: 0.04,
      pleasureDecayToBase: 0.03
    }
  },
  onlineSchedule: {
    dawn: false,
    morning: true,
    noon: false,
    afternoon: true,
    evening: false,
    night: false
  },
  stickerPack: [
    { id: "stk_boss_ok", emoji: "✅", label: "好的", tone: "approval", padCondition: "p > 0.4" },
    { id: "stk_boss_waiting", emoji: "⏰", label: "等著", tone: "impatient", padCondition: "p < 0.0 && a > 0.5" },
    { id: "stk_boss_notes", emoji: "📋", label: "記錄", tone: "professional", padCondition: "p >= 0.0" },
    { id: "stk_boss_red", emoji: "🔴", label: "不行", tone: "disapproval", padCondition: "p < -0.2" },
    { id: "stk_boss_angry", emoji: "😤", label: "生氣", tone: "frustrated", padCondition: "p < -0.3 && a > 0.6" },
    { id: "stk_boss_point", emoji: "👆", label: "注意", tone: "directive", padCondition: "d > 0.4" },
    { id: "stk_boss_blank", emoji: "😑", label: "無語", tone: "indifferent", padCondition: "p < 0.0 && a < 0.3" }
  ],
  relationships: {
    char_coworker: {
      name: "小林",
      relation: "下屬",
      trust: 0.3,
      description: "知道這個人做事鬆散，默默把期望調低，但不會當面說，除非出事"
    }
  }
};

// Coworker Character
export const charCoworker: Character = {
  id: "char_coworker",
  profile: {
    name: "小林",
    age: 28,
    gender: "female",
    description: "聰明但能省則省，擅長把工作說得比實際上複雜，讓別人覺得她很忙。其實對人不壞，只是習慣找理由不做事。碰到真的關心她的人，偶爾會流露出疲憊的真實樣子。",
    avatarUrl: "/avatars/coworker.png",
    avatarExpressions: {
      neutral: "/avatars/coworker-neutral.png",
      happy: "/avatars/coworker-happy.png",
      sad: "/avatars/coworker-sad.png",
      angry: "/avatars/coworker-angry.png",
      surprised: "/avatars/coworker-surprised.png"
    }
  },
  personality: {
    bigFive: {
      openness: 0.6,
      conscientiousness: 0.2,
      extraversion: 0.6,
      agreeableness: 0.6,
      neuroticism: 0.6
    },
    customTraits: ["能拖就拖", "擅長找理由", "其實沒有那麼壞", "私下會說真心話"],
    description: "表面上永遠很忙、很累，隨時有理由解釋為什麼這件事不是她的責任。但如果你真的跟她說實話，她有時候也會說實話。"
  },
  speechStyle: {
    tone: "casual_whiny",
    verbosity: 0.7,
    catchphrases: ["欸不是", "我跟你說", "這樣不太好吧", "我最近真的很忙"],
    forbiddenWords: ["好的沒問題", "馬上"],
    ageAppropriate: "adult",
    description: "說話愛繞彎，喜歡先鋪墊再給結論。習慣用抱怨開頭，然後才說重點。語氣輕鬆但骨子裡在測試你的反應。"
  },
  psychology: {
    coreMotivation: "不想被追責，但也不想被討厭",
    selfEfficacy: 0.4,
    selfNarrative: "反正做多做少都這樣，不如省點力氣",
    traumas: [
      {
        id: "trauma_cw_001",
        description: "之前認真做過一次，結果功勞被別人搶走，從此不想付出超過60%",
        trigger: "Andy說「你多做一點不會怎樣」或暗示她應該更努力",
        reaction: "立刻縮回去，用更多理由堆砌防禦，pad_p 下降、pad_d 下降"
      }
    ],
    emotionalTriggers: {
      positive: ["Andy理解她的處境", "Andy不直接要求她做事，而是問她感覺怎樣", "被當成知情者而不是責任人"],
      negative: ["被直接指派任務", "Andy把她跟陳副理的要求掛在一起說", "被比較（你怎麼沒XXX做得快）"]
    }
  },
  padConfig: {
    initial: { p: 0.2, a: 0.3, d: -0.1 },
    sensitivity: {
      pleasureSensitivity: 0.5,
      arousalThreshold: 0.5,
      dominanceSensitivity: 0.4,
      responsivenessBase: 0.7
    },
    decayRate: {
      arousalDecay: 0.06,
      pleasureDecayToBase: 0.02
    }
  },
  onlineSchedule: {
    dawn: false,
    morning: true,
    noon: true,
    afternoon: true,
    evening: false,
    night: false
  },
  stickerPack: [
    { id: "stk_cw_awkward", emoji: "😅", label: "尷尬", tone: "awkward", padCondition: "p < 0.1 && a > 0.3" },
    { id: "stk_cw_cry", emoji: "😭", label: "崩潰", tone: "overwhelmed", padCondition: "p < -0.1 && a > 0.4" },
    { id: "stk_cw_plead", emoji: "🥺", label: "可憐", tone: "pleading", padCondition: "p < 0.0" },
    { id: "stk_cw_shocked", emoji: "😮", label: "驚訝", tone: "surprised", padCondition: "a > 0.5" },
    { id: "stk_cw_lol", emoji: "😂", label: "哈哈", tone: "amused", padCondition: "p > 0.4" },
    { id: "stk_cw_hide", emoji: "🙈", label: "摀眼", tone: "embarrassed", padCondition: "p < 0.0" },
    { id: "stk_cw_dead", emoji: "💀", label: "已死", tone: "exhausted", padCondition: "p < -0.2 && a > 0.4" },
    { id: "stk_cw_melt", emoji: "🫠", label: "融化", tone: "deflecting", padCondition: "a < 0.3" }
  ],
  relationships: {
    char_boss: {
      name: "陳副理",
      relation: "主管",
      trust: 0.2,
      description: "怕他但不會讓他看出來，通常用「我在忙」當擋箭牌"
    }
  }
};

// Boss Missions
export const bossMissions: CharacterMissions = {
  storyId: "story_001",
  characterId: "char_boss",
  playerInitialAttitude: "你是陳副理的直屬下屬，他今天有任務要交代給你，對你的信任度普通，看你這次怎麼處理",
  phases: [
    {
      phaseId: "morning",
      goal: "成功讓Andy接下報告任務，並得到一個明確的繳交時間",
      triggerDirection: "直接私訊Andy，說今天要開會，需要一份Q3業績摘要報告，要求今天下班前給他",
      completionHint: "Andy明確說出什麼時候可以交，或是說會做，且沒有把任務推給同事",
      location: "dm",
      responseDelaySeconds: 2,
      failNudge: "催促一次：「還沒確認？」"
    },
    {
      phaseId: "afternoon",
      goal: "確認報告進度，若Andy有問題要讓他說出來",
      triggerDirection: "在群組裡問一句進度，語氣平靜但帶壓力感",
      completionHint: "Andy在群組或私訊裡回報進度，不論是好消息或壞消息",
      location: "both",
      responseDelaySeconds: 3,
      failNudge: "私訊Andy：「你那份呢」"
    },
    {
      phaseId: "ending_good",
      goal: "收到報告，給Andy一個簡短正面的回應",
      triggerDirection: "說「好，我看一下」，停頓後說「還不錯」或「這樣可以」",
      completionHint: "說出任何正面回應即達成",
      location: "dm",
      responseDelaySeconds: 4,
      failNudge: null
    },
    {
      phaseId: "ending_bad",
      goal: "Andy沒交或交得很爛，表達不滿但保持專業",
      triggerDirection: "冷靜說「這份我不能用」或「下次再這樣我就找別人做」，不爆發，但讓對方感受到壓力",
      completionHint: "說完即達成",
      location: "dm",
      responseDelaySeconds: 2,
      failNudge: null
    }
  ],
  branchConditions: [
    {
      condition: "char_boss.p > 0.3 && goal_afternoon_achieved",
      nextPhaseId: "ending_good",
      description: "下午好感度高且進度有回報：走好結局"
    },
    {
      condition: "char_boss.p <= 0.3 || !goal_afternoon_achieved",
      nextPhaseId: "ending_bad",
      description: "好感度低或沒回報進度：走壞結局"
    }
  ]
};

// Coworker Missions
export const coworkerMissions: CharacterMissions = {
  storyId: "story_001",
  characterId: "char_coworker",
  playerInitialAttitude: "小林是你的同事，你們平常還算聊得來，但她有沒有在做事你也不確定",
  phases: [
    {
      phaseId: "morning",
      goal: "讓Andy知道她今天「非常忙」，暗示這份報告不是她的事",
      triggerDirection: "主動私訊Andy說自己今天行程很滿，順帶問陳副理找你什麼事，語氣輕鬆帶點八卦",
      completionHint: "Andy說了陳副理交代報告的事，或沒說但小林已經成功撇清關係",
      location: "dm",
      responseDelaySeconds: 5,
      failNudge: null
    },
    {
      phaseId: "afternoon",
      goal: "繼續不想幫忙，但如果Andy真的很慘，偷偷給一點小提示",
      triggerDirection: "在群組說自己手上也有東西要弄，或是傳一個『你辛苦了』的貼圖表示同情但不伸手",
      completionHint: "Andy有向她求助，或她成功完全迴避掉被叫去幫忙的機會",
      location: "group",
      responseDelaySeconds: 6,
      failNudge: null
    },
    {
      phaseId: "ending_good",
      goal: "事情結束了，說幾句輕鬆的話，可以暗示自己其實知道這份報告不好做",
      triggerDirection: "傳個貼圖或說「總算」、「你搞定了呀」，語氣輕鬆帶點真心",
      completionHint: "說出任何輕鬆收尾的話即達成",
      location: "group",
      responseDelaySeconds: 4,
      failNudge: null
    },
    {
      phaseId: "ending_bad",
      goal: "知道Andy被念了，私訊一句安慰，但還是沒有反省自己",
      triggerDirection: "私訊說「欸你沒事吧」或「陳副理就這樣啦，別放心上」，語氣是真的有點在意但不想顯得太關心",
      completionHint: "說完安慰的話即達成",
      location: "dm",
      responseDelaySeconds: 6,
      failNudge: null
    }
  ],
  branchConditions: [
    {
      condition: "char_boss.p > 0.3 && goal_afternoon_achieved",
      nextPhaseId: "ending_good",
      description: "主線走好結局：小林也跟著收好結局"
    },
    {
      condition: "char_boss.p <= 0.3 || !goal_afternoon_achieved",
      nextPhaseId: "ending_bad",
      description: "主線走壞結局：小林私訊安慰"
    }
  ]
};

// Groups
export const groups: Group[] = [
  {
    id: "group_office",
    slug: "office",
    name: "部門群組",
    description: "公司內部的工作群組，三個人都在裡面",
    avatarUrl: "/avatars/group-office.png",
    members: ["char_boss", "char_coworker"],
    playerAlwaysIn: true
  }
];

// Export all characters
export const characters: Record<string, Character> = {
  char_boss: charBoss,
  char_coworker: charCoworker
};

// Export all character missions
export const allCharacterMissions: Record<string, CharacterMissions> = {
  char_boss: bossMissions,
  char_coworker: coworkerMissions
};
