/**
 * GET /statements/:driverId — the per-driver recovery statement (PRD 04 §5.7): the WTP
 * / referral asset (G4). Three lines mapping to the three tax streams + dispositions:
 *   gasóleo €X assured (trust hook) · foreign-VAT €Y filed (the money) ·
 *   excise/dietas €Z identified (upsell) · plus € identified vs € filed. Printable.
 */
import { Layout } from '../layout.js';
import { eur } from '../fmt.js';
import type { DriverStatement } from '../statements.js';

export function StatementPage({ s }: { s: DriverStatement }) {
  return (
    <Layout title={`Extracto · ${s.driver.name ?? s.driver.id.slice(0, 8)}`}>
      <div class="noprint" style="margin-bottom:10px">
        <button class="sec" onclick="window.print()">
          Imprimir / exportar PDF
        </button>{' '}
        <a href="/onboarding">← alta y conductores</a>
      </div>

      <h1>Extracto de recuperación</h1>
      <p class="sub">
        {s.carrier?.legal_name ?? 'Carrier —'} · conductor {s.driver.name ?? '—'} ·{' '}
        {s.docCount} documentos procesados
      </p>

      <div class="grid">
        <div class="tile">
          <div class="g" style="color:var(--gold)">Gasóleo profesional · asegurado</div>
          <div class="big">{eur(s.gasoleoAssuredEur)}</div>
          <div class="lbl">el gancho de confianza (no es el dinero, pero lo aseguramos)</div>
        </div>
        <div class="tile">
          <div class="g" style="color:var(--accent-d)">IVA extranjero · presentado</div>
          <div class="big">{eur(s.foreignVatFiledEur)}</div>
          <div class="lbl">el dinero — presentado vía modelo 360</div>
        </div>
        <div class="tile">
          <div class="g" style="color:var(--navy)">Excise / dietas · identificado</div>
          <div class="big">{eur(s.exciseDietasIdentifiedEur)}</div>
          <div class="lbl">oportunidad adicional (upsell)</div>
        </div>
      </div>

      <h2>Identificado vs. presentado</h2>
      <table>
        <tbody>
          <tr>
            <th>€ identificado (asegurado + ready + identificado)</th>
            <td>{eur(s.identifiedEur)}</td>
          </tr>
          <tr>
            <th>IVA extranjero en preparación (ready, aún no presentado)</th>
            <td>{eur(s.foreignVatReadyEur)}</td>
          </tr>
          <tr>
            <th>€ presentado (filed)</th>
            <td>
              <strong>{eur(s.filedEur)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <p class="muted" style="margin-top:14px; font-size:12px">
        Se reporta € <strong>presentado</strong>, no € cobrado (el efectivo llega meses después).
      </p>
    </Layout>
  );
}
