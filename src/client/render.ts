// Draws the table scene each frame.
import { PAL } from './palette';
import { drawText, textWidth } from './font';
import { cardFace, cardBack, avatar, drawChips, drawTowers, towersWidth, LAMP, DEALER, CROWN } from './sprites';
import { settings } from './settings';
import { FELTS } from './table';
import { Scene, W, H, CENTER, POT, DECK, fmt, towerPos, type CardObj, type P, type Bubble } from './scene';

function label(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, c: number) {
  const w = textWidth(str);
  drawText(ctx, str, Math.max(w / 2 + 1, Math.min(W - w / 2 - 1, x)), y, c, 'c', 1, 0);
}

function drawCard(sc: Scene, ctx: CanvasRenderingContext2D, o: CardObj) {
  if (o.a <= 0.01) return;
  const face = o.face && o.c >= 0, mini = !face && o.s < 0.8;
  const img = face ? cardFace(o.c, settings.fourColor, sc.s?.rules.wild === 'deuces', settings.cardFace) : cardBack(o.b, mini);
  const k = mini ? o.s / 0.6 : o.s;
  ctx.save();
  ctx.globalAlpha = o.a;
  ctx.translate(o.x, o.y + o.lift);
  ctx.rotate(o.rot);
  ctx.scale(o.sx * k, k);
  if (o.glow > 0) {
    ctx.globalAlpha = o.a * (0.55 + 0.45 * Math.sin(sc.t * 10));
    ctx.fillStyle = PAL[10];
    ctx.fillRect(-img.width / 2 - 1, -img.height / 2 - 1, img.width + 2, img.height + 2);
    ctx.globalAlpha = o.a;
  }
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

function drawSeat(sc: Scene, ctx: CanvasRenderingContext2D, i: number) {
  const s = sc.s!, sv = s.seats[i];
  if (!sv) return;
  const p = sc.seatPos(i), f = sc.fx[i], h = s.hand, hp = h?.seats[i];
  const live = !!h && !h.done;
  const active = live && h!.toAct === i;
  if (active) {
    const r = 12 + Math.sin(sc.t * 8) * 1.2;
    ctx.fillStyle = PAL[Math.sin(sc.t * 8) > 0 ? 10 : 9];
    for (let a = 0; a < 28; a++) {
      const an = (a / 28) * Math.PI * 2;
      ctx.fillRect(Math.round(p.x + Math.cos(an) * r), Math.round(p.y + Math.sin(an) * r), 1, 1);
    }
  }
  const tw = towersWidth(f.stack.n), tp = towerPos(sc, i, tw);
  drawTowers(ctx, tp.x, tp.y, f.stack.n);
  ctx.globalAlpha = (live && (!hp || f.folded)) || !sv.connected ? 0.45 : 1;
  ctx.drawImage(avatar(sv.avatar, f.blink < 0), p.x - 8, p.y - 8);
  ctx.globalAlpha = 1;
  if (sc.boss === i && sc.crown.a > 0) {
    ctx.globalAlpha = sc.crown.a;
    ctx.drawImage(CROWN, Math.round(p.x - 4), Math.round(p.y - 15 + sc.crown.y + Math.sin(sc.t * 3)));
    ctx.globalAlpha = 1;
  }
  label(ctx, sv.name.slice(0, 8), p.x, p.y + 10, i === s.seat ? 10 : 7);
  label(ctx, fmt(f.stack.n), p.x, p.y + 16, 11);
  if (!sv.connected) drawText(ctx, 'ZZ', p.x + 5, p.y - 13 + Math.sin(sc.t * 3) * 1.5, 12, 'l', 1, 0);
  if (active && s.timerMs) {
    const fr = Math.max(0, Math.min(1, (sc.recvAt + s.timeLeft - performance.now()) / s.timerMs));
    ctx.fillStyle = PAL[1];
    ctx.fillRect(p.x - 11, p.y + 23, 22, 2);
    ctx.fillStyle = PAL[fr > 0.5 ? 11 : fr > 0.25 ? 10 : 8];
    ctx.fillRect(p.x - 11, p.y + 23, Math.round(22 * fr), 2);
  }
  if (h && h.dealer === i && !s.floor) {
    const d = sc.dir(i);
    ctx.drawImage(DEALER, Math.round(p.x + d.x * 16 - d.y * 14 - 3), Math.round(p.y + d.y * 16 + d.x * 14 - 3));
  }
}

/** Floor Deal: live tags for the offer, counters, skips and beaten players. */
function drawFloorTags(sc: Scene, ctx: CanvasRenderingContext2D) {
  const f = sc.s?.floor;
  if (!f || f.done || sc.dim.v > 0.1) return;
  f.seats.forEach((p, i) => {
    if (!p) return;
    const b = sc.betPos(i);
    let t = '', c = 7;
    if (p.status === 'skip') { t = 'SKIP'; c = 6; }
    else if (p.status === 'beaten') { t = 'BEATEN'; c = 8; }
    else if (p.resp === 'locked') { t = 'LOCKED +' + fmt(p.want); c = 11; }
    else if (p.resp === 'counter' && f.phase === 'decide') { t = 'WANTS ' + fmt(p.want); c = 8; }
    else if (f.offer && f.phase !== 'offer') {
      const o = f.offer.find((x) => x.seat === i);
      if (o) { t = i === f.boss ? 'KEEPS ' + fmt(o.amount) : '+' + fmt(o.amount); c = i === f.boss ? 10 : 11; }
    }
    if (!t) return;
    const w = textWidth(t) + 4, x = Math.round(Math.max(1, Math.min(W - w - 1, b.x - w / 2))), y = Math.round(b.y + 4);
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x, y, w, 8);
    drawText(ctx, t, x + 2, y + 2, c);
  });
}

function drawBubble(ctx: CanvasRenderingContext2D, p: P, b: Bubble) {
  const w = textWidth(b.text) + 6, h = 9;
  ctx.save();
  ctx.globalAlpha = Math.min(1, b.life / 0.25);
  ctx.translate(Math.round(Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, p.x))), Math.round(p.y - 12));
  ctx.scale(b.s, b.s);
  const x = -Math.round(w / 2), y = -h;
  ctx.fillStyle = PAL[0];
  ctx.fillRect(x - 1, y, w + 2, h); ctx.fillRect(x, y - 1, w, h + 2); ctx.fillRect(-2, 0, 5, 2); ctx.fillRect(0, 2, 1, 1);
  ctx.fillStyle = PAL[7];
  ctx.fillRect(x, y, w, h); ctx.fillRect(-1, 0, 3, 1); ctx.fillRect(0, 1, 1, 1);
  drawText(ctx, b.text, 0, y + 2, b.c, 'c');
  ctx.restore();
}

export function drawScene(sc: Scene, ctx: CanvasRenderingContext2D) {
  ctx.save();
  if (sc.shake > 0 && !settings.reduced) ctx.translate(Math.round((Math.random() - 0.5) * sc.shake), Math.round((Math.random() - 0.5) * sc.shake));
  ctx.drawImage(sc.bg, 0, 0);
  const g = ctx.createLinearGradient(0, 8, 0, 210);
  g.addColorStop(0, `rgba(255,236,39,${0.16 * sc.lamp + 0.25 * sc.house.a})`);
  g.addColorStop(1, 'rgba(255,236,39,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(91, 8); ctx.lineTo(104, 8); ctx.lineTo(190, 210); ctx.lineTo(5, 210); ctx.fill();
  ctx.drawImage(LAMP, 91, 0);
  const s = sc.s;
  if (!s) { ctx.restore(); return; }
  if (s.hand) { const bk = cardBack(0, true); ctx.drawImage(bk, DECK.x - 4, DECK.y - 5); ctx.drawImage(bk, DECK.x - 5, DECK.y - 7); }
  if (sc.pot.n > 0) {
    drawTowers(ctx, POT.x - 7, POT.y + 6, sc.pot.n, 4, 12);
    drawText(ctx, (s.floor ? 'FLOOR ' : 'POT ') + fmt(sc.pot.n), 97, 113, 10, 'c', 1, 0);
  }
  if (s.floor && s.rules.goal) drawText(ctx, 'FIRST TO ' + fmt(s.rules.goal) + ' WINS', 97, 236, FELTS[settings.felt]?.c[1] ?? 17, 'c');
  sc.fx.forEach((f, i) => {
    if (f.bet.n <= 0 || !s.seats[i]) return;
    const b = sc.betPos(i);
    drawChips(ctx, b.x, b.y + f.bounce, f.bet.n);
    drawText(ctx, fmt(f.bet.n), b.x + 5, b.y - 3, 7, 'l', 1, 0);
  });
  drawFloorTags(sc, ctx);
  for (let i = 0; i < 8; i++) drawSeat(sc, ctx, i);
  sc.hole.forEach((arr, i) => { if (i !== sc.me) arr.forEach((o) => drawCard(sc, ctx, o)); });
  sc.boards.flat().forEach((o) => drawCard(sc, ctx, o));
  if (sc.me >= 0) sc.hole[sc.me].forEach((o) => drawCard(sc, ctx, o));
  sc.loose.forEach((o) => drawCard(sc, ctx, o));
  for (const fl of sc.flyers) { const p = sc.flyerPos(fl); drawChips(ctx, p.x, p.y, fl.amt, 4); }
  sc.px.draw(ctx);
  if (sc.dim.v > 0.01) {
    const v = ctx.createRadialGradient(97, 190, 20, 97, 190, 240);
    v.addColorStop(0, `rgba(0,0,0,${0.3 * sc.dim.v})`);
    v.addColorStop(1, `rgba(0,0,0,${0.85 * sc.dim.v})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    [...sc.hole.flat(), ...sc.boards.flat(), ...sc.loose].filter((o) => o.glow > 0).forEach((o) => drawCard(sc, ctx, o));
  }
  sc.fx.forEach((f, i) => { if (f.bubble && s.seats[i]) drawBubble(ctx, sc.seatPos(i), f.bubble); });
  if (sc.banner) {
    const b = sc.banner;
    ctx.globalAlpha = Math.min(1, b.life / 0.3);
    ctx.fillStyle = PAL[0];
    ctx.fillRect(0, CENTER.y - 52, W, 16 * b.s);
    drawText(ctx, b.text, 97, CENTER.y - 49, b.c, 'c', Math.min(2, (2 * W - 8) / (textWidth(b.text) * 2)) * b.s, 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
