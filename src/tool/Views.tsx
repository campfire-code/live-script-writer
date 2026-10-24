// 直播话术的空状态和单段结果展示：提词器式排版，动作提示做成标签，合规问题用高亮标出
import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ClipboardList, Hand, Mic } from 'lucide-react';
import type { InputItem, ItemResult } from '../kit/types';
import { CopyButton } from '../kit/parts';
import { STAGES } from './core';
import './tool.css';

const TIPS_MARK = '\n\n主播注意：';
const WARN_MARK = '\n\n⚠ 合规提醒：';

/** 把 formatScript 生成的文本拆成口播、主播注意、合规提醒三块 */
export function splitScript(text: string): { script: string; tips: string[]; warn: string; words: string[] } {
  let body = text;
  let warn = '';
  const w = body.indexOf(WARN_MARK);
  if (w >= 0) { warn = body.slice(w + WARN_MARK.length).trim(); body = body.slice(0, w); }
  let tips: string[] = [];
  const t = body.indexOf(TIPS_MARK);
  if (t >= 0) { tips = body.slice(t + TIPS_MARK.length).split('\n').map((l) => l.replace(/^·\s*/, '').trim()).filter(Boolean); body = body.slice(0, t); }
  const words = [...warn.matchAll(/：([^；。]+)/g)].flatMap((m) => m[1].split('、').map((x) => x.trim()).filter(Boolean));
  return { script: body.trim(), tips, warn, words };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Marked({ text, words }: { text: string; words: string[] }): ReactNode {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map(esc).join('|')})`, 'g');
  return text.split(re).map((p, i) => (words.includes(p) ? <mark key={i} className="ls-mark">{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

export function ScriptBody({ result }: { item: InputItem; result: ItemResult }) {
  const { script, tips, warn, words } = splitScript(result.text ?? '');
  const lines = script.split('\n').filter((l) => l.trim());
  return (
    <div className="ls-card">
      <div className="ls-script">
        {lines.map((line, i) => (
          <p key={i}>
            {line.split(/(【[^】]*】)/).map((seg, j) => (/^【[^】]*】$/.test(seg)
              ? <span key={j} className="ls-cue"><Hand size={12} />{seg.slice(1, -1)}</span>
              : <Marked key={j} text={seg} words={words} />))}
          </p>
        ))}
      </div>
      {tips.length > 0 && (
        <aside className="ls-tips" aria-label="主播注意">
          <b><ClipboardList size={14} />主播注意</b>
          <ul>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </aside>
      )}
      {warn && <div className="ls-warn" role="alert"><AlertTriangle size={15} /><span>{warn}</span></div>}
      <div className="ls-foot">
        <span className="ls-count k-num">{[...script.replace(/\s+/g, '')].length} 字</span>
        <CopyButton text={result.copyText ?? result.text ?? ''} label="复制这一段" />
      </div>
    </div>
  );
}

export function ScriptEmpty() {
  return (
    <div className="ls-empty">
      <div className="ls-flow" aria-hidden="true">
        <div className="ls-doc"><b>商品信息</b><i /><i /><i className="s" /><em>价格与优惠</em></div>
        <ArrowRight size={20} />
        <div className="ls-stages">
          {STAGES.map((s, k) => <span key={s.id} className="ls-stage"><b>{k + 1}</b>{s.label}</span>)}
        </div>
      </div>
      <h2><Mic size={18} />把商品信息，变成整场直播的口播稿</h2>
      <p>在右边填好商品和价格，点「生成话术」。每个环节一段，主播的动作提示单独标出，价格和商品信息之外的内容不会编造。</p>
      <ul>
        <li>自动标出极限词、医疗功效用语和商品信息里没有的金额</li>
        <li>每个环节可以多写几版挑着用，最后导出整场直播稿</li>
      </ul>
    </div>
  );
}
