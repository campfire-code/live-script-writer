import { describe, expect, it } from 'vitest';
import {
  STAGES, buildMessages, checkScript, findBanned, findMedical, formatScript, fullScript, issueText, parseReply, selectedStages, sheetRows, slotName, slotOf, summaryOf, unknownPrices,
} from './core';

const prod = { name: '316 不锈钢保温杯', info: '500ml，316 不锈钢内胆，一键开盖', price: '直播间 89 元，两个 159 元包邮，送杯套', audience: '上班族' };

describe('环节与条目', () => {
  it('多选按直播顺序排，没选就用全部', () => {
    expect(selectedStages('close,open').map((s) => s.id)).toEqual(['open', 'close']);
    expect(selectedStages('')).toHaveLength(5);
    expect(selectedStages('bad')).toHaveLength(5);
  });
  it('同一环节的几版排在一起', () => {
    const st = selectedStages('open,push');
    expect([0, 1, 2, 3].map((i) => { const s = slotOf(i, st, 2); return slotName(s.stage, s.version, 2); })).toEqual(['开场 · 第 1 版', '开场 · 第 2 版', '逼单 · 第 1 版', '逼单 · 第 2 版']);
    expect(slotName(STAGES[0], 1, 1)).toBe('开场');
  });
});

describe('提示词', () => {
  it('包含环节、商品信息和不编造的要求', () => {
    const [sys, user] = buildMessages(STAGES[3], 1, prod, { tone: 'hot', length: 'short', extra: '' });
    expect(sys.content).toContain('不编造功效');
    expect(sys.content).toContain('最、第一');
    expect(sys.content).toContain('不虚构「原价」');
    expect(user.content).toContain('要写的环节：逼单');
    expect(user.content).toContain('直播间 89 元');
    expect(user.content).toContain('约 150～250 字');
    expect(user.content).not.toContain('第 1 版');
  });
  it('没写价格时明确要求不提具体价格', () => {
    const [, user] = buildMessages(STAGES[0], 2, { ...prod, price: '' }, { tone: 'friendly', length: 'mid', extra: '多讲清洗' });
    expect(user.content).toContain('没有写，不要提具体价格和优惠');
    expect(user.content).toContain('这是第 2 版');
    expect(user.content).toContain('补充要求：多讲清洗');
  });
});

describe('解析回复', () => {
  it('标准 JSON', () => {
    expect(parseReply('{"script":"家人们好","tips":["举起杯子"]}')).toEqual({ script: '家人们好', tips: ['举起杯子'] });
  });
  it('代码块、中文键名、话术是数组', () => {
    expect(parseReply('好的：\n```json\n{"话术":["第一句","第二句"],"注意事项":"1. 慢一点\\n2. 看镜头"}\n```')).toEqual({ script: '第一句\n第二句', tips: ['慢一点', '看镜头'] });
  });
  it('不是 JSON 时整段当话术', () => {
    expect(parseReply('家人们晚上好，欢迎来到直播间')).toEqual({ script: '家人们晚上好，欢迎来到直播间', tips: [] });
  });
  it('没有话术时报错', () => {
    expect(() => parseReply('{"tips":["a"]}')).toThrow('大模型没有返回话术');
    expect(() => parseReply('')).toThrow('无法识别');
  });
});

describe('合规检查', () => {
  it('找出绝对化用语，长词优先，常见说法不误报', () => {
    expect(findBanned('全网最低价，最好用的杯子')).toEqual(['全网最低', '最好']);
    expect(findBanned('大家最关心的，最近天冷，第一次买的家人们看过来，最后十分钟')).toEqual([]);
    expect(findBanned('我们是第一，绝对不漏')).toEqual(['绝对', '第一']);
  });
  it('找出医疗用语', () => {
    expect(findMedical('喝热水能治疗感冒，还能减肥')).toEqual(['治疗', '减肥']);
    expect(findMedical('保温 12 小时')).toEqual([]);
  });
  it('找出商品信息里没有的金额', () => {
    const src = `${prod.name}\n${prod.info}\n${prod.price}`;
    expect(unknownPrices('直播间 89 元，两个 159 块包邮', src)).toEqual([]);
    expect(unknownPrices('原价 199 元，今天只要 ¥89，再减 10块钱', src)).toEqual(['199 元', '10 元']);
    expect(unknownPrices('价格 1,299 元', '售价 1299 元')).toEqual([]);
    expect(unknownPrices('500ml 大容量', src)).toEqual([]);
  });
  it('汇总提醒和摘要', () => {
    const g = { script: '最好的杯子，原价 199 元', tips: ['可以说能治疗失眠'] };
    const c = checkScript(g, prod);
    expect(c).toEqual({ banned: ['最好'], medical: ['治疗'], prices: ['199 元'] });
    expect(issueText(c)).toBe('含绝对化用语：最好；含医疗或功效用语：治疗；出现了商品信息里没有的金额：199 元。播前请核对修改');
    expect(summaryOf(g, c)).toBe('12 字 · 需核对：绝对化用语、医疗用语、未提供的金额');
    expect(summaryOf({ script: '家人们 好', tips: [] }, { banned: [], medical: [], prices: [] })).toBe('4 字 · 未发现极限词');
  });
});

describe('输出', () => {
  const ok = { banned: [], medical: [], prices: [] };
  it('单段文本：标题、正文、注意事项、提醒', () => {
    expect(formatScript('开场', { script: '家人们好', tips: ['看镜头'] }, ok)).toBe('【开场】\n\n家人们好\n\n主播注意：\n· 看镜头');
    expect(formatScript('开场', { script: '家人们好', tips: [] }, ok, false)).toBe('家人们好');
    expect(formatScript('逼单', { script: '最划算', tips: [] }, { banned: ['最'], medical: [], prices: [] })).toBe('【逼单】\n\n最划算\n\n⚠ 合规提醒：含绝对化用语：最。播前请核对修改');
  });
  it('整场直播稿和 Excel 行', () => {
    const pieces = [
      { stage: 'open', version: 1, title: '开场', g: { script: '家人们好', tips: [] }, c: ok },
      { stage: 'push', version: 1, title: '逼单', g: { script: '最划算', tips: ['指购物车'] }, c: { banned: ['最'], medical: [], prices: [] } },
    ];
    const txt = fullScript('保温杯', pieces, '2026-10-23');
    expect(txt.startsWith('保温杯 · 视频号直播话术\n生成日期：2026-10-23　共 2 段\n')).toBe(true);
    expect(txt).toContain('【开场】\n\n家人们好\n\n────────────\n\n【逼单】');
    const s = sheetRows(pieces);
    expect(s.header).toEqual(['序号', '环节', '版本', '话术', '主播注意', '合规提醒', '字数']);
    expect(s.rows[0]).toEqual([1, '开场', 1, '家人们好', '', '无', 4]);
    expect(s.rows[1][5]).toBe('含绝对化用语：最。播前请核对修改');
    expect([...s.red]).toEqual(['1,5']);
  });
});
