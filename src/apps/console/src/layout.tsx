/**
 * Shared server-rendered page shell + a few small presentational components.
 *
 * Deliberately minimal CSS-in-a-<style> tag — this is the internal asesor tool
 * (functional over polished, PRD 04 §6). Spanish-language chrome per PRD 04 §4.
 */
import type { FC, PropsWithChildren, Child } from 'hono/jsx';

const CSS = `
  :root { --ink:#181f2a; --muted:#66718a; --line:#d9dde6; --bg:#f6f7f9;
          --accent:#0d7c6c; --accent-d:#0a5f53; --navy:#17324f; --gold:#a9822f;
          --good:#0d7c6c; --amber:#a9822f; --bad:#b23b3b; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         margin:0; color:var(--ink); background:var(--bg); font-size:14px; line-height:1.45; }
  header.top { background:var(--navy); color:#fff; padding:10px 18px; display:flex;
               align-items:center; gap:18px; flex-wrap:wrap; }
  header.top a { color:#dfe6f0; text-decoration:none; font-weight:600; }
  header.top a:hover { color:#fff; text-decoration:underline; }
  header.top .brand { font-weight:800; color:#fff; margin-right:8px; }
  main { max-width:1100px; margin:0 auto; padding:18px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:16px; margin:22px 0 8px; }
  p.sub { color:var(--muted); margin:0 0 14px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); }
  th, td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:#eef1f5; font-size:12px; text-transform:uppercase; letter-spacing:.02em; color:var(--muted); }
  tr:last-child td { border-bottom:0; }
  a { color:var(--accent-d); }
  .card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(210px,1fr)); }
  .tile { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
  .tile .g { font-size:11px; font-weight:700; letter-spacing:.05em; color:var(--accent-d); }
  .tile .big { font-size:26px; font-weight:800; margin:4px 0 2px; }
  .tile .lbl { color:var(--muted); font-size:12px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:600;
          border:1px solid var(--line); background:#fff; }
  .pill.good { color:var(--good); border-color:#bfe3db; background:#eef8f5; }
  .pill.amber { color:var(--amber); border-color:#ecdcb7; background:#fbf5e6; }
  .pill.bad { color:var(--bad); border-color:#e8c4c4; background:#fbeded; }
  .pill.gray { color:var(--muted); }
  form.inline { display:inline; }
  input, select, textarea { font:inherit; padding:6px 8px; border:1px solid var(--line);
                            border-radius:6px; background:#fff; width:100%; }
  textarea { min-height:56px; }
  label { display:block; font-size:12px; color:var(--muted); font-weight:600; margin:8px 0 2px; }
  button { font:inherit; font-weight:700; padding:7px 14px; border:1px solid var(--accent-d);
           border-radius:6px; background:var(--accent); color:#fff; cursor:pointer; }
  button.sec { background:#fff; color:var(--navy); border-color:var(--line); }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
  .col { flex:1 1 180px; min-width:150px; }
  .muted { color:var(--muted); }
  .imgwrap { border:1px solid var(--line); border-radius:8px; background:#fff; padding:8px; }
  .imgwrap img { max-width:100%; display:block; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:820px){ .split{ grid-template-columns:1fr; } }
  .note { background:#fbf5e6; border:1px solid #ecdcb7; border-radius:6px; padding:8px 10px; font-size:13px; }
  code { background:#eef1f5; padding:1px 5px; border-radius:4px; }
  @media print {
    header.top, .noprint { display:none !important; }
    body { background:#fff; }
    .tile, .card, table { border-color:#bbb; }
  }
`;

const NAV: Array<[string, string]> = [
  ['/', 'Panel'],
  ['/queue', 'Cola'],
  ['/claims', 'Reclamaciones'],
  ['/upload', 'Subir'],
  ['/onboarding', 'Alta'],
];

/** Full HTML document shell with the top nav. `title` is the browser + h-less title. */
export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · TTR Consola</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="top noprint">
          <span class="brand">TTR · Consola del asesor</span>
          {NAV.map(([href, label]) => (
            <a href={href}>{label}</a>
          ))}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
};

/** A dashboard gate tile. */
export const Tile: FC<{ gate: string; value: string; label: string }> = ({ gate, value, label }) => (
  <div class="tile">
    <div class="g">{gate}</div>
    <div class="big">{value}</div>
    <div class="lbl">{label}</div>
  </div>
);

/** A small status pill with a tone. */
export const StatusPill: FC<{ tone: 'good' | 'amber' | 'bad' | 'gray'; children?: unknown }> = ({
  tone,
  children,
}) => <span class={`pill ${tone}`}>{children}</span>;

/**
 * Render a full-page JSX tree to an HTML string with the `<!DOCTYPE html>` prologue that
 * hono/jsx does not emit on its own. `JSXNode.toString()` is synchronous for our fully
 * synchronous component trees but may be a Promise in general — await handles both.
 */
export async function renderPage(node: Child): Promise<string> {
  const body = node == null ? '' : await (node as { toString(): string | Promise<string> }).toString();
  return `<!DOCTYPE html>${body}`;
}
