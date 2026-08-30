"use client";

import { useState } from "react";

const STORAGE_KEY = "ai-word-radar-refresh-token";

export default function RefreshButton() {
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    let token = "";
    try {
      token = window.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      // localStorage unavailable (private mode etc.) — fall back to prompting every time
    }

    if (!token) {
      token = window.prompt("输入采集口令：") || "";
      if (!token) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, token);
      } catch {
        // ignore — just means we'll prompt again next time
      }
    }

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setStatus("done");
        setMessage("已触发采集，几分钟后数据会更新，请稍后刷新页面查看。");
      } else if (res.status === 401) {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
        setStatus("error");
        setMessage("口令不正确，请重新点击后输入。");
      } else if (res.status === 429) {
        const minutes = Math.ceil((data.retryAfterSeconds || 60) / 60);
        setStatus("error");
        setMessage(`刚刚已经采集过了，请 ${minutes} 分钟后再试。`);
      } else {
        setStatus("error");
        setMessage("触发失败，请稍后重试。");
      }
    } catch {
      setStatus("error");
      setMessage("网络错误，请稍后重试。");
    }
  }

  return (
    <div className="refresh-trigger">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className="refresh-button"
      >
        {status === "loading" ? "正在触发…" : "一键重新采集今日信息"}
      </button>
      {message && (
        <p className={status === "error" ? "refresh-message is-error" : "refresh-message"}>
          {message}
        </p>
      )}
    </div>
  );
}
