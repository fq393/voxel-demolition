import { MissionState, type MissionMode, type MissionSnapshot } from './mission-state';

interface MissionOptions {
  onRetry: () => Promise<void>;
  onSandbox: () => void;
  onFinish: () => void;
  onStart?: () => void;
  onModeChange?: (mode: MissionMode) => void;
}

const styles = `
.mission-objective { position:fixed; z-index:3; left:calc(env(safe-area-inset-left) + 14px); top:calc(env(safe-area-inset-top) + 64px); width:228px; padding:10px 14px; box-sizing:border-box; border-left:3px solid #ffb347; border-radius:0 8px 8px 0; color:#f3efe6; background:rgba(18,19,23,.82); backdrop-filter:blur(8px); pointer-events:none; font:12px/1.3 system-ui,sans-serif; }
.mission-objective[hidden], .mission-result[hidden] { display:none; }
.mission-objective .mission-heading { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:6px; }
.mission-objective .mission-heading strong { color:#ffb347; font-size:12px; letter-spacing:.05em; }
.mission-clock { font:700 20px/1 ui-monospace,monospace; font-variant-numeric:tabular-nums; min-width:3ch; text-align:right; }
.mission-objective[data-urgent=true] .mission-clock { color:#ff7860; }
.mission-objective .mission-count { display:flex; justify-content:space-between; gap:8px; color:#cfcac0; margin-bottom:6px; }
.mission-count b { font-variant-numeric:tabular-nums; color:#fff; }
.mission-meter { height:4px; background:rgba(255,255,255,.15); overflow:hidden; border-radius:2px; }
.mission-meter i { display:block; height:100%; background:#ffb347; transform-origin:left; transition:transform 150ms linear; }
.mission-status { font-size:10px; line-height:1.2; color:#a9a69f; margin-top:6px; }
.mission-mode { margin:0 0 14px; }
.mission-mode .mission-mode-buttons { display:flex; gap:8px; }
.mission-mode button, .mission-result button { min-height:44px; font:600 13px/1.3 system-ui,sans-serif; cursor:pointer; border:1px solid rgba(255,255,255,.2); border-radius:7px; background:#272a30; color:#f3efe6; }
.mission-mode button { flex:1; padding:10px 8px; }
.mission-mode button[aria-pressed=true] { border-color:#ffb347; color:#ffb347; background:#33291e; }
.mission-mode button:hover, .mission-result button:hover { border-color:#ffb347; }
.mission-mode button:active, .mission-result button:active { transform:translateY(1px); }
.mission-mode button:focus-visible, .mission-result button:focus-visible { outline:2px solid #ffb347; outline-offset:3px; }
.mission-mode .mission-description { display:block; min-height:2.6em; margin-top:8px; color:#bcb8b0; font-size:11.5px; line-height:1.4; }
.mission-result { position:fixed; z-index:30; inset:0; display:flex; align-items:safe center; justify-content:center; padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); box-sizing:border-box; overflow-y:auto; color:#f3efe6; background:rgba(8,10,13,.72); backdrop-filter:blur(6px); }
.mission-result .mission-result-card { width:min(360px,100%); padding:26px; box-sizing:border-box; border:1px solid #675039; border-top:3px solid #ffb347; border-radius:10px; background:#191b20; box-shadow:0 20px 80px #0008; }
.mission-result .mission-kicker { color:#ffb347; font-size:11px; font-weight:700; letter-spacing:.1em; }
.mission-result h2 { margin:7px 0 10px; font-size:28px; }
.mission-result p { color:#c8c3ba; line-height:1.6; margin:0 0 20px; }
.mission-result .mission-result-actions { display:grid; gap:9px; }
.mission-result .mission-retry { background:#ffb347; color:#241607; border-color:#ffb347; }
.mission-result button:disabled { opacity:.6; cursor:wait; }
.mission-result .mission-error { margin:10px 0 0; color:#ff9a84; font-size:12px; }
body.touch .mission-objective { top:calc(env(safe-area-inset-top) + 64px); width:210px; }
@media (max-width:680px) and (orientation:portrait) { body.touch .mission-objective { top:calc(env(safe-area-inset-top) + 150px); width:210px; padding:10px 12px; } }
@media (max-height:420px) { .mission-objective { top:calc(env(safe-area-inset-top) + 64px); width:205px; } .mission-result .mission-result-card { padding:18px; } .mission-result h2 { font-size:24px; } }
@media (prefers-reduced-motion:reduce) { .mission-meter i { transition:none; } }
`;

/** Optional goal layer; does not alter simulation state or sandbox tools. */
export class DemolitionMission {
  private readonly state = new MissionState();
  private readonly options: MissionOptions;
  private readonly objective = document.createElement('aside');
  private readonly result = document.createElement('section');
  private chooser: HTMLElement | null = null;
  private scanElapsed = 0;
  private retrying = false;
  private active = false;

  constructor(options: MissionOptions) {
    this.options = options;
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    this.objective.className = 'mission-objective';
    this.objective.setAttribute('aria-label', '拆除挑战进度');
    this.objective.innerHTML = `<div class="mission-heading"><strong>限时拆除</strong><span class="mission-clock">90</span></div><div class="mission-count"><span>拆松 / 移除</span><span><b>0</b> / 1,800</span></div><div class="mission-meter"><i></i></div><div class="mission-status">进入场景后开始计时</div>`;
    this.result.className = 'mission-result';
    this.result.hidden = true;
    this.result.setAttribute('role', 'dialog');
    this.result.setAttribute('aria-modal', 'true');
    this.result.setAttribute('aria-labelledby', 'mission-result-title');
    this.result.innerHTML = `<div class="mission-result-card"><span class="mission-kicker">DEMOLITION / 拆除记录</span><h2 id="mission-result-title"></h2><p class="mission-summary"></p><div class="mission-result-actions"><button class="mission-retry">重建 · 再来一次</button><button class="mission-free">继续自由拆除</button></div><p class="mission-error" hidden></p></div>`;
    this.result.querySelector('.mission-retry')!.addEventListener('click', () => void this.retry());
    this.result.querySelector('.mission-free')!.addEventListener('click', () => {
      if (this.retrying) return;
      this.setMode('sandbox');
      this.options.onSandbox();
    });
    document.body.append(this.objective, this.result);
    this.paint();
  }

  mountMenu(menu: HTMLElement): void {
    this.chooser?.remove();
    this.chooser = document.createElement('div');
    this.chooser.className = 'mission-mode';
    this.chooser.innerHTML = `<div class="mission-mode-buttons" role="group" aria-label="游戏模式"><button data-mode="sandbox">自由拆除</button><button data-mode="challenge">90 秒挑战</button></div><small class="mission-description"></small>`;
    this.chooser.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => this.setMode(button.dataset.mode as MissionMode));
    });
    const buttons = menu.querySelector('.buttons');
    if (buttons) buttons.before(this.chooser);
    else (menu.querySelector('.card') ?? menu).append(this.chooser);
    this.paint();
  }

  reset(states: Uint8Array): void {
    this.state.reset(states);
    this.scanElapsed = 0;
    this.active = false;
    this.result.hidden = true;
    this.paint();
  }

  start(): void {
    const previous = this.state.snapshot.phase;
    this.state.start();
    this.paint();
    if (previous === 'ready' && this.state.snapshot.phase === 'running') this.options.onStart?.();
  }

  setMode(mode: MissionMode): void {
    const changed = this.state.snapshot.mode !== mode;
    this.state.setMode(mode);
    this.scanElapsed = 0;
    this.result.hidden = true;
    this.paint();
    if (changed) this.options.onModeChange?.(mode);
  }

  update(dt: number, active: boolean, states: Uint8Array): void {
    const previous = this.state.snapshot.phase;
    this.active = active;
    if (active && Number.isFinite(dt)) this.scanElapsed += Math.max(0, dt);
    const scan = this.scanElapsed >= 0.25;
    this.state.update(dt, active, states, scan);
    if (scan) this.scanElapsed = 0;
    this.paint();
    const next = this.state.snapshot.phase;
    if (previous === 'running' && (next === 'won' || next === 'lost')) {
      this.options.onFinish();
      this.showResult();
    }
  }

  get snapshot(): MissionSnapshot { return this.state.snapshot; }

  private paint(): void {
    const s = this.state.snapshot;
    this.objective.hidden = s.mode !== 'challenge' || s.phase === 'won' || s.phase === 'lost';
    this.objective.dataset.urgent = String(s.remaining <= 15 && s.phase === 'running');
    this.objective.querySelector('.mission-clock')!.textContent = String(Math.ceil(s.remaining));
    this.objective.querySelector('.mission-count b')!.textContent = s.count.toLocaleString('en-US');
    (this.objective.querySelector('.mission-meter i') as HTMLElement).style.transform = `scaleX(${s.progress})`;
    this.objective.querySelector('.mission-status')!.textContent = s.phase === 'ready' ? '进入场景后开始计时' : this.active ? (s.count >= s.target ? '目标达成 · 继续拆，冲更高分' : '每拆松一个方块 = 1 分') : '已暂停 · 返回场景继续';
    this.chooser?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === s.mode)));
    const description = this.chooser?.querySelector('.mission-description');
    if (description) description.textContent = s.mode === 'challenge' ? '完整 90 秒冲分，每拆松一个方块得 1 分。结算后上传最高分。' : '没有倒计时，随便逛、慢慢拆。想重来就按 R；本局积分不上榜。';
  }

  private showResult(): void {
    const s = this.state.snapshot;
    this.result.querySelector('h2')!.textContent = '本轮结束';
    this.result.querySelector('.mission-summary')!.textContent = `本轮 ${s.count.toLocaleString('en-US')} 分。${s.phase === 'won' ? '入门目标已达成！继续挑战，刷新自己的最高分。' : '试着炸掉底层支撑，让楼体自己往下落。'}`;
    this.result.querySelector('.mission-error')!.setAttribute('hidden', '');
    this.result.hidden = false;
    (this.result.querySelector('.mission-retry') as HTMLButtonElement).focus();
  }

  private async retry(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    const buttons = Array.from(this.result.querySelectorAll<HTMLButtonElement>('button'));
    buttons.forEach((button) => { button.disabled = true; });
    const retry = this.result.querySelector('.mission-retry')!;
    retry.textContent = '正在重建…';
    try {
      await this.options.onRetry();
      this.result.hidden = true;
    } catch {
      this.result.hidden = false;
      const error = this.result.querySelector('.mission-error') as HTMLElement;
      error.hidden = false;
      error.textContent = '重建没有完成，请再试一次。';
    } finally {
      this.retrying = false;
      retry.textContent = '重建 · 再来一次';
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
}
