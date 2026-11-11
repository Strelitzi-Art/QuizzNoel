import { useEffect, useRef } from "react";
import { resolveImage } from "./OptionalImage.jsx";

const COLORS = ["#f7dd9e", "#e2b864", "#ffffff", "#e5484d", "#c0182a", "#46a771", "#fff1c4", "#ff8fa3"];
const BURST_EVERY = 2300;   // ms entre deux salves
const MAX_PARTICLES = 420;

/**
 * Canons à confettis en bas de l'écran, en boucle. Les confettis montent, tournoient et retombent.
 * `image` : nom d'une image facultative (ex. "lepers-content") lancée avec les confettis, en plus gros.
 */
export default function Confetti({ image }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1;
    let parts = [];
    let raf = 0, last = performance.now(), nextBurst = 0, alive = true;
    let img = null;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Image facultative (Lepers / Nagui)
    if (image) {
      resolveImage(image).then((url) => {
        if (!url || !alive) return;
        const el = new Image();
        el.onload = () => { img = el; };
        el.src = url;
      });
    }

    const rand = (a, b) => a + Math.random() * (b - a);

    function shoot(x, angle, count, withImages) {
      // Vitesse calculée pour que les confettis montent jusqu'au haut de l'écran environ
      const power = Math.sqrt(2 * 0.32 * H) * 1.05;
      for (let i = 0; i < count && parts.length < MAX_PARTICLES; i++) {
        const a = angle + rand(-0.32, 0.32);
        const v = power * rand(0.55, 1.05);
        parts.push({
          kind: Math.random() < 0.25 ? "ribbon" : Math.random() < 0.5 ? "circle" : "rect",
          x, y: H + 10, vx: Math.cos(a) * v, vy: -Math.sin(a) * v,
          rot: rand(0, Math.PI * 2), vr: rand(-0.25, 0.25), flip: rand(0, Math.PI * 2), vflip: rand(0.08, 0.2),
          w: rand(7, 13), h: rand(10, 18), color: COLORS[(Math.random() * COLORS.length) | 0], drag: rand(0.985, 0.993),
        });
      }
      if (withImages && img) {
        const n = 1 + (Math.random() < 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = angle + rand(-0.2, 0.2);
          const v = power * rand(0.75, 1.0);
          const size = Math.min(140, Math.max(80, H * 0.13)) * rand(0.85, 1.15);
          parts.push({
            kind: "img", x, y: H + 60, vx: Math.cos(a) * v, vy: -Math.sin(a) * v,
            rot: rand(0, Math.PI * 2), vr: rand(-0.12, 0.12), flip: 0, vflip: rand(0.03, 0.06),
            w: size, h: size * (img.height / img.width || 1), drag: 0.992,
          });
        }
      }
    }

    function burst() {
      const n = reduced ? 25 : 70;
      shoot(W * 0.04, Math.PI * 0.36, n, true);        // canon en bas à gauche, vers le haut à droite
      shoot(W * 0.96, Math.PI * 0.64, n, true);        // canon en bas à droite, vers le haut à gauche
      if (!reduced && Math.random() < 0.6) shoot(W * rand(0.35, 0.65), Math.PI * 0.5, 35, Math.random() < 0.5); // petit tir central
    }

    function frame(now) {
      const dt = Math.min(2.5, (now - last) / 16.67); // 1 = une image à 60 i/s
      last = now;
      if (now >= nextBurst) { burst(); nextBurst = now + BURST_EVERY; }
      ctx.clearRect(0, 0, W, H);
      const g = 0.32 * dt;
      parts = parts.filter((p) => p.y < H + 200 && p.x > -200 && p.x < W + 200);
      for (const p of parts) {
        const falling = p.vy > 0;
        p.vy += g;
        p.vx *= Math.pow(p.drag, dt);
        p.vy *= Math.pow(p.drag, dt);
        // En retombant, les confettis freinent et ondulent comme du papier
        if (falling && p.kind !== "img") { p.vy = Math.min(p.vy, 3.2); p.vx += Math.sin(p.flip) * 0.12 * dt; }
        if (falling && p.kind === "img") p.vy = Math.min(p.vy, 4.2);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.flip += p.vflip * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.kind === "img") {
          ctx.scale(Math.cos(p.flip) * 0.25 + 0.75, 1); // léger effet de rotation en 3D
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 12;
          ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
        } else {
          ctx.scale(1, Math.cos(p.flip)); // le papier se retourne
          ctx.fillStyle = p.color;
          if (p.kind === "circle") { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
          else if (p.kind === "ribbon") ctx.fillRect(-p.w * 0.2, -p.h, p.w * 0.4, p.h * 2);
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [image]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
