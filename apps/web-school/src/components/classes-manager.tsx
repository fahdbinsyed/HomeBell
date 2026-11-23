'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@homebell/api-client';
import { Badge, Button, Card, Input, LoadingState, useToast } from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';
import { schoolKey, useSchool } from '@/lib/school';

/** Classes & sections (dismissal grouping). Delete is only allowed when empty. */
export function ClassesManager() {
  const { tenantId, canWrite, can } = useSchool();
  const { client } = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const key = schoolKey(tenantId, 'classes');
  const classes = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(client.GET('/v1/t/{tenantId}/classes', { params: { path: { tenantId } } })),
  });
  const [newClass, setNewClass] = useState('');
  const [newSection, setNewSection] = useState<Record<string, string>>({});
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: key });
    toast(msg);
  };
  const fail = (e: unknown) => toast(messageFor(e), 'danger');
  const addClass = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST('/v1/t/{tenantId}/classes', {
          params: { path: { tenantId } },
          body: { name: newClass.trim(), sortOrder: (classes.data?.items.length ?? 0) + 1 },
        }),
      ),
    onSuccess: () => {
      setNewClass('');
      done('Class added');
    },
    onError: fail,
  });
  const delClass = useMutation({
    mutationFn: (id: string) =>
      client
        .DELETE('/v1/t/{tenantId}/classes/{classId}', {
          params: { path: { tenantId, classId: id } },
        })
        .then((r) => {
          if (!r.response.ok) throw r.error;
        }),
    onSuccess: () => done('Class removed'),
    onError: () => toast('Move or remove the students first.', 'danger'),
  });
  const addSection = useMutation({
    mutationFn: (classId: string) =>
      unwrap(
        client.POST('/v1/t/{tenantId}/classes/{classId}/sections', {
          params: { path: { tenantId, classId } },
          body: { name: newSection[classId]!.trim() },
        }),
      ),
    onSuccess: (_d, classId) => {
      setNewSection((x) => ({ ...x, [classId]: '' }));
      done('Section added');
    },
    onError: fail,
  });
  const delSection = useMutation({
    mutationFn: (id: string) =>
      client
        .DELETE('/v1/t/{tenantId}/sections/{sectionId}', {
          params: { path: { tenantId, sectionId: id } },
        })
        .then((r) => {
          if (!r.response.ok) throw r.error;
        }),
    onSuccess: () => done('Section removed'),
    onError: () => toast('Move or remove the students first.', 'danger'),
  });
  const writable = canWrite && can('school.students.write');
  return (
    <Card
      title="Classes & sections"
      description="Used to group students on the queue and display screens."
    >
      {classes.isPending ? (
        <LoadingState rows={3} />
      ) : (
        <div className="flex flex-col gap-3">
          {classes.data?.items.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {c.name}{' '}
                  <span className="text-sm font-normal text-text-muted">
                    · {c.studentCount} students
                  </span>
                </p>
                {writable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={c.studentCount > 0}
                    onClick={() => delClass.mutate(c.id)}
                    aria-label={`Remove ${c.name}`}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.sections.map((s) => (
                  <Badge key={s.id}>
                    {s.name} ({s.studentCount})
                    {writable && s.studentCount === 0 && (
                      <button
                        type="button"
                        aria-label={`Remove section ${s.name}`}
                        className="ml-1"
                        onClick={() => delSection.mutate(s.id)}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
                {writable && (
                  <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newSection[c.id]?.trim()) addSection.mutate(c.id);
                    }}
                  >
                    <Input
                      aria-label={`New section in ${c.name}`}
                      placeholder="New section"
                      className="h-8 w-32"
                      value={newSection[c.id] ?? ''}
                      onChange={(e) => setNewSection((x) => ({ ...x, [c.id]: e.target.value }))}
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      Add
                    </Button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {writable && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newClass.trim()) addClass.mutate();
              }}
            >
              <Input
                aria-label="New class name"
                placeholder="New class, e.g. Grade 6"
                value={newClass}
                onChange={(e) => setNewClass(e.target.value)}
              />
              <Button type="submit" loading={addClass.isPending}>
                Add class
              </Button>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
