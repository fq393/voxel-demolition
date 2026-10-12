import './player-board.css';

interface Profile { playerId: string; name: string; accepted: boolean }
interface PrivateProfile extends Profile { playerToken: string }
interface Entry { playerId: string; name: string; score: number; count: number; updatedAt: string | number }
interface BoardResponse { entries: Entry[]; personal: Entry | null; rank: number | null }
interface FinishResponse extends BoardResponse { score: number; bestScore: number }
interface Round { runId: string; playerId: string; count?: number; submitting: boolean; error?: string }
interface Options { onPause: () => void }
const STORAGE = 'demolition.player.v1';
const PREFIXES = ['暴躁', '快乐', '摸鱼', '深夜', '路过的', '不加班的', '慢悠悠的', '脆皮'];
const NAMES = ['小锤子', '拆楼队长', '砖头侠', '爆破熊', '工地猫', '推土鸭', '火箭虾', '水泥企鹅'];
function randomName(): string { return PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + NAMES[Math.floor(Math.random() * NAMES.length)] + String(Math.floor(Math.random() * 90) + 10); }
function normalName(value: string): string { return value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().replace(/\s+/gu, ' '); }
function validName(value: string): boolean { const length = Array.from(value).length; return length >= 1 && length <= 16 && /^[\p{Script=Han}a-zA-Z0-9 _-]+$/u.test(value); }
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const h = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
}
function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const element = node('button', `pb-button ${className}`, text); element.type = 'button'; element.addEventListener('click', action); return element;
}
function number(value: number): string { return Math.max(0, Math.floor(value)).toLocaleString('zh-CN'); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : '连接失败，请稍后重试。'; }

/** Player-facing identity and shared records. All ranking data comes from the server. */
export class PlayerBoard {
  private readonly options: Options;
  private readonly identity: PrivateProfile;
  private readonly hud = node('aside', 'pb-score');
  private readonly overlay = node('section', 'pb-overlay');
  private readonly dialog = node('div', 'pb-dialog');
  private menuBlock: HTMLElement | null = null;
  private boardBody: HTMLElement | null = null;
  private boardStatus: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private modal: 'name' | 'board' | null = null;
  private board: BoardResponse | null = null;
  private round: Round | null = null;
  private starting: Promise<void> | null = null;
  private pending: Round[] = [];
  private epoch = 0;
  private boardRequest = 0;
  private liveScore = 0;
  private ranked = false;
  private networkMessage = '';
  private bestScore: number | null = null;
  private rank: number | null = null;
  private resultBlock: HTMLElement | null = null;
  private finishedCount: number | null = null;
  private savingName = false;
  private nameSyncError = '';

  constructor(options: Options) {
    this.options = options;
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); } catch { /* Private modes can disable storage. */ }
    const candidate = saved as Partial<PrivateProfile> | null;
    const savedName = typeof candidate?.name === 'string' ? normalName(candidate.name) : '';
    this.identity = {
      playerId: typeof candidate?.playerId === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(candidate.playerId) ? candidate.playerId : uuid(),
      playerToken: typeof candidate?.playerToken === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(candidate.playerToken) ? candidate.playerToken : uuid(),
      name: validName(savedName) ? savedName : randomName(),
      accepted: candidate?.accepted === true && validName(savedName),
    };
    this.persist();
    this.hud.setAttribute('aria-label', '本局拆除积分');
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', 'pb-dialog-title'); this.dialog.tabIndex = -1;
    this.overlay.append(this.dialog);
    this.overlay.addEventListener('click', (event) => { event.stopPropagation(); if (event.target === this.overlay) this.close(); });
    for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel']) this.overlay.addEventListener(kind, (event) => event.stopPropagation());
    document.addEventListener('keydown', (event) => this.modalKey(event), true);
    document.addEventListener('keyup', (event) => { if (this.modal) event.stopImmediatePropagation(); }, true);
    document.body.append(this.hud, this.overlay); this.paintHUD();
  }

  get profile(): Readonly<Profile> { return { playerId: this.identity.playerId, name: this.identity.name, accepted: this.identity.accepted }; }
  get state(): object { return { profile: this.profile, liveScore: this.liveScore, ranked: this.ranked, bestScore: this.bestScore, rank: this.rank, modal: this.modal, runId: this.round?.runId ?? null, pending: this.pending.map((r) => ({ runId: r.runId, count: r.count, error: r.error, submitting: r.submitting })), networkMessage: this.networkMessage }; }

  mountMenu(menu: HTMLElement): void {
    this.menuBlock?.remove(); this.menuBlock = node('section', 'pb-player');
    const anchor = menu.querySelector('.mission-mode') ?? menu.querySelector('.buttons');
    if (anchor) anchor.before(this.menuBlock); else (menu.querySelector('.card') ?? menu).append(this.menuBlock);
    this.paintMenu(); void this.loadBoard();
  }

  ensureProfile(continuation: () => void): boolean {
    if (this.identity.accepted) return true;
    this.openName(continuation); return false;
  }

  /** One start request per round. Reset invalidates in-flight starts. */
  beginRun(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.round) return Promise.resolve();
    const epoch = this.epoch;
    this.networkMessage = '正在连接排行榜…'; this.paintHUD();
    this.starting = (async () => {
      try {
        const data = await this.request<{ runId: string; minimumMs: number }>({ action: 'start', playerId: this.identity.playerId, playerToken: this.identity.playerToken, name: this.identity.name });
        if (epoch !== this.epoch) return;
        if (typeof data.runId !== 'string' || !data.runId) throw new Error('排行榜服务暂时不可用。');
        this.round = { runId: data.runId, playerId: this.identity.playerId, submitting: false };
        this.networkMessage = '本局计入排行榜'; this.nameSyncError = ''; this.paintMenu();
      } catch (error) {
        if (epoch === this.epoch) { this.networkMessage = `本局未联网：${errorText(error)}`; throw error; }
      } finally {
        if (epoch === this.epoch) { this.starting = null; this.paintHUD(); this.paintMenu(); }
      }
    })();
    return this.starting;
  }

  async finishRun(count: number): Promise<void> {
    const epoch = this.epoch;
    const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    this.finishedCount = safeCount;
    this.resultBlock?.remove(); this.resultBlock = null;
    this.showResultStatus('正在保存成绩…');
    if (this.starting) { try { await this.starting; } catch { /* Failed starts leave this round unranked. */ } }
    if (epoch !== this.epoch) return;
    const round = this.round;
    if (!round) { this.showResultStatus('本局未连接排行榜，成绩没有上传。'); return; }
    if (round.count === undefined) round.count = safeCount;
    if (!this.pending.includes(round)) this.pending.push(round);
    await this.submitRound(round);
  }

  resetRound(): void {
    this.epoch++; this.round = null; this.starting = null; this.liveScore = 0; this.ranked = false;
    this.finishedCount = null; this.networkMessage = ''; this.resultBlock?.remove(); this.resultBlock = null;
    this.paintHUD(); this.paintMenu();
  }

  updateScore(count: number, ranked: boolean): void {
    const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    if (this.liveScore === safe && this.ranked === ranked) return;
    this.liveScore = safe; this.ranked = ranked; this.paintHUD();
  }

  private persist(): void { try { localStorage.setItem(STORAGE, JSON.stringify(this.identity)); } catch { /* Keep the identity for this page session. */ } }

  private paintHUD(): void {
    this.hud.replaceChildren(node('span', 'pb-score-label', this.ranked ? '本局积分' : '自由拆除'));
    const points = node('div', 'pb-score-number', number(this.liveScore)); points.append(node('small', '', '分')); this.hud.append(points);
    this.hud.append(node('span', 'pb-score-caption', this.ranked ? (this.networkMessage || '1 方块 = 1 分') : '练手 · 不入榜'));
    this.hud.title = this.networkMessage;
  }

  private paintMenu(): void {
    if (!this.menuBlock) return;
    const top = node('div', 'pb-player-top');
    const who = node('div', 'pb-player-who'); who.append(node('small', 'pb-kicker', '拆楼队员'), node('strong', 'pb-player-name', this.identity.name));
    top.append(who, button('改名字', () => this.openName(), 'pb-button-quiet'));
    const bottom = node('div', 'pb-player-bottom');
    bottom.append(node('span', 'pb-personal-best', this.bestScore === null ? (this.board ? '最高分 · 尚无上榜记录' : '最高分 · 等待同步') : `最高分 ${number(this.bestScore)}${this.rank ? ` · 第 ${this.rank} 名` : ''}`), button('排行榜 ↗', () => this.openBoard()));
    this.menuBlock.replaceChildren(top, bottom);
    this.menuBlock.append(node('small', 'pb-rule', '90 秒挑战入榜，每个首次拆松的方块记 1 分。'));
    if (this.nameSyncError) this.menuBlock.append(node('p', 'pb-error', this.nameSyncError));
    if (this.pending.length) {
      const retry = node('div', 'pb-pending'); retry.append(node('span', '', `${this.pending.length} 局成绩尚未上传`), button('重试上传', () => void this.retryPending())); this.menuBlock.append(retry);
    }
  }

  private open(kind: 'name' | 'board'): void {
    this.options.onPause();
    if (!this.modal) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modal = kind; this.overlay.hidden = false; this.dialog.classList.remove('pb-board-dialog'); this.dialog.replaceChildren();
  }

  private openName(continuation?: () => void): void {
    if (this.savingName) return;
    const wasAccepted = this.identity.accepted;
    this.open('name');
    const heading = this.header('今天谁来拆楼？');
    const text = node('p', 'pb-intro', '取个名字就能开工。挑战结束后，看看你能排第几。');
    const form = node('form', 'pb-name-form');
    const label = node('label', 'pb-input-label', '你的昵称'); label.htmlFor = 'pb-name-input';
    const input = node('input', 'pb-name-input'); input.id = 'pb-name-input'; input.type = 'text'; input.value = this.identity.name; input.maxLength = 32; input.setAttribute('autocomplete', 'nickname'); input.required = true;
    const tools = node('div', 'pb-name-tools');
    tools.append(node('small', 'pb-muted', '1–16 个字，不用注册'), button('↻ 换一个', () => { input.value = randomName(); input.focus(); }, 'pb-button-quiet'));
    const error = node('p', 'pb-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const submit = node('button', 'pb-button pb-primary', continuation ? '就叫这个 · 开始拆楼' : '保存昵称'); submit.type = 'submit';
    form.append(label, input, tools, error, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.savingName) return;
      const name = normalName(input.value);
      if (!validName(name)) { error.hidden = false; error.textContent = '用 1–16 个中文、字母、数字、空格、下划线或短横线。'; input.focus(); return; }
      this.identity.name = name; this.identity.accepted = true; this.persist(); this.paintMenu();
      if (!wasAccepted) { this.close(); continuation?.(); return; }
      this.savingName = true; error.hidden = true; submit.textContent = '正在同步昵称…';
      const controls = [...this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('button, input')];
      controls.forEach((control) => { control.disabled = true; });
      void (async () => {
        try {
          await this.request<BoardResponse>({ action: 'rename', playerId: this.identity.playerId, playerToken: this.identity.playerToken, name });
          this.nameSyncError = ''; this.boardRequest++; void this.loadBoard();
          this.savingName = false; this.close(); continuation?.();
        } catch (failure) {
          this.nameSyncError = `昵称已保存在本机，排行榜未同步：${errorText(failure)}`;
          error.hidden = false; error.textContent = this.nameSyncError; submit.textContent = '重试同步昵称';
        } finally {
          this.savingName = false; controls.forEach((control) => { control.disabled = false; }); this.paintMenu();
        }
      })();
    });
    this.dialog.append(heading, text, form); input.focus(); input.select();
  }

  private header(title: string): HTMLElement {
    const row = node('div', 'pb-dialog-heading'); const heading = node('h2', '', title); heading.id = 'pb-dialog-title';
    row.append(heading, button('关闭', () => this.close(), 'pb-close')); return row;
  }

  private close(): void {
    if (this.savingName) return;
    this.modal = null; this.overlay.hidden = true; this.boardBody = null; this.boardStatus = null;
    if (this.returnFocus?.isConnected && !this.returnFocus.closest('[hidden]')) this.returnFocus.focus();
    this.returnFocus = null;
  }

  private modalKey(event: KeyboardEvent): void {
    if (!this.modal) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')).filter((n) => !n.hidden);
    const first = items[0], last = items.at(-1);
    if (!first || !last) { event.preventDefault(); this.dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private openBoard(): void {
    this.open('board'); this.dialog.classList.add('pb-board-dialog');
    const intro = node('p', 'pb-intro', '90 秒拆除挑战 · 按每位队员最高分排列');
    const toolbar = node('div', 'pb-board-tools'); this.boardStatus = node('span', 'pb-muted', '正在读取排行…'); this.boardStatus.setAttribute('aria-live', 'polite');
    toolbar.append(this.boardStatus, button('刷新', () => void this.loadBoard()));
    this.boardBody = node('div', 'pb-board-body');
    this.dialog.append(this.header('拆楼排行榜'), intro, toolbar, this.boardBody);
    this.dialog.querySelector<HTMLButtonElement>('.pb-close')?.focus();
    if (this.board) this.paintBoard(); void this.loadBoard();
  }

  private async loadBoard(): Promise<void> {
    const sequence = ++this.boardRequest;
    if (this.boardStatus) { this.boardStatus.textContent = '正在读取排行…'; this.boardStatus.className = 'pb-muted'; }
    try {
      const data = await this.request<BoardResponse>();
      if (sequence !== this.boardRequest) return;
      if (!Array.isArray(data.entries)) throw new Error('排行榜数据暂时不可用。');
      this.rememberBoard(data);
      if (this.modal === 'board') { this.paintBoard(); if (this.boardStatus) this.boardStatus.textContent = '已更新'; }
    } catch (error) {
      if (sequence !== this.boardRequest) return;
      if (this.boardStatus) { this.boardStatus.textContent = errorText(error); this.boardStatus.className = 'pb-error'; }
      if (!this.board && this.boardBody) this.boardBody.replaceChildren(node('p', 'pb-empty', '暂时读不到排行榜，点「刷新」再试。'));
    }
  }

  private rememberBoard(data: BoardResponse): void {
    this.board = data; this.bestScore = typeof data.personal?.score === 'number' ? data.personal.score : null;
    this.rank = typeof data.rank === 'number' ? data.rank : null; this.paintMenu();
  }

  private paintBoard(): void {
    if (!this.boardBody || !this.board) return;
    this.boardBody.replaceChildren();
    if (this.board.personal) this.boardBody.append(node('div', 'pb-own-rank', `你的最高分 ${number(this.board.personal.score)}${this.rank ? ` · 第 ${this.rank} 名` : ''}`));
    if (!this.board.entries.length) { this.boardBody.append(node('p', 'pb-empty', '还没人上榜。去完成一局 90 秒挑战，拿下第一块砖。')); return; }
    const list = node('ol', 'pb-ranking');
    this.board.entries.forEach((entry, i) => {
      const row = node('li', 'pb-ranking-row'); if (entry.playerId === this.identity.playerId) row.classList.add('pb-is-you');
      const name = node('span', 'pb-ranking-name', entry.name); if (entry.playerId === this.identity.playerId) name.append(node('small', 'pb-you', '你'));
      row.append(node('span', 'pb-rank-number', String(i + 1).padStart(2, '0')), name, node('strong', 'pb-ranking-points', `${number(entry.score)} 分`)); list.append(row);
    });
    this.boardBody.append(list);
  }

  private async submitRound(round: Round): Promise<void> {
    if (round.submitting || round.count === undefined) return;
    round.submitting = true; round.error = undefined; this.paintMenu();
    if (this.round === round) this.showResultStatus('正在保存成绩…');
    try {
      const data = await this.request<FinishResponse>({ action: 'finish', runId: round.runId, playerId: round.playerId, count: round.count });
      this.pending = this.pending.filter((r) => r !== round); this.boardRequest++;
      // Finish receipts are immutable: a retried old round must not overwrite a newer best.
      if (this.round === round) { this.networkMessage = '成绩已保存'; this.showResultStatus(`本局 ${number(data.score)} 分 · 成绩已保存`, true); }
      await this.loadBoard();
    } catch (error) {
      round.error = errorText(error);
      if (this.round === round) { this.networkMessage = '成绩尚未上传'; this.showResultStatus(`成绩尚未上传：${round.error}`, false, round); }
    } finally { round.submitting = false; this.paintHUD(); this.paintMenu(); }
  }

  private async retryPending(): Promise<void> {
    for (const round of [...this.pending]) await this.submitRound(round);
  }

  private showResultStatus(message: string, success = false, retry?: Round): void {
    // Mission creates its result synchronously before finishRun's first request resolves.
    const card = document.querySelector<HTMLElement>('.mission-result-card');
    if (!card) return;
    if (!this.resultBlock || !this.resultBlock.isConnected) {
      this.resultBlock = node('section', 'pb-result-save'); this.resultBlock.setAttribute('aria-live', 'polite');
      const anchor = card.querySelector('.mission-result-actions'); if (anchor) anchor.before(this.resultBlock); else card.append(this.resultBlock);
    }
    this.resultBlock.replaceChildren(node('strong', '', `${number(this.finishedCount ?? this.liveScore)} 分`), node('p', success ? 'pb-save-success' : 'pb-save-message', message));
    if (retry) this.resultBlock.append(button('重试上传', () => void this.submitRound(retry)));
    if (success) this.resultBlock.append(button('看看排行榜', () => this.openBoard(), 'pb-button-quiet'));
  }

  private async request<T>(body?: object): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(body ? '/api/leaderboard' : `/api/leaderboard?playerId=${encodeURIComponent(this.identity.playerId)}`, {
        method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store',
      });
      let data: unknown;
      try { data = await response.json(); } catch { throw new Error('排行榜服务暂时不可用，请稍后重试。'); }
      if (!response.ok) {
        const reason = (data as { error?: unknown })?.error;
        throw new Error(typeof reason === 'string' && reason.length < 200 ? reason : '排行榜连接失败，请稍后重试。');
      }
      return data as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('连接超时，请稍后重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
