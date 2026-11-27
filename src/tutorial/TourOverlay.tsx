import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoards } from '../boardStore';
import { useStore } from '../store';
import { useTour } from './tourStore';
import { tourById, type StepContext } from './tours';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;
const MARGIN = 12;

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function findTarget(name: string | undefined): HTMLElement | null {
  if (!name) return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  // The first one that is actually on screen (some panes are hidden on a phone).
  return all.find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0) ?? null;
}

/** Where the card goes: next to the highlight if there is room, otherwise over it; docked on a phone. */
function placeCard(hole: Box | null, card: { w: number; h: number }, vw: number, vh: number): { left: number; top: number; width: number } {
  if (vw < 700) {
    const width = vw - MARGIN * 2;
    const lowHole = hole && hole.top + hole.height / 2 > vh * 0.55;
    return { left: MARGIN, width, top: lowHole ? MARGIN + 56 : vh - card.h - MARGIN };
  }
  const width = card.w;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - width - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - card.h - MARGIN, y));
  if (!hole) return { left: (vw - width) / 2, top: Math.max(MARGIN, (vh - card.h) / 2), width };
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const options = [
    { fits: hole.top + hole.height + GAP + card.h < vh - MARGIN, left: clampX(cx - width / 2), top: hole.top + hole.height + GAP },
    { fits: hole.left + hole.width + GAP + width < vw - MARGIN, left: hole.left + hole.width + GAP, top: clampY(cy - card.h / 2) },
    { fits: hole.left - GAP - width > MARGIN, left: hole.left - GAP - width, top: clampY(cy - card.h / 2) },
    { fits: hole.top - GAP - card.h > MARGIN, left: clampX(cx - width / 2), top: hole.top - GAP - card.h },
  ];
  const ok = options.find((o) => o.fits);
  if (ok) return { left: ok.left, top: ok.top, width };
  // A big target (the pitch): sit inside it, in the bottom corner.
  return { left: clampX(hole.left + hole.width - width - GAP), top: clampY(hole.top + hole.height - card.h - GAP), width };
}

export function TourOverlay() {
  const { active, goTo, end } = useTour();
  // Re-render when the app changes, so hands-on tasks are noticed as soon as they're done.
  useStore();
  useBoards();
  const tour = tourById(active?.tourId);
  const index = active?.index ?? 0;
  const step = tour?.steps[index];
  const ctx = useRef<StepContext>({});
  const runId = useRef<string | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const [hole, setHole] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [ready, setReady] = useState(false);

  // A new run of a tour starts with a clean slate.
  if (active && runId.current !== active.tourId) {
    runId.current = active.tourId;
    ctx.current = {};
  }
  if (!active) runId.current = undefined;

  // Prepare the screen for this step, then point at its target.
  useEffect(() => {
    if (!step) return;
    setReady(false);
    step.before?.(ctx.current);
    if (step.mobile) useStore.getState().setMobileView(step.mobile);
    const t = setTimeout(() => {
      (findTarget(step.target) ?? findTarget(step.fallback))?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      setReady(true);
    }, 60);
    return () => clearTimeout(t);
  }, [active?.tourId, index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the target as the layout moves (tab switches, scrolling, resizing).
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const tick = () => {
      const el = findTarget(step.target) ?? findTarget(step.fallback);
      const r = el?.getBoundingClientRect();
      const box = r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
      setHole((prev) => (sameBox(prev, box) ? prev : box));
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = Math.min(380, window.innerWidth - MARGIN * 2);
    const h = el.offsetHeight;
    setCardSize((c) => (c.w === w && c.h === h ? c : { w, h }));
  });

  const last = !!tour && index === tour.steps.length - 1;
  const next = () => (last ? end(true) : goTo(index + 1));
  const back = () => index > 0 && goTo(index - 1);
  const done = !!step?.task && ready && step.task.done(ctx.current);

  // A finished task moves the tour on by itself.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(next, 1100);
    return () => clearTimeout(t);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // During a hands-on task the keyboard belongs to the app (Esc finishes a run, etc.).
    if (!active || step?.task) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else if (e.key === 'Escape') end(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture: the tour's keys win over the app's shortcuts while it runs.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!tour || !step) return null;
  const pos = placeCard(hole, cardSize, view.w, view.h);
  const paragraphs = step.body.split('\n\n');
  // Dim everything except the highlighted area. During a hands-on task the whole app
  // stays usable (e.g. pick Run in the toolbar, then click on the pitch), so the dimming
  // is lighter and lets clicks through.
  const hands = !!step.task;
  const dim = hands ? 'rgba(5, 10, 15, 0.38)' : 'rgba(5, 10, 15, 0.62)';
  const panes = hole
    ? [
        { left: 0, top: 0, width: view.w, height: Math.max(0, hole.top) },
        { left: 0, top: hole.top + hole.height, width: view.w, height: Math.max(0, view.h - hole.top - hole.height) },
        { left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height },
        { left: hole.left + hole.width, top: hole.top, width: Math.max(0, view.w - hole.left - hole.width), height: hole.height },
      ]
    : [{ left: 0, top: 0, width: view.w, height: view.h }];

  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {panes.map((p, i) => (
        <div key={i} className="tour-dim" style={{ ...p, background: dim, pointerEvents: hands ? 'none' : 'auto' }} />
      ))}
      {hole && <div className="tour-ring" style={hole} />}
      <div ref={cardRef} className="tour-card" style={{ left: pos.left, top: pos.top, width: pos.width }}>
        <div className="tour-meta">
          <span>{tour.title}</span>
          <span>{index + 1} / {tour.steps.length}</span>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        {step.task && (
          <div className={`tour-task ${done ? 'done' : ''}`}>
            <span className="dot" aria-hidden>{done ? '✓' : ''}</span>
            <span><b>{done ? 'Nice!' : 'Your turn:'}</b> {step.task.hint}</span>
          </div>
        )}
        <div className="tour-foot">
          <button className="ghost" onClick={() => end(false)}>{last ? 'Close' : 'End tour'}</button>
          <span style={{ flex: 1 }} />
          {index > 0 && <button onClick={back}>Back</button>}
          <button className="primary" onClick={next}>{last ? 'Finish' : step.task && !done ? 'Skip' : 'Next'}</button>
        </div>
        <div className="tour-progress" aria-hidden><span style={{ width: `${((index + 1) / tour.steps.length) * 100}%` }} /></div>
      </div>
    </div>,
    document.body,
  );
}
