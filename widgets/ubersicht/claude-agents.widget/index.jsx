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

export const render = ({ output }) => {
  let data;
  try { data = JSON.parse(output); } catch (e) {
    return <div className={box}><div className={head}>Claude agents</div><div style={{ padding: 8, color: "#8B90A0", fontSize: 12 }}>Daemon offline</div></div>;
  }
  const agents = data.agents.filter((a) => a.status !== "ended");
  const alerts = (data.counts.waiting || 0) + (data.counts.retry || 0);
  return (
    <div className={box}>
      <div className={head}>
        <span>Claude agents</span>
        <span style={{ color: alerts ? "#F5A524" : "#8B90A0" }}>{alerts ? `${alerts} need you` : `${agents.length} running`}</span>
      </div>
      {agents.length === 0 && <div style={{ padding: 8, color: "#8B90A0", fontSize: 12 }}>No agents</div>}
      {agents.map((a) => (
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
