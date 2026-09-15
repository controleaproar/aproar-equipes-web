"use client";

import { useEffect, useState } from "react";
import AproarSystem from "./AproarSystem";

export default function AproarSystemFixed() {
  const [hasSession, setHasSession] = useState(false);

  function logoutNow() {
    sessionStorage.removeItem("aproar_session");
    setHasSession(false);
    window.location.replace("/");
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("aproar_session");
    setHasSession(Boolean(saved));

    const handleClick = (event) => {
      const button = event.target?.closest?.("button");
      if (!button) return;
      const label = String(button.textContent || "").trim().toLowerCase();

      if (label === "bloquear edição" || label === "sair" || label === "sair do setor") {
        event.preventDefault();
        event.stopPropagation();
        sessionStorage.removeItem("aproar_session");
        setHasSession(false);
        window.location.replace("/");
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return (
    <>
      {hasSession && (
        <button
          type="button"
          onClick={logoutNow}
          style={{
            position: "fixed",
            top: 14,
            right: 18,
            zIndex: 9999,
            border: "1px solid #d7dee8",
            background: "#ffffff",
            color: "#24364d",
            borderRadius: 8,
            padding: "8px 14px",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(15,23,42,.08)",
          }}
        >
          Sair
        </button>
      )}
      <AproarSystem />
    </>
  );
}
