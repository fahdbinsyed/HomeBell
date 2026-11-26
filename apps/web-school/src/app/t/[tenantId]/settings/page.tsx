'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { displayNameFormatValues, type TenantSettings } from '@homebell/contracts';
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Switch,
  useToast,
  ErrorState,
  LoadingState,
} from '@homebell/ui-web';
import { ApiError, messageFor, useApi } from '@homebell/web-core';
import { ClassesManager } from '@/components/classes-manager';
import { schoolKey, useSchool } from '@/lib/school';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAME_FORMAT = {
  first_name_last_initial: 'First name + last initial (Mia R.)',
  initials: 'Initials only (M.R.)',
  first_name: 'First name only (Mia)',
} as const;

export default function SettingsPage() {
  const { tenantId, can, canWrite, has } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const key = schoolKey(tenantId, 'settings');
  const settings = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await client.GET('/v1/t/{tenantId}/settings', { params: { path: { tenantId } } });
      return { s: await unwrap(Promise.resolve(r)), etag: r.response.headers.get('ETag') };
    },
  });
  const [s, setS] = useState<TenantSettings | null>(null);
  useEffect(() => {
    if (settings.data) setS(structuredClone(settings.data.s));
  }, [settings.data]);
  const writable = canWrite && can('school.settings.write');
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT('/v1/t/{tenantId}/settings', {
          params: { path: { tenantId }, header: { 'If-Match': settings.data?.etag ?? undefined } },
          body: s!,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast('Settings saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRECONDITION_FAILED')
        void qc.invalidateQueries({ queryKey: key });
    },
  });
  if (settings.isPending || !s) return <LoadingState rows={8} />;
  if (settings.error)
    return <ErrorState message={messageFor(settings.error)} onRetry={() => settings.refetch()} />;
  const up = (fn: (x: TenantSettings) => void) =>
    setS((prev) => {
      const n = structuredClone(prev!);
      fn(n);
      return n;
    });
  const windowFor = (day: number) => s.dismissal.windows.find((w) => w.dayOfWeek === day);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Dismissal rules, display privacy and branding for your school."
        actions={
          writable && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save settings
            </Button>
          )
        }
      />
      {save.error && (
        <div className="mb-4">
          <Banner tone="danger">{messageFor(save.error)}</Banner>
        </div>
      )}
      <fieldset disabled={!writable} className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Dismissal windows"
          description="Guardians can request pickup only inside these times (school time zone)."
        >
          <div className="flex flex-col gap-3">
            {DAYS.map((d, i) => {
              const w = windowFor(i + 1);
              return (
                <div key={d} className="grid grid-cols-[60px_auto_1fr_1fr] items-center gap-3">
                  <span className="text-sm font-medium">{d}</span>
                  <input
                    type="checkbox"
                    aria-label={`Open on ${d}`}
                    className="size-4 accent-primary"
                    checked={!!w}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.windows = e.target.checked
                          ? [
                              ...x.dismissal.windows,
                              { dayOfWeek: i + 1, opensAt: '14:30', closesAt: '16:00' },
                            ]
                          : x.dismissal.windows.filter((y) => y.dayOfWeek !== i + 1);
                      })
                    }
                  />
                  <Input
                    type="time"
                    aria-label={`${d} opens`}
                    disabled={!w}
                    value={w?.opensAt ?? ''}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.windows.find((y) => y.dayOfWeek === i + 1)!.opensAt =
                          e.target.value;
                      })
                    }
                  />
                  <Input
                    type="time"
                    aria-label={`${d} closes`}
                    disabled={!w}
                    value={w?.closesAt ?? ''}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.windows.find((y) => y.dayOfWeek === i + 1)!.closesAt =
                          e.target.value;
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Pickup flow">
          <div className="flex flex-col gap-5">
            <Switch
              label="Use the “sent out” step"
              description="Optional. Lets dispatchers mark a child as sent out. Guardians always confirm pickup in the app, with or without it."
              checked={s.dismissal.sentOutStepEnabled}
              disabled={!has('dismissal.sent_out_step')}
              onChange={(v) =>
                up((x) => {
                  x.dismissal.sentOutStepEnabled = v;
                })
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reminder after (min)" hint="Push reminder to confirm pickup.">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={30}
                    value={s.dismissal.timeouts.sentOutReminderMinutes}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.timeouts.sentOutReminderMinutes = Number(e.target.value);
                      })
                    }
                  />
                )}
              </Field>
              <Field
                label="Follow-up after (min)"
                hint="Unconfirmed requests move to “Needs follow-up”."
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={5}
                    max={60}
                    value={s.dismissal.timeouts.sentOutExceptionMinutes}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.timeouts.sentOutExceptionMinutes = Number(e.target.value);
                      })
                    }
                  />
                )}
              </Field>
              <Field
                label="Flag as waiting long after (min)"
                hint="Moves the request to “Needs follow-up” on the Live queue and shows it in amber on the display screens."
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={10}
                    max={120}
                    value={s.dismissal.timeouts.requestedStaleMinutes}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.timeouts.requestedStaleMinutes = Number(e.target.value);
                      })
                    }
                  />
                )}
              </Field>
              <Field label="End of day" hint="Open requests become follow-ups.">
                {(p) => (
                  <Input
                    {...p}
                    type="time"
                    value={s.dismissal.timeouts.endOfDayTime}
                    onChange={(e) =>
                      up((x) => {
                        x.dismissal.timeouts.endOfDayTime = e.target.value;
                      })
                    }
                  />
                )}
              </Field>
            </div>
          </div>
        </Card>
        <Card
          title="Location rule"
          description={
            has('dismissal.location_rule')
              ? 'Optionally require guardians to be near the school when requesting pickup.'
              : 'Not included in this school’s plan.'
          }
        >
          <div className="flex flex-col gap-4">
            <Switch
              label="Require guardians to be nearby"
              checked={s.locationRule.enabled}
              disabled={!has('dismissal.location_rule')}
              onChange={(v) =>
                up((x) => {
                  x.locationRule.enabled = v;
                  if (v && !x.locationRule.center)
                    x.locationRule.center = { lat: 40.7128, lng: -74.006 };
                })
              }
            />
            {s.locationRule.enabled && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="School latitude">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      step="0.0001"
                      value={s.locationRule.center?.lat ?? ''}
                      onChange={(e) =>
                        up((x) => {
                          x.locationRule.center = {
                            lat: Number(e.target.value),
                            lng: x.locationRule.center?.lng ?? 0,
                          };
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="School longitude">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      step="0.0001"
                      value={s.locationRule.center?.lng ?? ''}
                      onChange={(e) =>
                        up((x) => {
                          x.locationRule.center = {
                            lat: x.locationRule.center?.lat ?? 0,
                            lng: Number(e.target.value),
                          };
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="Radius (m)">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={50}
                      max={5000}
                      value={s.locationRule.radiusMeters}
                      onChange={(e) =>
                        up((x) => {
                          x.locationRule.radiusMeters = Number(e.target.value);
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="Required accuracy (m)">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={10}
                      max={1000}
                      value={s.locationRule.maxAccuracyMeters}
                      onChange={(e) =>
                        up((x) => {
                          x.locationRule.maxAccuracyMeters = Number(e.target.value);
                        })
                      }
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
        </Card>
        <Card title="Display screens & privacy">
          <div className="flex flex-col gap-4">
            <Field label="Name format on screens">
              {(p) => (
                <Select
                  {...p}
                  value={s.display.nameFormat}
                  onChange={(e) =>
                    up((x) => {
                      x.display.nameFormat = e.target
                        .value as TenantSettings['display']['nameFormat'];
                    })
                  }
                  options={displayNameFormatValues.map((v) => ({
                    value: v,
                    label: NAME_FORMAT[v],
                  }))}
                />
              )}
            </Field>
            <Switch
              label="Show class"
              checked={s.display.showClass}
              onChange={(v) =>
                up((x) => {
                  x.display.showClass = v;
                })
              }
            />
            <Switch
              label="Show section"
              checked={s.display.showSection}
              disabled={!s.display.showClass}
              onChange={(v) =>
                up((x) => {
                  x.display.showSection = v;
                })
              }
            />
            <Field label="Theme">
              {(p) => (
                <Select
                  {...p}
                  value={s.display.theme}
                  onChange={(e) =>
                    up((x) => {
                      x.display.theme = e.target.value as 'light';
                    })
                  }
                  options={[
                    { value: 'dark', label: 'Dark (recommended outdoors)' },
                    { value: 'light', label: 'Light' },
                    { value: 'auto', label: 'Follow screen' },
                  ]}
                />
              )}
            </Field>
          </div>
        </Card>
        <Card title="Branding">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              {(p) => (
                <Input
                  {...p}
                  value={s.branding.displayName}
                  onChange={(e) =>
                    up((x) => {
                      x.branding.displayName = e.target.value;
                    })
                  }
                />
              )}
            </Field>
            <Field
              label="Brand colour"
              hint={has('branding.custom') ? undefined : 'Custom branding is not in this plan.'}
            >
              {(p) => (
                <Input
                  {...p}
                  type="color"
                  disabled={!has('branding.custom')}
                  value={s.branding.primaryColor ?? '#1F6FEB'}
                  onChange={(e) =>
                    up((x) => {
                      x.branding.primaryColor = e.target.value.toUpperCase();
                    })
                  }
                />
              )}
            </Field>
          </div>
        </Card>
        <Card title="Notifications & security">
          <div className="flex flex-col gap-4">
            <Switch
              label="Daily unresolved-pickup digest"
              description="Emailed to school admins each morning."
              checked={s.notifications.dailyDigestEnabled}
              onChange={(v) =>
                up((x) => {
                  x.notifications.dailyDigestEnabled = v;
                })
              }
            />
            <Switch
              label="Require two-step verification for staff"
              checked={s.security.staffMfaRequired}
              onChange={(v) =>
                up((x) => {
                  x.security.staffMfaRequired = v;
                })
              }
            />
          </div>
        </Card>
      </fieldset>
      <div className="mt-6">
        <ClassesManager />
      </div>
    </>
  );
}
