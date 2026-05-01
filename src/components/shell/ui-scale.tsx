"use client";

import { useEffect } from "react";

export function UiScale() {
  useEffect(() => {
    function applyScale() {
      const h = window.innerHeight;
      let scale = 100;
      if (h >= 1800) {
        scale = 130;
      } else if (h >= 1200) {
        scale = 120;
      }
      document.documentElement.style.fontSize = `${scale}%`;
    }

    applyScale();
    window.addEventListener("resize", applyScale);
    return () => window.removeEventListener("resize", applyScale);
  }, []);

  return null;
}
