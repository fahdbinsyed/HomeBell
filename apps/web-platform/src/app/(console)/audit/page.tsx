'use client';
import { PageHeader } from '@homebell/ui-web';
import { AuditTable } from '@/components/audit-table';

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every platform and school action, including denied and failed security events. Entries are append-only."
      />
      <AuditTable />
    </>
  );
}
