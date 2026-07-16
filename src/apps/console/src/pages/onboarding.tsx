/**
 * GET /onboarding — signup capture + eligibility + authorization board (PRD 05).
 *  - Create Carrier (ICP-screen incl. gasoleo_censo_status trust hook) + Driver
 *    (forwarding address) in one go.
 *  - Record/advance Authorization status (apoderamiento requested→granted→verified) +
 *    certificate type + evidence ref (the fact, never credentials).
 *  - Status board: onboarding stage, grant status, doc count per driver.
 *  - Manual nudge list: granted apoderamiento but 0 docs sent — the direct G2 lever.
 */
import { Layout, StatusPill } from '../layout.js';
import type { OnboardingRow } from '../onboarding.js';

function authTone(status: string | null): 'good' | 'amber' | 'bad' | 'gray' {
  if (status === 'verified') return 'good';
  if (status === 'granted') return 'amber';
  if (status === 'requested') return 'bad';
  return 'gray';
}

export function OnboardingPage({
  rows,
  nudges,
  created,
}: {
  rows: OnboardingRow[];
  nudges: OnboardingRow[];
  created?: string;
}) {
  return (
    <Layout title="Alta y autorización">
      <h1>Alta y autorización</h1>
      <p class="sub">
        La puerta decisiva (G2): ≥60% otorgan <strong>apoderamiento</strong> Y envían el primer
        doc. El software mide y recuerda; el humano acompaña.
      </p>

      {created ? (
        <div class="note" style="margin-bottom:12px">
          Conductor dado de alta. Dirección de reenvío: <code>{created}</code>.
        </div>
      ) : null}

      {nudges.length > 0 && (
        <>
          <h2 style="color:var(--amber)">Nudges · otorgaron apoderamiento pero sin docs ({nudges.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Conductor</th>
                <th>Carrier</th>
                <th>Dirección de reenvío</th>
                <th>Acción manual</th>
              </tr>
            </thead>
            <tbody>
              {nudges.map((r) => (
                <tr>
                  <td>{r.driver_name ?? '—'}</td>
                  <td>{r.carrier_name ?? '—'}</td>
                  <td>
                    <code>{r.forwarding_address}</code>
                  </td>
                  <td class="muted">llamar / mensaje: recordar reenviar el primer recibo</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Tablero de conductores ({rows.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Conductor</th>
            <th>Carrier</th>
            <th>Provincia</th>
            <th>Censo gasóleo</th>
            <th>Etapa</th>
            <th>Autorización</th>
            <th>Cert.</th>
            <th>Docs</th>
            <th>Autorización</th>
            <th>Extracto</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colspan={10} class="muted">
                Sin conductores todavía. Da de alta uno abajo.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr>
              <td>{r.driver_name ?? '—'}</td>
              <td>{r.carrier_name ?? '—'}</td>
              <td>{r.province ?? '—'}</td>
              <td>{r.gasoleo_censo_status ?? '—'}</td>
              <td>{r.onboarding_stage}</td>
              <td>
                <StatusPill tone={authTone(r.auth_status)}>
                  {r.auth_status ?? 'sin registro'}
                </StatusPill>
              </td>
              <td>{r.cert_type ?? '—'}</td>
              <td>{r.doc_count}</td>
              <td>
                <a href={`#auth-${r.driver_id}`}>editar ↓</a>
              </td>
              <td>
                <a href={`/statements/${r.driver_id}`}>extracto →</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Nueva alta (carrier + conductor)</h2>
      <div class="card">
        <form method="post" action="/onboarding">
          <div class="row">
            <div class="col">
              <label>Razón social (carrier)</label>
              <input type="text" name="legal_name" required />
            </div>
            <div class="col">
              <label>NIF / CIF</label>
              <input type="text" name="nif_cif" />
            </div>
            <div class="col">
              <label>Provincia</label>
              <input type="text" name="province" placeholder="Murcia" />
            </div>
          </div>
          <div class="row">
            <div class="col">
              <label>Régimen IVA</label>
              <input type="text" name="vat_regime" value="estimacion_directa" />
            </div>
            <div class="col">
              <label>Tamaño de flota</label>
              <input type="number" name="fleet_size" />
            </div>
            <div class="col">
              <label>Censo gasóleo profesional (gancho de confianza)</label>
              <select name="gasoleo_censo_status">
                <option value="">—</option>
                <option value="enrolled">inscrito</option>
                <option value="pending">pendiente</option>
                <option value="not_enrolled">no inscrito</option>
              </select>
            </div>
            <div class="col" style="flex:0 0 auto">
              <label>Runner internacional</label>
              <label style="font-weight:400">
                <input type="checkbox" name="intl_runner" value="true" style="width:auto" /> sí
              </label>
            </div>
          </div>
          <hr style="border:0; border-top:1px solid var(--line); margin:12px 0" />
          <div class="row">
            <div class="col">
              <label>Nombre del conductor</label>
              <input type="text" name="driver_name" />
            </div>
            <div class="col">
              <label>Email registrado</label>
              <input type="text" name="registered_email" />
            </div>
            <div class="col">
              <label>Dirección de reenvío (única)</label>
              <input type="text" name="forwarding_address" placeholder="carrier01@ingest.ttr.example" required />
            </div>
          </div>
          <label>
            <input type="checkbox" name="consent" value="true" style="width:auto" /> Consentimiento
            RGPD + condiciones no-win-no-fee capturados (fuera de app)
          </label>
          <button type="submit" style="margin-top:10px">
            Dar de alta
          </button>
        </form>
      </div>

      <h2>Registrar / avanzar autorización</h2>
      {rows.map((r) => (
        <div class="card" style="margin-bottom:10px" id={`auth-${r.driver_id}`}>
          <strong>{r.driver_name ?? r.forwarding_address}</strong>{' '}
          <span class="muted">· {r.carrier_name ?? '—'}</span>
          <form method="post" action="/onboarding/authorization" style="margin-top:8px">
            <input type="hidden" name="driver_id" value={r.driver_id} />
            <div class="row">
              <div class="col">
                <label>Tipo</label>
                <select name="type">
                  <option value="apoderamiento" selected={r.auth_type !== 'colaborador_social'}>
                    apoderamiento
                  </option>
                  <option value="colaborador_social" selected={r.auth_type === 'colaborador_social'}>
                    colaborador_social
                  </option>
                </select>
              </div>
              <div class="col">
                <label>Certificado</label>
                <select name="cert_type">
                  <option value="">—</option>
                  <option value="FNMT" selected={r.cert_type === 'FNMT'}>
                    FNMT
                  </option>
                  <option value="Clave" selected={r.cert_type === 'Clave'}>
                    Cl@ve
                  </option>
                </select>
              </div>
              <div class="col">
                <label>Estado</label>
                <select name="status">
                  <option value="requested" selected={r.auth_status === 'requested'}>
                    requested
                  </option>
                  <option value="granted" selected={r.auth_status === 'granted'}>
                    granted
                  </option>
                  <option value="verified" selected={r.auth_status === 'verified'}>
                    verified
                  </option>
                </select>
              </div>
              <div class="col">
                <label>Evidencia (ref., no credenciales)</label>
                <input type="text" name="evidence_ref" placeholder="r2://.../apoderamiento.pdf" />
              </div>
            </div>
            <button type="submit" class="sec" style="margin-top:8px">
              Guardar autorización
            </button>
          </form>
        </div>
      ))}
    </Layout>
  );
}
