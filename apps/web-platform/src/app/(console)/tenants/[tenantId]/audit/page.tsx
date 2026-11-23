'use client';
import { useParams } from 'next/navigation';
import { AuditTable } from '@/components/audit-table';

export default function TenantAuditPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  return <AuditTable tenantId={tenantId} />;
}
