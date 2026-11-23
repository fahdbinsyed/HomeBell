import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Banner, Button, ConfirmDialog, DataTable, Field, Input, StateBadge } from '../src';

describe('ui-web components', () => {
  it('DataTable shows loading, error with retry, empty and rows', async () => {
    const onRetry = vi.fn();
    const cols = [{ key: 'n', header: 'Name', cell: (r: { id: string; name: string }) => r.name }];
    const { rerender } = render(
      <DataTable columns={cols} rows={undefined} loading rowKey={(r) => r.id} />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(
      <DataTable
        columns={cols}
        rows={undefined}
        error="Can't reach HomeBell."
        onRetry={onRetry}
        rowKey={(r) => r.id}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <DataTable
        columns={cols}
        rows={[]}
        empty={{ title: 'No students found' }}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('No students found')).toBeInTheDocument();
    rerender(
      <DataTable
        caption="Students"
        columns={cols}
        rows={[{ id: '1', name: 'Mia Rivera' }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole('table', { name: 'Students' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Mia Rivera' })).toBeInTheDocument();
  });

  it('Field wires label, hint and error for assistive tech', () => {
    render(
      <Field label="Mobile number" error="Use international format">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Mobile number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use international format');
  });

  it('ConfirmDialog requires typing the name for destructive actions', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Deactivate school?"
        tone="danger"
        confirmText="Greenfield Academy"
        confirmLabel="Deactivate"
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Deactivate' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Type “Greenfield Academy” to confirm/),
      'Greenfield Academy',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('state badges and danger banners are labelled', () => {
    render(
      <>
        <StateBadge group="pickup" value="exception" label="Needs follow-up" />
        <Banner tone="danger" title="Service paused" />
      </>,
    );
    expect(screen.getByText('Needs follow-up')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Service paused');
  });

  it('loading buttons are busy and disabled', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
});
