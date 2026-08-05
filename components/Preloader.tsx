"use client";

import { useEffect, useRef, useState } from "react";
import anime from "animejs";
import { useI18n } from "../hooks/useI18n";

interface PreloaderProps {
  onComplete?: () => void;
}

// SVG Path Morphing Coordinate Definitions from LanRhyme/Web-Personal
const outerShapes = {
  A: "M 100,20 C 145,20 180,55 180,100 C 180,145 145,180 100,180 C 55,180 20,145 20,100 C 20,55 55,20 100,20 Z",
  B: "M 100,45 C 160,10 195,65 190,110 C 185,155 120,195 100,165 C 80,135 10,135 15,90 C 20,45 40,80 100,45 Z",
  C: "M 100,10 C 120,50 190,40 170,95 C 150,150 185,190 95,190 C 5,190 35,120 30,105 C 25,90 80,10 100,10 Z",
};

const middleShapes = {
  A: "M 100,45 C 130,45 155,70 155,100 C 155,130 130,155 100,155 C 70,155 45,130 45,100 C 45,70 70,45 100,45 Z",
  B: "M 100,60 C 145,35 170,80 160,115 C 150,150 115,165 95,145 C 75,125 30,120 35,85 C 40,50 55,85 100,60 Z",
  C: "M 100,35 C 115,65 165,55 150,95 C 135,135 160,165 105,160 C 50,155 55,115 50,105 C 45,95 85,35 100,35 Z",
};

const innerShapes = {
  A: "M 100,70 C 116.5,70 130,83.5 130,100 C 130,116.5 116.5,130 100,130 C 83.5,130 70,116.5 70,100 C 70,83.5 83.5,70 100,70 Z",
  B: "M 100,80 C 125,65 140,90 135,110 C 130,130 110,138 98,125 C 86,112 55,110 58,90 C 61,70 75,95 100,80 Z",
  C: "M 100,65 C 110,80 138,75 130,97 C 122,119 135,138 103,135 C 71,132 75,110 72,103 C 69,96 90,65 100,65 Z",
};

export function Preloader({ onComplete }: PreloaderProps) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const [closing, setClosing] = useState(false);
  const [hidden, setHidden] = useState(false);

  const outerGroupRef = useRef<SVGGElement>(null);
  const outerPathRef = useRef<SVGPathElement>(null);
  const middlePathRef = useRef<SVGPathElement>(null);
  const innerPathRef = useRef<SVGPathElement>(null);

  const [sidebarReady, setSidebarReady] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [fileReady, setFileReady] = useState(false);
  const panelsReadyRef = useRef(false);
  panelsReadyRef.current = sidebarReady && chatReady && fileReady;

  useEffect(() => {
    const handleSidebar = () => setSidebarReady(true);
    const handleChat = () => setChatReady(true);
    const handleFile = () => setFileReady(true);
    
    window.addEventListener("pi-sidebar-ready", handleSidebar);
    window.addEventListener("pi-chat-ready", handleChat);
    window.addEventListener("pi-file-ready", handleFile);
    
    const fallbackTimer = setTimeout(() => {
      setSidebarReady(true);
      setChatReady(true);
      setFileReady(true);
    }, 8000); // 8s fallback

    return () => {
      window.removeEventListener("pi-sidebar-ready", handleSidebar);
      window.removeEventListener("pi-chat-ready", handleChat);
      window.removeEventListener("pi-file-ready", handleFile);
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    const morphDuration = 1200;

    // 1. Setup path morph loops using animejs
    const setupMorph = (
      pathEl: SVGPathElement | null,
      shapes: { A: string; B: string; C: string },
      delay = 0
    ) => {
      if (!pathEl) return;
      return anime({
        targets: pathEl,
        d: [
          { value: shapes.B, duration: morphDuration, easing: "easeInOutQuad" },
          { value: shapes.C, duration: morphDuration, easing: "easeInOutQuad" },
          { value: shapes.A, duration: morphDuration, easing: "easeInOutQuad" },
        ],
        loop: true,
        direction: "alternate",
        delay,
      });
    };

    const anim1 = setupMorph(outerPathRef.current, outerShapes, 0);
    const anim2 = setupMorph(middlePathRef.current, middleShapes, 100);
    const anim3 = setupMorph(innerPathRef.current, innerShapes, 200);

    // 2. Setup rotation parallax
    let animRotate: anime.AnimeInstance | undefined;
    if (outerGroupRef.current) {
      animRotate = anime({
        targets: outerGroupRef.current,
        rotate: 360,
        duration: 15000,
        easing: "linear",
        loop: true,
      });
    }

    // 3. Setup progress count-up
    let start: number | null = null;
    const duration = 500; // ms

    let reqId: number;
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const pct = Math.min(100, Math.floor((elapsed / duration) * 100));
      setProgress(pct);

      if (pct < 100 || !panelsReadyRef.current) {
        reqId = requestAnimationFrame(step);
      } else {
        setClosing(true);
        setTimeout(() => {
          setHidden(true);
          onComplete?.();
        }, 500);
      }
    };

    reqId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(reqId);
      anim1?.pause();
      anim2?.pause();
      anim3?.pause();
      animRotate?.pause();
    };
  }, [onComplete]);

  if (hidden) return null;

  const progressText = `${progress.toString().padStart(3, "0")}%`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text)",
        opacity: closing ? 0 : 1,
        transform: closing ? "scale(1.04)" : "scale(1)",
        filter: closing ? "blur(8px)" : "blur(0)",
        transition:
          "opacity 450ms cubic-bezier(0.05, 0.7, 0.1, 1), transform 500ms cubic-bezier(0.05, 0.7, 0.1, 1), filter 450ms ease",
        pointerEvents: closing ? "none" : "auto",
        userSelect: "none",
      }}
    >
      {/* anime.js Organic Morphing SVG Geometry (Matching Web-Personal) */}
      <div style={{ position: "relative", width: 160, height: 160, marginBottom: 20 }}>
        <svg
          width="160"
          height="160"
          viewBox="0 0 200 200"
          fill="none"
          style={{ overflow: "visible" }}
        >
          <g ref={outerGroupRef} style={{ transformOrigin: "100px 100px" }}>
            <path
              ref={outerPathRef}
              d={outerShapes.A}
              stroke="var(--text)"
              strokeWidth="1.5"
              fill="none"
              opacity="0.85"
            />
            <path
              ref={middlePathRef}
              d={middleShapes.A}
              stroke="var(--text)"
              strokeWidth="1.2"
              strokeDasharray="4 4"
              fill="none"
              opacity="0.6"
            />
            <path
              ref={innerPathRef}
              d={innerShapes.A}
              stroke="var(--text)"
              strokeWidth="1.8"
              fill="none"
              opacity="0.95"
            />
          </g>
        </svg>

        {/* Centered Percentage Display inside Morphing Ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--text)",
          }}
        >
          {progressText}
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: 140,
          height: 2,
          background: "var(--border)",
          borderRadius: 1,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "var(--text)",
            borderRadius: 1,
            transition: "width 50ms linear",
          }}
        />
      </div>

      {/* Brutalist Subtitle */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "var(--text-dim)",
          textTransform: "uppercase",
        }}
      >
        Pi NeoStudio Agent System // Organic Preload
      </div>
    </div>
  );
}
