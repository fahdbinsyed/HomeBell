'use client';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { formatDate, formatNumber, labels } from '@homebell/copy';
import {
  Banner,
  Card,
  ErrorState,
  KeyValue,
  LoadingState,
  PageHeader,
  StateBadge,
} from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

export default function SubscriptionPage() {
  const { tenantId, entitlements } = useSchool();
  const { client } = useApi();
  const sub = useQuery({
    queryKey: schoolKey(tenantId, 'subscription'),
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/subscription', { params: { path: { tenantId } } })),
  });
  if (sub.isPending) return <LoadingState />;
  if (sub.error)
    return <ErrorState message={messageFor(sub.error)} onRetry={() => sub.refetch()} />;
  const s = sub.data;
  return (
    <>
      <PageHeader
        title="Subscription"
        description="Your HomeBell plan and limits. To change plans or renew, contact HomeBell — billing is handled outside this dashboard."
        badge={<StateBadge group="tenant" value={s.state} label={labels.tenantState[s.state]} />}
      />
      {s.daysUntilExpiry != null && s.daysUntilExpiry <= 14 && s.daysUntilExpiry >= 0 && (
        <div className="mb-4">
          <Banner
            tone="warning"
            title={`Access ends in ${s.daysUntilExpiry} day${s.daysUntilExpiry === 1 ? '' : 's'}`}
          >
            Contact HomeBell to renew so dismissal isn't interrupted.
          </Banner>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Plan">
          <KeyValue
            items={[
              { label: 'Plan', value: s.planName ?? 'Not assigned' },
              {
                label: 'Status',
                value: `${labels.tenantState[s.state]} · ${labels.operationalMode[s.operationalMode]}`,
              },
              {
                label: 'Access ends',
                value: s.expiresAt ? formatDate(s.expiresAt) : 'No end date',
              },
              {
                label: 'School term',
                value: `${formatDate(s.termStartDate)} – ${formatDate(s.termEndDate)}`,
              },
            ]}
          />
        </Card>
        <Card title="Limits & usage">
          <ul className="flex flex-col gap-2 text-sm">
            {s.limits.map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="text-text-muted">{labels.limit[l.key]}</span>
                <span className="tabular-nums">
                  {l.used !== null && l.used !== undefined ? `${l.used} / ` : ''}
                  {formatNumber(l.value)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Included features" className="lg:col-span-2">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {entitlements?.features
              .filter(
                (f) =>
                  ![
                    'audio.announcements',
                    'qr.verification',
                    'campus.multi',
                    'sso.enterprise',
                  ].includes(f.key),
              )
              .map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span aria-hidden className={f.enabled ? 'text-success-fg' : 'text-text-muted'}>
                    {f.enabled ? '✓' : '—'}
                  </span>
                  <span className={f.enabled ? '' : 'text-text-muted'}>
                    {labels.feature[f.key]}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
