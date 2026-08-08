/**
 * The original overview: headline KPI tiles, the after-hours funnel beside the
 * known-clients panel, and the after-hours calls table. Data comes from the
 * shared conversion context; the shell guarantees data is present before this
 * page renders, so `data` is non-null here.
 */
import { CallsTable } from '../components/CallsTable';
import { ClientMatch } from '../components/ClientMatch';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { FunnelChart } from '../components/FunnelChart';
import { Highlights } from '../components/Highlights';
import { KpiTiles } from '../components/KpiTiles';
import { PageFoot } from '../components/PageFoot';
import { TrendChart } from '../components/TrendChart';
import { useFilteredData } from '../hooks/useFilteredData';
import { buildDailySeries } from '../lib/series';

export function AfterHoursPage() {
  const { data } = useFilteredData();
  if (!data) return null;

  const series = buildDailySeries(data.by_call);

  return (
    <>
      <ExecutiveSummary kpis={data.kpis} />
      <KpiTiles kpis={data.kpis} calls={data.by_call} />
      <Highlights calls={data.by_call} links={data.links} />
      {series.length > 1 && <TrendChart series={series} />}
      <div className="grid-2">
        <FunnelChart funnel={data.funnel} />
        <ClientMatch kpis={data.kpis} />
      </div>
      <CallsTable
        calls={data.by_call}
        links={data.links}
        mode="after"
        heading="After-hours calls"
        infoText="Every after-hours call in the window, newest first — business-hours calls are left out. The Links column opens the call's transcript in Retell and, for callers already in our CRM, their lead in Odoo."
      />
      <PageFoot />
    </>
  );
}
