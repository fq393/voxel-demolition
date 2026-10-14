import type { WantedState } from './wanted-state.ts';
export class WantedUI {
  private readonly root = document.createElement('aside');
  private readonly stars = document.createElement('strong');
  private readonly note = document.createElement('span');
  private readonly option = document.createElement('button');
  private readonly style = document.createElement('style');
  private readonly state: WantedState;
  private last = '';
  constructor(menu: HTMLElement, state: WantedState, onToggle: () => void) {
    this.state = state;
    this.style.textContent = `.wanted{position:fixed;right:calc(env(safe-area-inset-right) + 14px);top:calc(env(safe-area-inset-top) + 170px);z-index:4;width:146px;box-sizing:border-box;padding:9px 11px;background:#182b35e8;border-right:3px solid #91bbcb;border-radius:7px 0 0 7px;color:#f1dcc0;font:11px/1.4 system-ui;pointer-events:none}.wanted[hidden]{display:none}.wanted strong{display:block;font-size:20px;letter-spacing:5px;color:#edc785}.wanted span{display:block;margin-top:2px}.wanted-option{width:100%;min-height:44px;margin:8px 0;border:1px solid #799fa070;border-radius:6px;background:#283d3d;color:#f4e7ce;cursor:pointer;font:12px system-ui}.wanted-option:focus-visible{outline:2px solid #edc785;outline-offset:2px}@media(orientation:portrait) and (max-width:680px){.wanted{top:calc(env(safe-area-inset-top) + 243px);right:12px;width:124px;font-size:10px;padding:8px}.wanted strong{font-size:17px}}@media(orientation:landscape){body.touch .wanted{top:calc(env(safe-area-inset-top) + 165px);width:145px;padding:7px 10px}}`;
    document.head.append(this.style); this.root.className = 'wanted'; this.root.hidden = true;
    this.root.setAttribute('aria-label','警察通缉'); this.root.append(this.stars,this.note); document.body.append(this.root);
    this.option.className = 'wanted-option'; this.option.type = 'button';
    this.option.addEventListener('click', () => { this.option.blur(); onToggle(); this.update(false); });
    menu.querySelector('.buttons')?.before(this.option); this.update(false);
  }
  update(visible: boolean): void {
    const w = this.state.diagnostics;
    this.root.hidden = !visible || !w.eligible;
    const key=JSON.stringify([w.stars,w.enabled,w.eligible,w.phase,w.shelter>0,Math.ceil(w.remaining)]);
    if(key===this.last)return;this.last=key;
    this.stars.textContent = '★'.repeat(w.stars) + '☆'.repeat(3 - w.stars);
    this.note.textContent = !w.enabled ? '自由拆除 · 警察休假' : !w.stars ? '平静街区 · 两车巡逻' : w.shelter > 0 ? `车库避风头 · ${Math.ceil(w.remaining)} 秒` : w.phase === 'chase' ? '警车追赶 · 躲开视线' : `搜索中 · 脱离 ${Math.ceil(w.remaining)} 秒`;
    this.option.textContent = w.enabled ? '警察追逐：开启 · 点此自由拆除' : '警察追逐：关闭 · 点此开启';
    this.option.setAttribute('aria-pressed', String(w.enabled)); this.option.disabled = !w.eligible;
  }
  dispose(): void { this.root.remove(); this.option.remove(); this.style.remove(); }
}
