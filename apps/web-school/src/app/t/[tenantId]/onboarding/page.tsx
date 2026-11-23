'use client';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { Card, LoadingState, PageHeader, useLink } from '@homebell/ui-web';
import { useApi } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

interface Step {
  done: boolean;
  title: string;
  body: string;
  href: string;
  cta: string;
}

export default function OnboardingPage() {
  const { tenantId, has } = useSchool();
  const { client } = useApi();
  const Link = useLink();
  const path = { tenantId };
  const q = useQuery({
    queryKey: schoolKey(tenantId, 'onboarding'),
    queryFn: async () => {
      const [classes, overview, staff, displays, settings] = await Promise.all([
        unwrap(client.GET('/v1/t/{tenantId}/classes', { params: { path } })),
        unwrap(client.GET('/v1/t/{tenantId}/overview', { params: { path } })),
        unwrap(client.GET('/v1/t/{tenantId}/staff', { params: { path } })),
        unwrap(client.GET('/v1/t/{tenantId}/displays', { params: { path } })),
        unwrap(client.GET('/v1/t/{tenantId}/settings', { params: { path } })),
      ]);
      return { classes, overview, staff, displays, settings };
    },
  });
  if (q.isPending || !q.data) return <LoadingState rows={6} />;
  const { classes, overview, staff, displays, settings } = q.data;
  const base = `/t/${tenantId}`;
  const totalGuardians = overview.guardians.active + overview.guardians.pendingActivation;
  const steps: Step[] = [
    {
      done: classes.items.length > 0,
      title: 'Add classes and sections',
      body: 'Classes group students on the queue and screens.',
      href: `${base}/settings`,
      cta: 'Manage classes',
    },
    {
      done: overview.students.active > 0,
      title: 'Import students and primary guardians',
      body: 'Upload a CSV with each student and their primary guardian’s mobile number.',
      href: `${base}/students/import`,
      cta: 'Import CSV',
    },
    {
      done: settings.dismissal.windows.length > 0,
      title: 'Set dismissal windows',
      body: 'When guardians may request pickup.',
      href: `${base}/settings`,
      cta: 'Open settings',
    },
    {
      done: staff.members.length + staff.pendingInvitations.length > 1,
      title: 'Invite your dismissal team',
      body: 'Dispatchers and front-desk staff run the live queue.',
      href: `${base}/staff`,
      cta: 'Invite staff',
    },
    ...(has('dismissal.display')
      ? [
          {
            done: displays.items.some((d) => d.state === 'active'),
            title: 'Pair a display screen',
            body: 'Show the queue on a TV in the car line or lobby.',
            href: `${base}/displays`,
            cta: 'Pair a screen',
          },
        ]
      : []),
    {
      done: totalGuardians > 0 && overview.guardians.active / totalGuardians >= 0.5,
      title: 'Get guardians onto the app',
      body: `${overview.guardians.active} of ${totalGuardians} primary guardians have activated the HomeBell app (Android & iPhone) by verifying their phone.`,
      href: `${base}/guardians`,
      cta: 'View guardians',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <>
      <PageHeader
        title="Setup checklist"
        description={`${done} of ${steps.length} steps complete.`}
      />
      <div
        className="mb-6 h-2 rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="Setup progress"
      >
        <div
          className="h-2 rounded-full bg-success-fg"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.done ? 'bg-success-bg text-success-fg' : 'bg-surface-muted text-text-muted'}`}
                  >
                    {s.done ? '✓' : i + 1}
                  </span>
                  <div>
                    <p className="font-medium">
                      {s.title}
                      <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                    </p>
                    <p className="text-sm text-text-muted">{s.body}</p>
                  </div>
                </div>
                <Link href={s.href} className="text-sm font-medium text-primary hover:underline">
                  {s.cta}
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
