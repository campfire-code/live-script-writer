// 工具声明：视频号直播话术生成（只生成话术，不连接直播间）
import { Mic as MicAsIcon } from 'lucide-react';
import type { GenerateTool, Params, RunContext } from '../kit/types';
import { isFatalLlmError, safeName } from './common';
import {
  LENGTHS, STAGES, TONES, buildMessages, checkScript, clampInt, formatScript, fullScript, parseReply, selectedStages, sheetRows, slotName, slotOf, summaryOf, today,
  type Generated, type Piece, type Product,
} from './core';
import { writeXlsx } from './xlsx';
import { ScriptBody, ScriptEmpty } from './Views';

const versionsOf = (p: Params) => clampInt(p.versions, 1, 3, 1);

export function productOf(p: Params): Product {
  return { name: String(p.name ?? '').trim(), info: String(p.info ?? '').trim(), price: String(p.price ?? '').trim(), audience: String(p.audience ?? '').trim() };
}

async function writeOne(index: number, ctx: RunContext): Promise<Piece> {
  const p = ctx.params;
  const prod = productOf(p);
  const versions = versionsOf(p);
  const { stage, version } = slotOf(index, selectedStages(p.stages), versions);
  const opts = { tone: String(p.tone || 'friendly'), length: String(p.length || 'mid'), extra: String(p.extra ?? '').trim() };
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const g: Generated = parseReply(await ctx.llm(buildMessages(stage, version, prod, opts), { json: true, temperature: 0.85 }));
      return { stage: stage.id, version, title: slotName(stage, version, versions), g, c: checkScript(g, prod) };
    } catch (e) {
      if (isFatalLlmError(e)) throw e;
      last = e;
    }
  }
  throw last;
}

const tool: GenerateTool = {
  id: 'w19',
  name: '视频号直播话术生成',
  tagline: '填好商品信息和价格优惠，一键生成开场、产品讲解、互动、逼单、收尾五段直播话术，自动标出广告法极限词和商品信息里没有的价格，可导出整场直播稿。',
  icon: MicAsIcon,
  category: '微信私域',
  type: 'text',
  mode: 'generate',
  resultView: 'text',
  needsLLM: true,
  concurrency: 2,
  generateLabel: '生成话术',
  Empty: ScriptEmpty,
  ResultBody: ScriptBody,
  params: [
    { key: 'name', label: '商品名称', type: 'text', default: '', placeholder: '例如：316 不锈钢保温杯 500 毫升' },
    { key: 'info', label: '商品信息', type: 'textarea', rows: 4, default: '', placeholder: '规格、材质、卖点、适合谁、怎么用。只写真实信息，AI 不会补充你没写的功效和参数' },
    { key: 'price', label: '价格与优惠', type: 'textarea', rows: 2, default: '', placeholder: '例如：直播间 89 元，两个包邮，前 100 单送杯套。不写就不会提具体价格' },
    { key: 'audience', label: '目标人群', type: 'text', default: '', placeholder: '可选，例如：上班族、宝妈、学生' },
    { key: 'stages', label: '生成哪些环节', type: 'multi', options: STAGES.map((s) => [s.id, s.label]), default: STAGES.map((s) => s.id).join(',') },
    { key: 'tone', label: '主播风格', type: 'segment', options: TONES, default: 'friendly' },
    { key: 'length', label: '每段长度', type: 'select', options: LENGTHS, default: 'mid', help: '按正常语速估算，实际以主播语速为准' },
    { key: 'versions', label: '每个环节写几版', type: 'number', default: 1, min: 1, max: 3, unit: '版', help: '每版调用一次大模型，版数越多费用越高' },
    { key: 'extra', label: '补充要求', type: 'text', default: '', placeholder: '可选，例如：称呼观众为「家人们」，多讲怎么清洗' },
    { key: 'format', label: '导出格式', type: 'segment', options: [['txt', 'TXT 直播稿'], ['xlsx', 'Excel 表格']], default: 'txt' },
    { key: 'out', label: '保存到', type: 'folder', default: '' },
  ],
  count: (p) => selectedStages(p.stages).length * versionsOf(p),
  itemName: (i, p) => {
    const versions = versionsOf(p);
    const { stage, version } = slotOf(i, selectedStages(p.stages), versions);
    return slotName(stage, version, versions);
  },

  async generate(index, ctx) {
    const prod = productOf(ctx.params);
    if (!prod.name) throw new Error('先在「商品名称」里写上要播的商品');
    if (!prod.info) throw new Error('先在「商品信息」里写上规格和卖点，AI 只会用你写的信息');
    ctx.progress(0.2);
    const piece = await writeOne(index, ctx);
    return { title: piece.title, summary: summaryOf(piece.g, piece.c), text: formatScript(piece.title, piece.g, piece.c, false), data: piece };
  },

  async afterAll(results, ctx) {
    const pieces = results.map((r) => r.result.data as Piece | undefined).filter((x): x is Piece => !!x);
    if (!pieces.length) return;
    const order = (x: Piece) => STAGES.findIndex((s) => s.id === x.stage) * 10 + x.version;
    pieces.sort((a, b) => order(a) - order(b));
    const prod = productOf(ctx.params);
    const date = today();
    const name = safeName(`直播话术-${prod.name}-${date}`);
    const flagged = pieces.filter((x) => x.c.banned.length + x.c.medical.length + x.c.prices.length > 0).length;
    const tail = flagged ? `；${flagged} 段有合规提醒，播前请核对` : '';
    if (ctx.params.format === 'xlsx') {
      const path = await ctx.join(ctx.outputDir, `${name}.xlsx`);
      const s = sheetRows(pieces);
      await ctx.writeFile(path, await writeXlsx([{ name: '直播话术', header: s.header, rows: s.rows, red: s.red, wrap: [3, 4, 5] }], '篝火 · 视频号直播话术生成'));
      return `直播话术已导出：${path}${tail}`;
    }
    const path = await ctx.join(ctx.outputDir, `${name}.txt`);
    await ctx.writeText(path, fullScript(prod.name, pieces, date));
    return `直播稿已导出：${path}${tail}`;
  },
};

export default tool;
