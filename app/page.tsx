// @ts-nocheck
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const CHAR_UUID = "abcdef01-1234-5678-1234-56789abcdef0";

const STATUS = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
};

export default function BellController() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [statusMsg, setStatusMsg] = useState("Not connected");
  const [alarms, setAlarms] = useState([]);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [inputError, setInputError] = useState("");
  const [log, setLog] = useState([]);
  const [bleSupported, setBleSupported] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  const deviceRef = useRef(null);
  const charRef = useRef(null);
  const gattServerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (!navigator.bluetooth) {
      setBleSupported(false);
      setStatusMsg("Web Bluetooth not supported in this browser. Use Chrome on desktop/Android.");
    }
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const addLog = useCallback((msg, type = "info") => {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-49), { msg, type, time }]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 50);
  }, []);

  const parseNotification = useCallback((value) => {
    const text = new TextDecoder().decode(value).trim();
    addLog(`← RX: ${text}`, "Received");

    if (text.startsWith("ADD ")) {
      const t = text.slice(4).trim();
      if (/^\d{2}:\d{2}$/.test(t)) {
        setAlarms((prev) => prev.includes(t) ? prev : [...prev, t].sort());
      }
    } else if (text.startsWith("DEL ")) {
      const t = text.slice(4).trim();
      setAlarms((prev) => prev.filter((a) => a !== t));
    } else if (text.includes(",") || /^\d{2}:\d{2}$/.test(text)) {
      const list = text.split(",").map((s) => s.trim()).filter((s) => /^\d{2}:\d{2}$/.test(s));
      setAlarms([...new Set(list)].sort());
    }
  }, [addLog]);

  const handleDisconnect = useCallback(() => {
    addLog("Device disconnected", "warn");
    setStatus(STATUS.DISCONNECTED);
    setStatusMsg("Disconnected");
    charRef.current = null;
    gattServerRef.current = null;

    // Auto reconnect
    if (deviceRef.current) {
      setReconnecting(true);
      addLog("Attempting reconnect in 3s...", "warn");
      reconnectTimerRef.current = setTimeout(async () => {
        try {
          addLog("Reconnecting...", "info");
          setStatus(STATUS.CONNECTING);
          setStatusMsg("Reconnecting...");
          const server = await deviceRef.current.gatt.connect();
          await new Promise(r => setTimeout(r, 300));
          gattServerRef.current = server;
          const service = await server.getPrimaryService(SERVICE_UUID);
          const char = await service.getCharacteristic(CHAR_UUID);
          charRef.current = char;
          if (char.properties.notify) {
            await char.startNotifications();
            char.addEventListener("characteristicvaluechanged", (e) =>
              parseNotification(e.target.value)
            );
            addLog("Notifications started", "success");
          } else {
            addLog("Notify not supported on this characteristic", "warn");
          }
        setStatus(STATUS.CONNECTED);
          setStatusMsg(`Connected — ${deviceRef.current.name || "Bell System"}`);
          setReconnecting(false);
          addLog("Reconnected successfully", "success");
        } catch (err) {
          addLog(`Reconnect failed: ${err.message}`, "error");
          setStatus(STATUS.ERROR);
          setStatusMsg("Reconnect failed");
          setReconnecting(false);
        }
      }, 3000);
    }
  }, [addLog, parseNotification]);

  const connect = async () => {
    if (!navigator.bluetooth) return;
    try {
      setStatus(STATUS.CONNECTING);
      setStatusMsg("Requesting device...");
      addLog("Scanning for Bell System...", "info");

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnect);

      setStatusMsg("Connecting to Bell System...");
      addLog(`Found device: ${device.name || device.id}`, "success");

      const server = await device.gatt.connect();
      await new Promise(r => setTimeout(r, 300));
      gattServerRef.current = server;
      addLog("Device connected", "success");

      const service = await server.getPrimaryService(SERVICE_UUID);
      const char = await service.getCharacteristic(CHAR_UUID);

      charRef.current = char;
      addLog("Characteristic acquired", "success");
      const value = await char.readValue();
      const decoder = new TextDecoder();
      const data = decoder.decode(value).trim();

      addLog(`Initial data: ${data}`, "info");

      if (data) {
        const list = data.split(",").map(t => t.trim());
        setAlarms(list);
      }

      setStatus(STATUS.CONNECTED);
      setStatusMsg(`Connected — ${device.name || "Bell System"}`);
    } catch (err) {
      if (err.name === "NotFoundError") {
        addLog("No device selected", "warn");
        setStatus(STATUS.IDLE);
        setStatusMsg("No device selected");
      } else {
        addLog(`Connection error: ${err.message}`, "error");
        setStatus(STATUS.ERROR);
        setStatusMsg(`Error: ${err.message}`);
      }
    }
  };

  const disconnect = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    setReconnecting(false);
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    deviceRef.current = null;
    charRef.current = null;
    gattServerRef.current = null;
    setAlarms([]);
    setStatus(STATUS.IDLE);
    setStatusMsg("Disconnected by user");
    addLog("Disconnected by user", "warn");
  };

  const sendBLE = async (data) => {
  if (!charRef.current) {
    addLog("Not connected", "error");
    return false;
  }

  try {
    const encoded = new TextEncoder().encode(data);

    await new Promise(r => setTimeout(r, 100));

    console.log("Characteristic properties:", charRef.current.properties);

    if (charRef.current.properties.writeWithoutResponse) {
      await charRef.current.writeValueWithoutResponse(encoded);
    } else if (charRef.current.properties.write) {
      await charRef.current.writeValue(encoded);
    } else {
      throw new Error("Characteristic does not support writing");
    }

    addLog(`→ TX: ${data}`, "Sent");
    return true;

  } catch (err) {
    addLog(`Send error: ${err.message}`, "error");
    return false;
  }
};

  const validateTime = () => {
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    if (isNaN(h) || isNaN(m)) return "Enter valid numbers";
    if (h < 0 || h > 23) return "Hours must be 0–23";
    if (m < 0 || m > 59) return "Minutes must be 0–59";
    return null;
  };

  const sendTime = async () => {
    setInputError("");
    const err = validateTime();
    if (err) { setInputError(err); return; }
    const h = String(parseInt(hours, 10)).padStart(2, "0");
    const m = String(parseInt(minutes, 10)).padStart(2, "0");
    const timeStr = `${h}:${m}`;
    const ok = await sendBLE(timeStr);
    if (ok) {
      setAlarms((prev) => prev.includes(timeStr) ? prev : [...prev, timeStr].sort());
      setHours("");
      setMinutes("");
    }
  };

  const deleteAlarm = async (alarm) => {
    const ok = await sendBLE(`DEL ${alarm}`);
    if (ok) setAlarms((prev) => prev.filter((a) => a !== alarm));
  };

  const isConnected = status === STATUS.CONNECTED;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #0a0c0f;
          min-height: 100vh;
          font-family: 'Barlow', sans-serif;
          color: #c8d0db;
          overflow-x: hidden;
        }

        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 16px 80px;
          background:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,160,0,0.07) 0%, transparent 70%),
            repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.02) 40px),
            repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.02) 40px);
        }

        .header {
          text-align: center;
          margin-bottom: 36px;
        }

        .header-eyebrow {
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          letter-spacing: 4px;
          color: #ffa000;
          text-transform: uppercase;
          margin-bottom: 10px;
          opacity: 0.8;
        }

        .header h1 {
          font-size: clamp(28px, 5vw, 44px);
          font-weight: 700;
          letter-spacing: -0.5px;
          color: #f0f4fa;
          line-height: 1.1;
        }

        .header h1 span { color: #ffa000; }

        .header-sub {
          font-size: 13px;
          color: #5a6475;
          margin-top: 8px;
          font-family: 'Share Tech Mono', monospace;
          letter-spacing: 1px;
        }

        .main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          width: 100%;
          max-width: 820px;
        }

        @media (max-width: 600px) {
          .main-grid { grid-template-columns: 1fr; }
        }

        .card {
          background: #11141a;
          border: 1px solid #1e2530;
          border-radius: 12px;
          padding: 22px 24px;
          position: relative;
          overflow: hidden;
        }

        .card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #ffa000, transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .card:hover::before { opacity: 0.6; }

        .card-full { grid-column: 1 / -1; }

        .card-label {
          font-family: 'Share Tech Mono', monospace;
          font-size: 10px;
          letter-spacing: 3px;
          color: #ffa000;
          text-transform: uppercase;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .card-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, #ffa00030, transparent);
        }

        /* Status */
        .status-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .status-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 0.3s, box-shadow 0.3s;
        }

        .status-dot.idle      { background: #3a4050; }
        .status-dot.connecting{ background: #ffa000; box-shadow: 0 0 8px #ffa000; animation: pulse 1s infinite; }
        .status-dot.connected { background: #00c87a; box-shadow: 0 0 8px #00c87a; }
        .status-dot.disconnected { background: #ff4455; }
        .status-dot.error     { background: #ff4455; }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .status-text {
          font-family: 'Share Tech Mono', monospace;
          font-size: 13px;
          color: #8a9bb0;
        }

        .status-text.connected { color: #00c87a; }
        .status-text.error     { color: #ff4455; }

        .ble-unsupported {
          background: #1a0f0f;
          border: 1px solid #ff445540;
          border-radius: 8px;
          padding: 14px 16px;
          font-size: 13px;
          color: #ff7080;
          font-family: 'Share Tech Mono', monospace;
          margin-bottom: 16px;
          line-height: 1.6;
        }

        /* Buttons */
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 7px;
          font-family: 'Barlow', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.5px;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
          user-select: none;
          white-space: nowrap;
        }

        .btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .btn-connect {
          background: linear-gradient(135deg, #ffa000, #ff6f00);
          color: #0a0c0f;
          width: 100%;
          padding: 12px;
          font-size: 14px;
        }
        .btn-connect:hover:not(:disabled) {
          background: linear-gradient(135deg, #ffb020, #ff8010);
          transform: translateY(-1px);
          box-shadow: 0 4px 20px rgba(255,160,0,0.3);
        }

        .btn-disconnect {
          background: transparent;
          color: #ff4455;
          border: 1px solid #ff445540;
          width: 100%;
          padding: 10px;
          font-size: 13px;
        }
        .btn-disconnect:hover:not(:disabled) {
          background: #ff445510;
          border-color: #ff4455;
        }

        .btn-send {
          background: linear-gradient(135deg, #0077ff, #0050cc);
          color: #fff;
          width: 100%;
          padding: 11px;
          margin-top: 10px;
        }
        .btn-send:hover:not(:disabled) {
          background: linear-gradient(135deg, #1188ff, #0060dd);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(0,120,255,0.3);
        }

        .btn-delete {
          background: transparent;
          color: #ff4455;
          border: 1px solid #ff445530;
          padding: 5px 12px;
          font-size: 12px;
          border-radius: 5px;
        }
        .btn-delete:hover:not(:disabled) {
          background: #ff445515;
          border-color: #ff4455;
        }

        /* Inputs */
        .time-inputs {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .input-wrap { position: relative; }

        .input-wrap label {
          display: block;
          font-family: 'Share Tech Mono', monospace;
          font-size: 10px;
          letter-spacing: 2px;
          color: #5a6475;
          margin-bottom: 5px;
          text-transform: uppercase;
        }

        .time-sep {
          font-size: 24px;
          color: #ffa000;
          font-weight: 700;
          text-align: center;
          margin-top: 18px;
          line-height: 1;
        }

        input[type="number"] {
          width: 100%;
          background: #0d1017;
          border: 1px solid #1e2530;
          border-radius: 7px;
          color: #f0f4fa;
          font-family: 'Share Tech Mono', monospace;
          font-size: 28px;
          padding: 10px 12px;
          text-align: center;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          -moz-appearance: textfield;
        }

        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; }

        input[type="number"]:focus {
          border-color: #ffa000;
          box-shadow: 0 0 0 3px rgba(255,160,0,0.1);
        }

        input[type="number"].error-field { border-color: #ff4455; }

        .input-error {
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          color: #ff4455;
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        /* Alarm list */
        .alarm-list { display: flex; flex-direction: column; gap: 8px; }

        .alarm-empty {
          font-family: 'Share Tech Mono', monospace;
          font-size: 12px;
          color: #2e3545;
          text-align: center;
          padding: 24px;
          border: 1px dashed #1e2530;
          border-radius: 8px;
          letter-spacing: 1px;
        }

        .alarm-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #0d1017;
          border: 1px solid #1e2530;
          border-radius: 8px;
          padding: 12px 14px;
          transition: border-color 0.2s;
          animation: slideIn 0.25s ease;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .alarm-item:hover { border-color: #2e3a48; }

        .alarm-time {
          font-family: 'Share Tech Mono', monospace;
          font-size: 22px;
          color: #f0f4fa;
          letter-spacing: 2px;
        }

        .alarm-index {
          font-family: 'Share Tech Mono', monospace;
          font-size: 10px;
          color: #3a4555;
          margin-right: 12px;
        }

        .alarm-left { display: flex; align-items: center; }

        /* Log */
        .log-box {
          background: #080b10;
          border: 1px solid #141920;
          border-radius: 8px;
          padding: 12px;
          height: 180px;
          overflow-y: auto;
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          line-height: 1.8;
          scrollbar-width: thin;
          scrollbar-color: #1e2530 transparent;
        }

        .log-box::-webkit-scrollbar { width: 4px; }
        .log-box::-webkit-scrollbar-track { background: transparent; }
        .log-box::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 4px; }

        .log-line { display: flex; gap: 10px; }
        .log-time { color: #2e3a50; flex-shrink: 0; }
        .log-line.info  .log-msg { color: #5a7090; }
        .log-line.success .log-msg { color: #00c87a; }
        .log-line.warn  .log-msg { color: #ffa000; }
        .log-line.error .log-msg { color: #ff4455; }
        .log-line.tx    .log-msg { color: #0099ff; }
        .log-line.rx    .log-msg { color: #cc88ff; }

        .alarm-count-badge {
          background: #ffa000;
          color: #0a0c0f;
          font-family: 'Share Tech Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 20px;
          margin-left: 8px;
        }

        .reconnect-notice {
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          color: #ffa000;
          text-align: center;
          padding: 8px;
          border: 1px solid #ffa00030;
          border-radius: 6px;
          margin-top: 10px;
          animation: pulse 1s infinite;
        }
      `}</style>

      <div className="app">
        <div className="header">
          <div className="header-eyebrow">ESP32 BELL SYSTEM</div>
          <h1>Bell <span>System</span></h1>
          <div className="header-sub">Web Bluetooth Interface</div>
        </div>

        {!bleSupported && (
          <div style={{ maxWidth: 820, width: "100%", marginBottom: 16 }}>
            <div className="ble-unsupported">
              ⚠ {statusMsg}
            </div>
          </div>
        )}

        <div className="main-grid">

          {/* Connection Card */}
          <div className="card">
            <div className="card-label">Connection</div>
            <div className="status-row">
              <div className={`status-dot ${status}`} />
              <div className={`status-text ${status === STATUS.CONNECTED ? "connected" : status === STATUS.ERROR ? "error" : ""}`}>
                {statusMsg}
              </div>
            </div>

            {!isConnected ? (
              <button
                className="btn btn-connect"
                onClick={connect}
                disabled={!bleSupported || status === STATUS.CONNECTING}
              >
                {status === STATUS.CONNECTING ? "Connecting..." : "Connect to Bell System"}
              </button>
            ) : (
              <button className="btn btn-disconnect" onClick={disconnect}>
                Disconnect
              </button>
            )}

            {reconnecting && (
              <div className="reconnect-notice">⟳ Auto-reconnecting...</div>
            )}
          </div>

          {/* Add Alarm Card */}
          <div className="card">
            <div className="card-label">Add Bell Time</div>
            <div className="time-inputs">
              <div className="input-wrap">
                <label>Hours</label>
                <input
                  type="number"
                  min={0} max={23}
                  placeholder="08"
                  value={hours}
                  onChange={(e) => { setHours(e.target.value); setInputError(""); }}
                  className={inputError ? "error-field" : ""}
                  disabled={!isConnected}
                />
              </div>
              <div className="time-sep">:</div>
              <div className="input-wrap">
                <label>Minutes</label>
                <input
                  type="number"
                  min={0} max={59}
                  placeholder="30"
                  value={minutes}
                  onChange={(e) => { setMinutes(e.target.value); setInputError(""); }}
                  className={inputError ? "error-field" : ""}
                  disabled={!isConnected}
                />
              </div>
            </div>
            {inputError && (
              <div className="input-error">⚠ {inputError}</div>
            )}
            <button
              className="btn btn-send"
              onClick={sendTime}
              disabled={!isConnected}
            >
              Send Time
            </button>
          </div>

          {/* Alarm List */}
          <div className="card card-full">
            <div className="card-label">
              Scheduled Bells
              {alarms.length > 0 && (
                <span className="alarm-count-badge">{alarms.length}</span>
              )}
            </div>
            <div className="alarm-list">
              {alarms.length === 0 ? (
                <div className="alarm-empty">NO BELLS SCHEDULED</div>
              ) : (
                alarms.map((alarm, i) => (
                  <div className="alarm-item" key={alarm}>
                    <div className="alarm-left">
                      <span className="alarm-index">#{String(i + 1).padStart(2, "0")}</span>
                      <span className="alarm-time">{alarm}</span>
                    </div>
                    <button
                      className="btn btn-delete"
                      onClick={() => deleteAlarm(alarm)}
                      disabled={!isConnected}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log */}
          <div className="card card-full">
            <div className="card-label">Activity Log</div>
            <div className="log-box" ref={logRef}>
              {log.length === 0 ? (
                <span style={{ color: "#2e3545" }}>— awaiting activity —</span>
              ) : (
                log.map((l, i) => (
                  <div className={`log-line ${l.type}`} key={i}>
                    <span className="log-time">{l.time}</span>
                    <span className="log-msg">{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
