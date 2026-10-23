// 纯函数：直播话术的环节、提示词、回复解析、合规检查、导出内容。不依赖界面和本机能力，便于单元测试。
import { extractJson, pick, toStringList } from './common';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface Stage {
  id: string;
  label: string;
  /** 这一环节要做到什么 */
  goal: string;
}

/** 直播的五个环节，按直播顺序排列 */
export const STAGES: Stage[] = [
  { id: 'open', label: '开场', goal: '欢迎进直播间的观众，说明今天播什么、有什么福利（只说商品信息里写了的），引导点关注、留在直播间' },
  { id: 'explain', label: '产品讲解', goal: '按「痛点或使用场景 → 产品特点 → 怎么用 → 规格」的顺序讲清楚商品，配合主播的展示动作' },
  { id: 'interact', label: '互动', goal: '用提问、扣字、选颜色或规格等方式让观众在评论区互动，回应常见疑问，带动直播间氛围' },
  { id: 'push', label: '逼单', goal: '在不夸大、不编造的前提下促成下单：复述价格和优惠、说明怎么下单、提醒优惠的真实期限或数量（只用商品信息里写了的）' },
  { id: 'close', label: '收尾', goal: '感谢观众，复述今天的商品和福利，提醒售后和发货方式（只说写了的），预告下次直播或引导关注' },
];
export const stageOf = (id: string) => STAGES.find((s) => s.id === id);

export const TONES: [string, string][] = [
  ['friendly', '亲切唠嗑'],
  ['pro', '专业讲解'],
  ['hot', '热情带货'],
];
const TONE_TEXT: Record<string, string> = {
  friendly: '像和朋友聊天一样亲切自然，口语化，不端着',
  pro: '专业、条理清楚，多讲材质、做法和使用方法，少喊口号',
  hot: '节奏快、有感染力，但不吼叫、不夸张承诺',
};

export const LENGTHS: [string, string][] = [
  ['short', '短（约 1 分钟）'],
  ['mid', '中（约 2～3 分钟）'],
  ['long', '长（约 5 分钟）'],
];
/** 按正常语速每分钟约 200～250 字估算的字数范围（只是给大模型的参考） */
const LENGTH_TEXT: Record<string, string> = {
  short: '约 150～250 字，口播 1 分钟左右',
  mid: '约 400～600 字，口播 2～3 分钟',
  long: '约 900～1200 字，口播 5 分钟左右',
};

/** 要生成的环节：多选值是逗号连接的环节 id，按直播顺序排好，没选时用全部 */
export function selectedStages(v: unknown): Stage[] {
  const set = new Set(String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const list = STAGES.filter((s) => set.has(s.id));
  return list.length ? list : STAGES;
}

export const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || dflt));

/** 第 index 条对应哪个环节、第几版（同一环节的几版排在一起） */
export function slotOf(index: number, stages: Stage[], versions: number): { stage: Stage; version: number } {
  const i = Math.max(0, Math.min(index, stages.length * versions - 1));
  return { stage: stages[Math.floor(i / versions)], version: (i % versions) + 1 };
}

export const slotName = (stage: Stage, version: number, versions: number) => (versions > 1 ? `${stage.label} · 第 ${version} 版` : stage.label);

export interface Product {
  name: string;
  info: string;
  price: string;
  audience: string;
}

export interface GenOptions {
  tone: string;
  length: string;
  extra: string;
}

export const SYSTEM_PROMPT = `你是经验丰富的直播带货主播和话术编辑，帮主播写微信视频号直播间的口播话术。必须遵守：
1. 只根据给出的商品信息写。不编造功效、参数、材质、产地、认证、销量、排名、好评率、用户评价。
2. 价格、优惠、赠品、库存数量、活动截止时间只能用「价格与优惠」里写了的；没写就不提具体数字，可以说「价格看直播间商品链接」。不虚构「原价」「只剩最后几件」「马上涨价」。
3. 不使用广告法禁止的绝对化用语，例如：最、第一、国家级、世界级、最高级、最佳、顶级、极致、唯一、首选、100%、绝对、万能、永久、全网最低。
4. 除非商品本身是药品或医疗器械，否则不说治疗、治愈、消炎、抗癌、降血压、减肥等疾病治疗或医疗功效，不承诺效果。
5. 不贬低其他品牌或其他主播，不诱导私下转账或线下交易。
6. 写成主播能直接念的口语，可以用【】标出主播的动作或镜头提示。
7. 只输出 JSON，不要任何解释。`;

export function buildMessages(stage: Stage, version: number, p: Product, o: GenOptions): ChatMessage[] {
  const tone = TONE_TEXT[o.tone] ?? TONE_TEXT.friendly;
  const len = LENGTH_TEXT[o.length] ?? LENGTH_TEXT.mid;
  const user = `直播平台：微信视频号直播
要写的环节：${stage.label}
这个环节要做到：${stage.goal}
风格：${tone}
长度：${len}${version > 1 ? `\n这是第 ${version} 版，换一个和常见写法不同的切入角度。` : ''}${o.extra ? `\n补充要求：${o.extra.slice(0, 300)}` : ''}

商品名称：${p.name.slice(0, 100)}
商品信息：${p.info.slice(0, 1500) || '（没有写）'}
价格与优惠：${p.price.slice(0, 500) || '（没有写，不要提具体价格和优惠）'}
目标人群：${p.audience.slice(0, 200) || '（没有写）'}

按这个格式输出：{"script": "话术正文，可以分段", "tips": ["主播注意事项1", "注意事项2"]}`;
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }];
}

export interface Generated {
  script: string;
  tips: string[];
}

/** 解析模型回复：兼容代码块、中文键名、话术写成数组；不是 JSON 时把整段当话术 */
export function parseReply(text: string): Generated {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    const plain = String(text ?? '').replace(/```[a-z]*|```/gi, '').trim();
    if (!plain || /^[[{]/.test(plain)) throw new Error('大模型返回的内容无法识别');
    return { script: plain, tips: [] };
  }
  const root = Array.isArray(data) ? data[0] : data;
  const raw = pick(root, ['script', 'text', 'content', '话术', '正文', 'lines', '话术正文']);
  const script = (Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? x : String(pick(x, ['text', 'content', '内容']) ?? ''))).filter(Boolean).join('\n') : typeof raw === 'string' ? raw : '').trim();
  if (!script) throw new Error('大模型没有返回话术');
  const tips = toStringList(pick(root, ['tips', 'notes', '注意事项', '提示', 'actions']));
  return { script, tips };
}

/**
 * 广告法绝对化用语（常见执法口径整理，不完整，只做提醒）。依据：《广告法》（2015 年修订文本）第九条第（三）项
 * 「使用"国家级"、"最高级"、"最佳"等用语」。按长度从长到短排列，先匹配长的。
 */
export const BANNED_WORDS = [
  '全网最低', '全网第一', '销量第一', '排名第一', '全国第一', '行业第一', '史无前例', '独一无二', '绝无仅有', '国家级', '世界级', '全球级',
  '最高级', '最低价', '最便宜', '最先进', '最优秀', '最好', '最佳', '最强', '最高', '最低', '最大', '最新', '最热', '最火', '最牛', '最实惠',
  '第一品牌', '顶级', '顶尖', '极致', '极品', '唯一', '首选', '首家', '万能', '100%', '百分百', '绝对', '永久', '王牌', '冠军', '领导品牌', '第一', '最',
].sort((a, b) => b.length - a.length);

/** 含「最」「第一」但通常不是绝对化宣传的说法，检查前先去掉 */
const BANNED_SAFE = ['最近', '最后', '最终', '最初', '最关心', '最常见', '第一次', '第一步', '第一个', '第一件', '第一款', '第一单', '第一位', '第一波', '第一轮', '第一天', '第一眼', '第一时间'];

/**
 * 疾病治疗与医疗用语（只做提醒）。依据：《广告法》（2015 年修订文本）第十七条
 * 「除医疗、药品、医疗器械广告外，禁止其他任何广告涉及疾病治疗功能，并不得使用医疗用语……」。词表为常见示例，不完整。
 */
export const MEDICAL_WORDS = ['药到病除', '根治', '治愈', '治疗', '疗效', '消炎', '抗癌', '防癌', '降血压', '降血糖', '降血脂', '减肥', '祛斑', '生发', '处方', '特效'];

/** 找出文本里命中的词（去重，长词优先，已命中长词的部分不再重复命中短词） */
function findWords(s: string, words: string[], safe: string[] = []): string[] {
  let rest = s;
  for (const w of safe) rest = rest.split(w).join('　');
  const hit: string[] = [];
  for (const w of words) {
    if (rest.includes(w)) {
      hit.push(w);
      rest = rest.split(w).join('　');
    }
  }
  return hit;
}
export const findBanned = (s: string) => findWords(s, BANNED_WORDS, BANNED_SAFE);
export const findMedical = (s: string) => findWords(s, MEDICAL_WORDS);

/** 把金额写法统一成数字：「¥89」「89 元」「89块」「89.00元」都算 89 */
function amounts(s: string): number[] {
  const out: number[] = [];
  const re = /(?:[¥￥]\s*(\d+(?:\.\d+)?))|(\d+(?:\.\d+)?)\s*(?:元|块钱|块)/g;
  for (const m of s.replace(/(\d),(\d{3})/g, '$1$2').matchAll(re)) out.push(Number(m[1] ?? m[2]));
  return out;
}

/** 话术里出现、但商品信息和价格优惠里都没有的金额（可能是大模型编的） */
export function unknownPrices(script: string, source: string): string[] {
  const known = new Set(amounts(source));
  // 商品信息里写的纯数字（例如「满 200 减 30」）也算已知
  for (const m of source.replace(/(\d),(\d{3})/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)) known.add(Number(m[0]));
  const bad = new Set<string>();
  for (const v of amounts(script)) if (!known.has(v)) bad.add(`${v} 元`);
  return [...bad];
}

export interface Check {
  banned: string[];
  medical: string[];
  prices: string[];
}

export function checkScript(g: Generated, p: Product): Check {
  const all = [g.script, ...g.tips].join('\n');
  return { banned: findBanned(all), medical: findMedical(all), prices: unknownPrices(g.script, `${p.name}\n${p.info}\n${p.price}`) };
}

export const hasIssue = (c: Check) => c.banned.length + c.medical.length + c.prices.length > 0;

/** 一行合规提醒；没有问题时为空字符串 */
export function issueText(c: Check): string {
  const parts: string[] = [];
  if (c.banned.length) parts.push(`含绝对化用语：${c.banned.join('、')}`);
  if (c.medical.length) parts.push(`含医疗或功效用语：${c.medical.join('、')}`);
  if (c.prices.length) parts.push(`出现了商品信息里没有的金额：${c.prices.join('、')}`);
  return parts.length ? `${parts.join('；')}。播前请核对修改` : '';
}

/** 界面上显示、复制的文本（界面卡片已有标题，不再带【环节】）；导出的直播稿带标题 */
export function formatScript(title: string, g: Generated, c: Check, heading = true): string {
  const lines = heading ? [`【${title}】`, '', g.script.trim()] : [g.script.trim()];
  if (g.tips.length) lines.push('', '主播注意：', ...g.tips.map((t) => `· ${t}`));
  const warn = issueText(c);
  if (warn) lines.push('', `⚠ 合规提醒：${warn}`);
  return lines.join('\n');
}

export function summaryOf(g: Generated, c: Check): string {
  const n = [...g.script.replace(/\s+/g, '')].length;
  const warn = [c.banned.length ? '绝对化用语' : '', c.medical.length ? '医疗用语' : '', c.prices.length ? '未提供的金额' : ''].filter(Boolean);
  return `${n} 字${warn.length ? ` · 需核对：${warn.join('、')}` : ' · 未发现极限词'}`;
}

export interface Piece {
  stage: string;
  version: number;
  title: string;
  g: Generated;
  c: Check;
}

/** 整场直播稿（TXT）：按环节顺序排列 */
export function fullScript(productName: string, pieces: Piece[], date: string): string {
  const head = [`${productName} · 视频号直播话术`, `生成日期：${date}　共 ${pieces.length} 段`, '说明：由大模型生成，开播前请核对商品信息、价格优惠，并检查是否有违反广告法的用语。', ''];
  const body = pieces.map((x) => formatScript(x.title, x.g, x.c)).join('\n\n────────────\n\n');
  return head.join('\n') + '\n' + body + '\n';
}

/** Excel 表的表头和行 */
export function sheetRows(pieces: Piece[]): { header: string[]; rows: (string | number)[][]; red: Set<string> } {
  const red = new Set<string>();
  const rows = pieces.map((x, i) => {
    const warn = issueText(x.c);
    if (warn) red.add(`${i},5`);
    return [i + 1, x.title.split(' · ')[0], x.version, x.g.script, x.g.tips.join('\n'), warn || '无', [...x.g.script.replace(/\s+/g, '')].length];
  });
  return { header: ['序号', '环节', '版本', '话术', '主播注意', '合规提醒', '字数'], rows, red };
}

/** 本地日期 YYYY-MM-DD */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
