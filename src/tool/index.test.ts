import { describe, expect, it } from 'vitest';
import type { InputItem, ItemResult, Params, RunContext } from '../kit/types';
import tool from './index';
import { readFirstSheet } from './xlsx';

const defaults = (over: Params = {}): Params => ({
  ...Object.fromEntries(tool.params.map((f) => [f.key, f.default])),
  name: '316 不锈钢保温杯', info: '500ml，316 不锈钢内胆，一键开盖', price: '直播间 89 元，两个包邮', ...over,
});

type Llm = RunContext['llm'];
function fakeCtx(params: Params, llm: Llm, files = new Map<string, Uint8Array>()): RunContext {
  return {
    params, outputDir: '/out', signal: new AbortController().signal, progress: () => {},
    readFile: async (p) => files.get(p)!, readText: async (p) => new TextDecoder().decode(files.get(p)!),
    writeFile: async (p, d) => void files.set(p, d), writeText: async (p, t) => void files.set(p, new TextEncoder().encode(t)),
    mkdir: async () => {}, join: async (...parts) => parts.join('/'), llm, sidecar: async () => '',
  };
}
// 假的大模型：按提示词里的环节名回复
const llm: Llm = async (m) => {
  const stage = /要写的环节：(\S+)/.exec(m[1].content)![1];
  return JSON.stringify({ script: stage === '逼单' ? `家人们，直播间 89 元，最划算的就是今天` : `${stage}话术`, tips: ['看镜头'] });
};

async function runAll(params: Params, model: Llm = llm) {
  if (tool.mode !== 'generate') throw new Error();
  const files = new Map<string, Uint8Array>();
  const ctx = fakeCtx(params, model, files);
  const n = tool.count!(params);
  const results: { item: InputItem; result: ItemResult }[] = [];
  // 倒着生成，验证导出时会按直播顺序排好
  for (let i = n - 1; i >= 0; i--) results.push({ item: { id: `g_${i}`, name: tool.itemName!(i, params) }, result: await tool.generate(i, ctx) });
  return { files, results, msg: await tool.afterAll!(results, ctx) };
}

describe('生成流程', () => {
  it('默认五个环节各一段，导出 TXT 直播稿', async () => {
    const p = defaults();
    if (tool.mode !== 'generate') throw new Error();
    expect(tool.count!(p)).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => tool.itemName!(i, p))).toEqual(['开场', '产品讲解', '互动', '逼单', '收尾']);
    const { files, results, msg } = await runAll(p);
    const push = results.find((r) => r.result.title === '逼单')!.result;
    expect(push.summary).toBe('19 字 · 需核对：绝对化用语');
    expect(push.text).toContain('⚠ 合规提醒：含绝对化用语：最');
    expect(msg).toMatch(/^直播稿已导出：\/out\/直播话术-316 不锈钢保温杯-\d{4}-\d{2}-\d{2}\.txt；1 段有合规提醒，播前请核对$/);
    const path = [...files.keys()][0];
    const txt = new TextDecoder().decode(files.get(path));
    const order = ['【开场】', '【产品讲解】', '【互动】', '【逼单】', '【收尾】'].map((t) => txt.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  });

  it('选两个环节各两版，导出 Excel', async () => {
    const { files, msg } = await runAll(defaults({ stages: 'open,close', versions: 2, format: 'xlsx' }));
    expect(msg).toMatch(/^直播话术已导出：\/out\/.+\.xlsx$/);
    const sheet = await readFirstSheet([...files.values()][0]);
    expect(sheet.map((r) => [r[1], r[2], r[3]])).toEqual([['环节', '版本', '话术'], ['开场', 1, '开场话术'], ['开场', 2, '开场话术'], ['收尾', 1, '收尾话术'], ['收尾', 2, '收尾话术']]);
  });

  it('没填商品名称或商品信息时报错', async () => {
    if (tool.mode !== 'generate') throw new Error();
    await expect(tool.generate(0, fakeCtx(defaults({ name: '' }), llm))).rejects.toThrow('先在「商品名称」里写上要播的商品');
    await expect(tool.generate(0, fakeCtx(defaults({ info: ' ' }), llm))).rejects.toThrow('先在「商品信息」里写上规格和卖点');
  });

  it('解析失败重试一次；没配置大模型直接报错不重试', async () => {
    if (tool.mode !== 'generate') throw new Error();
    let calls = 0;
    const flaky: Llm = async () => (++calls === 1 ? '{"tips":[]}' : '{"script":"开场话术"}');
    expect((await tool.generate(0, fakeCtx(defaults(), flaky))).text).toBe('开场话术');
    expect(calls).toBe(2);
    calls = 0;
    const fatal: Llm = async () => { calls++; throw new Error('还没有设置大模型：请到「设置」里填写接口地址、密钥和模型名'); };
    await expect(tool.generate(0, fakeCtx(defaults(), fatal))).rejects.toThrow('还没有设置大模型');
    expect(calls).toBe(1);
  });
});
