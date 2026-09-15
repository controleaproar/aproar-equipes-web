"use client";

import { useEffect } from "react";
import AproarSystem from "./AproarSystem";

export default function AproarSystemFixed() {
  useEffect(() => {
    const handleClick = (event) => {
      const button = event.target?.closest?.("button");
      if (!button) return;
      const label = String(button.textContent || "").trim().toLowerCase();

      if (label === "bloquear edição" || label === "sair") {
        event.preventDefault();
        event.stopPropagation();
        sessionStorage.removeItem("aproar_session");
        window.location.replace("/");
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return <AproarSystem />;
}
