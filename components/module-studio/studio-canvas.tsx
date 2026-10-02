"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import styles from "./studio.module.css";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Card = Point & Size;
export type StudioCanvasNode = { id: string; name: string; value?: string; icon: ReactNode };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function anchor(card: Card, target: Point) {
  const dx = target.x - card.x, dy = target.y - card.y;
  const horizontal = dx ? card.width / (2 * Math.abs(dx)) : Infinity;
  const vertical = dy ? card.height / (2 * Math.abs(dy)) : Infinity;
  const scale = Math.min(horizontal, vertical);
  const axis = horizontal < vertical && dx ? "x" : "y";
  const direction = Math.sign(axis === "x" ? dx : dy);
  return { x: card.x + dx * scale + (axis === "x" ? direction * 7 : 0),
    y: card.y + dy * scale + (axis === "y" ? direction * 7 : 0), axis, direction };
}

export function StudioCanvas({ nodes, activeId, coin, disabled, onSelect, onAdd }: {
  nodes: readonly StudioCanvasNode[]; activeId: string; coin: ReactNode; disabled?: boolean;
  onSelect: (id: string) => void; onAdd: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const [geometry, setGeometry] = useState<{ canvas: Size; cards: Record<string, Size> }>();
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [dragging, setDragging] = useState<string>();
  const drag = useRef<{ id: string; pointerId: number; start: Point; point: Point; moved: boolean } | null>(null);
  const suppressedClick = useRef<string | null>(null);
  const gradient = useId(), instructions = useId();
  const signature = JSON.stringify(nodes.map(node => node.id));

  useEffect(() => {
    const area = canvas.current;
    if (!area) return;
    let frame = 0;
    const measure = () => {
      const next = { canvas: { width: area.clientWidth, height: area.clientHeight },
        cards: Object.fromEntries([...elements.current].map(([id, element]) => [id, { width: element.offsetWidth, height: element.offsetHeight }])) };
      setGeometry(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(area);
    for (const element of elements.current.values()) observer?.observe(element);
    window.addEventListener("resize", schedule);
    schedule();
    return () => { observer?.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(frame); };
  }, [signature]);

  function card(id: string, index = 0): Card {
    const size = geometry?.cards[id] ?? { width: 0, height: 0 };
    const area = geometry?.canvas ?? { width: 0, height: 0 };
    const rows = Math.ceil(nodes.length / 2);
    const initial = id === "coin" ? { x: .5, y: .5 } : { x: index % 2 ? .8 : .2, y: .18 + Math.floor(index / 2) * (.64 / Math.max(1, rows - 1)) };
    const point = positions[id] ?? initial;
    return { ...size, x: clamp(point.x * area.width, size.width / 2 + 12, area.width - size.width / 2 - 12),
      y: clamp(point.y * area.height, size.height / 2 + 12, area.height - size.height / 2 - 12) };
  }

  function place(id: string, point: Point) {
    if (!geometry || disabled) return;
    const size = geometry.cards[id];
    if (!size || !geometry.canvas.width || !geometry.canvas.height) return;
    const next = { x: clamp(point.x, size.width / 2 + 12, geometry.canvas.width - size.width / 2 - 12) / geometry.canvas.width,
      y: clamp(point.y, size.height / 2 + 12, geometry.canvas.height - size.height / 2 - 12) / geometry.canvas.height };
    setPositions(current => ({ ...current, [id]: next }));
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    if (drag.current.moved) suppressedClick.current = drag.current.id;
    drag.current = null; setDragging(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handlers(id: string, index?: number) {
    return {
      ref: (element: HTMLButtonElement | null) => { if (element) elements.current.set(id, element); else elements.current.delete(id); },
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.button !== 0 || !event.isPrimary || !geometry) return;
        suppressedClick.current = null;
        drag.current = { id, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, point: card(id, index), moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
        if (!current.moved && Math.hypot(dx, dy) < 5) return;
        current.moved = true; setDragging(id);
        place(id, { x: current.point.x + dx, y: current.point.y + dy });
      },
      onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
      onClick: (event: { detail: number }) => {
        if (event.detail && suppressedClick.current === id) { suppressedClick.current = null; return; }
        onSelect(id);
      },
      onKeyDown: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta || disabled) return;
        event.preventDefault(); const current = card(id, index), step = event.shiftKey ? 40 : 12;
        place(id, { x: current.x + delta[0] * step, y: current.y + delta[1] * step });
      },
    };
  }

  const center = card("coin");
  const position = (id: string, index = 0) => geometry ? { left: card(id, index).x, top: card(id, index).y }
    : { left: id === "coin" ? "50%" : index % 2 ? "80%" : "20%", top: id === "coin" ? "50%" : `${18 + Math.floor(index / 2) * (64 / Math.max(1, Math.ceil(nodes.length / 2) - 1))}%` };
  return <div ref={canvas} className={styles.canvas} data-dragging={Boolean(dragging)}>
    <span id={instructions} className="sr-only">Drag to move. Arrow keys also move the card.</span>
    <button type="button" className={styles.canvasAdd} aria-label="Add module" onClick={onAdd} />
    {geometry?.canvas.width && geometry.canvas.height ? <svg className={styles.connections} viewBox={`0 0 ${geometry.canvas.width} ${geometry.canvas.height}`} aria-hidden="true">
      <defs><linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={geometry.canvas.width} y2={geometry.canvas.height}><stop stopColor="#b695fa" /><stop offset=".5" stopColor="#efd2ed" /><stop offset="1" stopColor="#ff929d" /></linearGradient></defs>
      {nodes.map((node, index) => {
        const target = card(node.id, index);
        if (!center.width || !target.width || Math.hypot(target.x - center.x, target.y - center.y) < 1) return null;
        if (Math.abs(target.x - center.x) < (center.width + target.width) / 2 + 14 && Math.abs(target.y - center.y) < (center.height + target.height) / 2 + 14) return null;
        const start = anchor(center, target), end = anchor(target, center), bend = Math.min(150, Math.hypot(end.x - start.x, end.y - start.y) * .38);
        const path = `M ${start.x} ${start.y} C ${start.x + (start.axis === "x" ? start.direction * bend : 0)} ${start.y + (start.axis === "y" ? start.direction * bend : 0)}, ${end.x + (end.axis === "x" ? end.direction * bend : 0)} ${end.y + (end.axis === "y" ? end.direction * bend : 0)}, ${end.x} ${end.y}`;
        return <g key={node.id} className={styles.connection} data-active={activeId === node.id}><path className={styles.connectionBase} d={path} stroke={`url(#${gradient})`} /><path className={styles.connectionPulse} d={path} pathLength={100} stroke={`url(#${gradient})`} style={{ animationDelay: `${-index * .9}s` }} /><circle className={styles.connectionPort} cx={start.x} cy={start.y} r={3} /><circle className={styles.connectionPort} cx={end.x} cy={end.y} r={3} /></g>;
      })}
    </svg> : null}
    {nodes.map((node, index) => <button {...handlers(node.id, index)} key={node.id} type="button" className={styles.flowNode} title={node.name} style={position(node.id, index)} data-dragging={dragging === node.id} aria-describedby={instructions} aria-pressed={activeId === node.id}><span className={styles.nodeIcon}>{node.icon}</span><span className={styles.nodeText}><strong>{node.name}</strong>{node.value ? <span className={styles.nodeValue}>{node.value}</span> : null}</span></button>)}
    <button {...handlers("coin")} type="button" className={styles.coinNode} style={position("coin")} data-dragging={dragging === "coin"} aria-label="Edit coin details" aria-describedby={instructions} aria-pressed={activeId === "coin"}>{coin}</button>
  </div>;
}
