// Übersicht desktop widget: lists agents and their status; a click focuses the agent's window.
// Install: copy the "claude-agents.widget" folder into
//   ~/Library/Application Support/Übersicht/widgets/
import { css, run } from "uebersicht";

const API = "http://127.0.0.1:4317";
export const command = `curl -s --max-time 1 ${API}/api/agents`;
export const refreshFrequency = 2000;

// Position on the desktop (top / right).
export const className = `
  top: 40px;
  right: 24px;
  width: 300px;
  font-family: -apple-system, "SF Pro Text", sans-serif;
  color: #ECEEF2;
`;

const box = css`
  background: rgba(16, 17, 21, 0.78);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
`;
const head = css`
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; font-weight: 600; color: #8B90A0; padding: 2px 6px 8px;
  text-transform: uppercase; letter-spacing: 0.06em;
`;
const row = css`
  display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 9px; cursor: pointer;
  font-size: 13px;
  &:hover { background: rgba(255, 255, 255, 0.07); }
`;
const name = css`flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;`;
const label = css`font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;`;
const slot = css`font: 600 11px Menlo, monospace; color: #8B90A0; width: 14px; text-align: right;`;

const focus = (id) =>
  run(`curl -s -X POST -H 'Content-Type: application/json' ${API}/api/agents/${id}/focus`);

const ago = (since) => {
  const m = Math.floor((Date.now() - since) / 60000);
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
};
const approvalBox = css`
  margin: 0 0 8px; padding: 6px 4px; border-radius: 10px;
  background: rgba(245, 165, 36, 0.12); border: 1px solid rgba(245, 165, 36, 0.45);
`;
const detail = css`font: 11px Menlo, monospace; color: #C9CCD6; padding: 0 8px 4px 31px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

export const render = ({ output }) => {
  let data;
  try { data = JSON.parse(output); } catch (e) {
    return <div className={box}><div className={head}>Claude agents</div><div style={{ padding: 8, color: "#8B90A0", fontSize: 12 }}>Service offline</div></div>;
  }
  const approvals = data.approvals || [];
  const others = data.agents.filter((a) => a.status !== "waiting");
  const awake = data.keepAwake && data.keepAwake.active;
  return (
    <div className={box}>
      <div className={head}>
        <span>Claude agents{awake ? " ☕" : ""}</span>
        <span style={{ color: approvals.length ? "#F5A524" : "#8B90A0" }}>
          {approvals.length ? `${approvals.length} need approval` : `${data.agents.length} running`}
        </span>
      </div>
      {approvals.length > 0 && (
        <div className={approvalBox}>
          {approvals.map((a) => (
            <div key={a.id} onClick={() => focus(a.id)} style={{ cursor: "pointer" }} title={a.detail}>
              <div className={row}>
                <span className={slot}>{a.slot}</span>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: "#F5A524", flex: "none" }} />
                <span className={name}>{a.project}</span>
                <span className={label} style={{ color: "#F5A524" }}>{ago(a.since)}</span>
              </div>
              <div className={detail}>{a.detail}</div>
            </div>
          ))}
        </div>
      )}
      {data.agents.length === 0 && <div style={{ padding: 8, color: "#8B90A0", fontSize: 12 }}>No agents</div>}
      {others.map((a) => (
        <div key={a.id} className={row} onClick={() => focus(a.id)} title={a.detail}>
          <span className={slot}>{a.slot}</span>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: a.color, flex: "none" }} />
          <span className={name}>{a.project}</span>
          <span className={label} style={{ color: a.color }}>{a.label}</span>
        </div>
      ))}
    </div>
  );
};
