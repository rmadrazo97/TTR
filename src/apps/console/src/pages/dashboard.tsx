/**
 * GET / — the gate dashboard (PRD 04 §5.8 links out; here we render the tiles the
 * console owns). Shows G2 / G3 / G4 headline numbers plus a 30-Sep-2026 modelo 360
 * deadline countdown. This is the honest go/no-go readout at a glance.
 */
import { Layout, Tile } from '../layout.js';
import { eur, pct, daysUntil } from '../fmt.js';
import type { GateSummary } from '../metrics.js';
import { SCORED_FIELDS } from '../metrics.js';
import type { Carrier } from '@ttr/core';

/** The pilot's hard modelo 360 deadline (dossier §8). */
export const MODELO_360_DEADLINE = new Date('2026-09-30T23:59:59Z');

export function DashboardPage({ g, carriers }: { g: GateSummary; carriers: Carrier[] }) {
  const days = daysUntil(MODELO_360_DEADLINE);
  const countdownTone = days < 0 ? 'bad' : days <= 45 ? 'amber' : 'good';
  return (
    <Layout title="Panel">
      <h1>Panel de indicadores (gates)</h1>
      <p class="sub">
        Los cuatro números del POC. Se mide € <strong>presentado</strong> (filed), no € cobrado.
      </p>

      <div class="grid">
        <Tile
          gate="G2 · Autorización"
          value={pct(g.g2Rate)}
          label={`${g.grantedAndSentCount}/${g.onboardedCount} otorgaron apoderamiento Y enviaron ≥1 doc`}
        />
        <Tile
          gate="G3 · Precisión extracción"
          value={pct(g.accuracy)}
          label={`${g.fieldCorrect}/${g.fieldTotal} campos correctos · objetivo ≥90%`}
        />
        <Tile
          gate="G3 · € mediana/camión"
          value={eur(g.medianEurPerTruck)}
          label={`de reclamaciones presentadas · objetivo ≥€4.000 · ${g.intlTrucks} camiones int'l`}
        />
        <Tile
          gate="G4 · Disposición a pagar"
          value={pct(g.g4Rate)}
          label={`${g.wtpAccepted}/${g.wtpTotal} aceptan la comisión ~15%`}
        />
        <div class="tile">
          <div class="g">Fecha límite · modelo 360</div>
          <div class="big" style={`color:var(--${countdownTone === 'bad' ? 'bad' : countdownTone === 'amber' ? 'amber' : 'accent-d'})`}>
            {days < 0 ? `Vencido hace ${-days} d` : `${days} días`}
          </div>
          <div class="lbl">30-sep-2026 · presentación por carrier</div>
        </div>
      </div>

      <h2>Detalle G3 · precisión por campo</h2>
      <table>
        <thead>
          <tr>
            <th>Campo</th>
            <th>Correctos</th>
            <th>Total</th>
            <th>Precisión</th>
          </tr>
        </thead>
        <tbody>
          {SCORED_FIELDS.map((f) => (
            <tr>
              <td>
                <code>{f}</code>
              </td>
              <td>{g.perField[f].correct}</td>
              <td>{g.perField[f].total}</td>
              <td>{pct(g.perField[f].rate)}</td>
            </tr>
          ))}
          <tr>
            <td colspan={3}>
              <strong>Confirmados sin cambios / editados</strong>
            </td>
            <td>
              {g.confirmedCount} / {g.editedCount}
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Cross-cut · € identificado vs € presentado</h2>
      <table>
        <tbody>
          <tr>
            <th>€ identificado (ready + presentado)</th>
            <td>{eur(g.identifiedEur)}</td>
          </tr>
          <tr>
            <th>€ presentado (filed)</th>
            <td>{eur(g.totalFiledEur)}</td>
          </tr>
          <tr>
            <th>Reclamaciones presentadas</th>
            <td>{g.filedClaimCount}</td>
          </tr>
        </tbody>
      </table>

      <h2>G4 · registrar entrevista de disposición a pagar (WTP)</h2>
      <div class="card noprint">
        <form method="post" action="/wtp">
          <div class="row">
            <div class="col">
              <label>Carrier</label>
              <select name="carrier_id" required>
                <option value="">—</option>
                {carriers.map((c) => (
                  <option value={c.id}>{c.legal_name}</option>
                ))}
              </select>
            </div>
            <div class="col">
              <label>¿Acepta la comisión ~15%?</label>
              <select name="accepted">
                <option value="true">sí, acepta</option>
                <option value="false">no</option>
              </select>
            </div>
            <div class="col">
              <label>% comisión discutido</label>
              <input type="text" name="fee_pct" value="15" />
            </div>
            <div class="col">
              <label>Nota</label>
              <input type="text" name="note" placeholder="opcional" />
            </div>
          </div>
          <button type="submit" class="sec" style="margin-top:8px">
            Registrar WTP
          </button>
        </form>
      </div>

      <p class="sub" style="margin-top:16px">
        Cola de revisión: <a href="/queue">/queue</a> · Reclamaciones:{' '}
        <a href="/claims">/claims</a> · Alta y funnel: <a href="/onboarding">/onboarding</a>
      </p>
    </Layout>
  );
}
