"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./studio.module.css";
import { skyAt, skyMask } from "./sky-mask";

type Star = { x: number; y: number };

/** Sample the actual cover crop on resize, so stars never land on flowers. */
export function StudioAtmosphere() {
  const layer = useRef<HTMLDivElement>(null);
  const [stars, setStars] = useState<Star[]>([]);
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    let image: HTMLImageElement | undefined, pixels: ImageData | undefined, mask: Uint8Array | undefined, source = "", frame = 0;
    let active = true;
    const sample = () => {
      if (!active || !image || !pixels || !mask) return;
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const points: Star[] = [];
      for (let index = 0; index < 600 && points.length < 40; index++) {
        const x = 2 + (index * 37.37) % 96, y = 2 + (index * 61.61) % 94;
        if (skyAt(mask, pixels, { width, height }, { x: x * width / 100, y: y * height / 100 })
          && points.every(point => Math.hypot((point.x - x) * width / 100, (point.y - y) * height / 100) > 24)) points.push({ x, y });
      }
      setStars(points);
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = window.matchMedia("(max-width: 520px)").matches ? "/brand/atmosphere/programmable-floral-foreground-mobile-v1.avif" : "/brand/atmosphere/programmable-floral-foreground-v1.avif";
        if (next === source) { sample(); return; }
        source = next; pixels = undefined; mask = undefined; setStars([]);
        const loading = new window.Image(); image = loading;
        loading.onload = () => {
          if (!active || image !== loading) return;
          const canvas = document.createElement("canvas");
          canvas.width = 480; canvas.height = Math.round(480 * loading.naturalHeight / loading.naturalWidth);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(loading, 0, 0, canvas.width, canvas.height);
          pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          mask = skyMask(pixels);
          sample();
        };
        loading.src = next;
      });
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={layer} className={styles.stars} aria-hidden="true">{stars.map((star, index) => <i key={`${star.x}:${star.y}`} style={{ left: `${star.x}%`, top: `${star.y}%`, width: index % 4 === 0 ? 2 : 1, height: index % 4 === 0 ? 2 : 1, animationDuration: `${3.2 + (index * 29 % 23) / 10}s`, animationDelay: `${-(index * 17 % 101) / 10}s` }} />)}</div>;
}
