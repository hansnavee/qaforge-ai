'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ASSIGNABLE_ROLES, roleBlurb, roleLabel } from '@qaforge/shared';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import {
  ListingEmpty,
  ListingPager,
  ListingTable,
  listingFilterClass,
  listingSearchClass,
  useListingSlice,
} from '@/components/ListingTable';
import { Modal } from '@/components/Modal';
import { api, ApiError } from '@/lib/api';
import { parsePlanLimitError, type PlanLimitErrorBody } from '@/lib/plan';
import { useOrgCaps } from '@/lib/use-org';
import { usePlan } from '@/lib/use-plan';
import { ProFeatureNotice, UpgradeModal } from '@/components/UpgradeModal';

type Member = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string };
};

type OrgDetail = {
  id: string;
  name: string;
  slug: string;
  role: string;
  browserstackConfigured?: boolean;
  jiraConfigured?: boolean;
  jira?: {
    baseUrl: string;
    email: string;
    projectKey: string;
    issueType: string;
  } | null;
  memberships: Member[];
};

type OrgCaseField = {
  id: string;
  key: string;
  label: string;
  type: 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'CHECKBOX' | 'NUMBER';
  options: string[] | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { org, caps, roleLabel: myLabel } = useOrgCaps();
  const { canJira } = usePlan();
  const [bsUser, setBsUser] = useState('');
  const [bsKey, setBsKey] = useState('');
  const [bsError, setBsError] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [jiraIssueType, setJiraIssueType] = useState('Bug');
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<PlanLimitErrorBody | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>(
    'TESTER',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [roleEdit, setRoleEdit] = useState<Member | null>(null);
  const [nextRole, setNextRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>(
    'TESTER',
  );

  const orgQuery = useQuery({
    queryKey: ['org', org?.id],
    enabled: Boolean(org?.id),
    queryFn: () => api<OrgDetail>(`/api/v1/orgs/${org!.id}`),
  });

  const saveBrowserstack = useMutation({
    mutationFn: () =>
      api(`/api/v1/orgs/${org!.id}/browserstack`, {
        method: 'PATCH',
        body: JSON.stringify({ username: bsUser.trim(), accessKey: bsKey.trim() }),
      }),
    onSuccess: async () => {
      setBsKey('');
      setBsError(null);
      await qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
    onError: (e) => {
      setBsError(
        e instanceof ApiError ? e.message : 'Could not save BrowserStack keys',
      );
    },
  });

  const saveJira = useMutation({
    mutationFn: () =>
      api(`/api/v1/orgs/${org!.id}/jira`, {
        method: 'PATCH',
        body: JSON.stringify({
          baseUrl: jiraBaseUrl.trim(),
          email: jiraEmail.trim(),
          apiToken: jiraToken.trim(),
          projectKey: jiraProjectKey.trim(),
          issueType: jiraIssueType.trim() || 'Bug',
        }),
      }),
    onSuccess: async () => {
      setJiraToken('');
      setJiraError(null);
      await qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
    onError: (e) => {
      const planErr =
        e instanceof ApiError ? parsePlanLimitError(e.body) : null;
      if (planErr) {
        setUpgradeError(planErr);
        return;
      }
      setJiraError(
        e instanceof ApiError ? e.message : 'Could not connect Jira',
      );
    },
  });

  const clearJira = useMutation({
    mutationFn: () =>
      api(`/api/v1/orgs/${org!.id}/jira`, { method: 'DELETE' }),
    onSuccess: async () => {
      setJiraError(null);
      await qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
    onError: (e) => {
      setJiraError(
        e instanceof ApiError ? e.message : 'Could not disconnect Jira',
      );
    },
  });

  const invite = useMutation({
    mutationFn: () =>
      api(`/api/v1/orgs/${org!.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      }),
    onSuccess: async () => {
      setEmail('');
      setFormError(null);
      setInviteOpen(false);
      await qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
    onError: (e) => {
      setFormError(e instanceof ApiError ? e.message : 'Could not add member');
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api(`/api/v1/orgs/${org!.id}/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      setRoleEdit(null);
      return qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/orgs/${org!.id}/members/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setRemoveId(null);
      await qc.invalidateQueries({ queryKey: ['org', org?.id] });
    },
  });

  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<
    'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'CHECKBOX' | 'NUMBER'
  >('TEXT');
  const [fieldOptions, setFieldOptions] = useState('');
  const [fieldScope, setFieldScope] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<OrgCaseField | null>(null);
  const [deleteFieldId, setDeleteFieldId] = useState<string | null>(null);

  const [memberSearch, setMemberSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('');
  const [fieldTypeFilter, setFieldTypeFilter] = useState('');
  const [fieldScopeFilter, setFieldScopeFilter] = useState('');

  const members = orgQuery.data?.memberships ?? [];
  const filteredMembers = useMemo(() => {
    if (!memberRoleFilter) return members;
    return members.filter((m) => {
      if (memberRoleFilter === 'LEAD') {
        return m.role === 'LEAD' || m.role === 'MEMBER';
      }
      return m.role === memberRoleFilter;
    });
  }, [members, memberRoleFilter]);
  const memberListing = useListingSlice(filteredMembers, {
    query: memberSearch,
    searchText: (m) =>
      `${m.user.name} ${m.user.email} ${m.role}`,
    resetKey: memberRoleFilter,
  });
  const removing = members.find((m) => m.id === removeId);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    enabled: Boolean(org?.id),
    queryFn: () => api<Array<{ id: string; name: string }>>('/api/v1/projects'),
  });

  const fieldsQuery = useQuery({
    queryKey: ['org-case-fields', org?.id],
    enabled: Boolean(org?.id),
    queryFn: () =>
      api<OrgCaseField[]>(`/api/v1/orgs/${org!.id}/case-fields`),
  });

  const filteredFields = useMemo(() => {
    let rows = fieldsQuery.data ?? [];
    if (fieldTypeFilter) {
      rows = rows.filter((f) => f.type === fieldTypeFilter);
    }
    if (fieldScopeFilter === 'all') {
      rows = rows.filter((f) => !f.projectId);
    } else if (fieldScopeFilter) {
      rows = rows.filter((f) => f.projectId === fieldScopeFilter);
    }
    return rows;
  }, [fieldsQuery.data, fieldTypeFilter, fieldScopeFilter]);
  const fieldListing = useListingSlice(filteredFields, {
    query: fieldSearch,
    searchText: (f) =>
      `${f.label} ${f.key} ${f.type} ${f.project?.name ?? 'all projects'}`,
    resetKey: `${fieldTypeFilter}:${fieldScopeFilter}`,
  });
  const fieldFiltersActive = Boolean(
    fieldSearch.trim() || fieldTypeFilter || fieldScopeFilter,
  );
  const memberFiltersActive = Boolean(
    memberSearch.trim() || memberRoleFilter,
  );

  function resetFieldForm(row?: OrgCaseField | null) {
    setEditingField(row ?? null);
    setFieldLabel(row?.label ?? '');
    setFieldType(row?.type ?? 'TEXT');
    setFieldOptions(
      Array.isArray(row?.options) ? row.options.join(', ') : '',
    );
    setFieldScope(row?.projectId ?? '');
    setFieldError(null);
    setFieldOpen(true);
  }

  const saveField = useMutation({
    mutationFn: async () => {
      const body = {
        label: fieldLabel.trim(),
        type: fieldType,
        projectId: fieldScope || null,
        options:
          fieldType === 'DROPDOWN'
            ? fieldOptions
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
      };
      if (editingField) {
        return api(`/api/v1/orgs/${org!.id}/case-fields/${editingField.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return api(`/api/v1/orgs/${org!.id}/case-fields`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      setFieldOpen(false);
      setEditingField(null);
      await qc.invalidateQueries({ queryKey: ['org-case-fields', org?.id] });
      await qc.invalidateQueries({ queryKey: ['case-fields'] });
    },
    onError: (e) => {
      setFieldError(e instanceof ApiError ? e.message : 'Could not save field');
    },
  });

  const deleteField = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/orgs/${org!.id}/case-fields/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleteFieldId(null);
      await qc.invalidateQueries({ queryKey: ['org-case-fields', org?.id] });
      await qc.invalidateQueries({ queryKey: ['case-fields'] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Organization, your role, and the team.
        </p>
      </div>

      <Card className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted">
          Organization
        </div>
        <div className="font-medium">{orgQuery.data?.name ?? org?.name ?? '—'}</div>
        <div className="font-mono text-xs text-muted">
          {orgQuery.data?.slug ?? org?.id ?? ''}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-sm text-muted">Your role</span>
          <Badge tone="accent">{myLabel}</Badge>
          <span className="text-xs text-muted">{roleBlurb(caps.role)}</span>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted">
          BrowserStack
        </div>
        <p className="text-xs text-muted">
          Cloud AI Executor connects Playwright to BrowserStack. Keys are
          encrypted and never shown again.
        </p>
        <div className="text-xs">
          Status:{' '}
          {orgQuery.data?.browserstackConfigured ? (
            <span className="text-success">Configured</span>
          ) : (
            <span className="text-muted">Not configured</span>
          )}
        </div>
        {caps.canManageMembers ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="BrowserStack username"
              value={bsUser}
              onChange={(e) => setBsUser(e.target.value)}
              autoComplete="off"
            />
            <Input
              type="password"
              placeholder="Access key"
              value={bsKey}
              onChange={(e) => setBsKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : (
          <p className="text-xs text-muted">
            Administrators can save BrowserStack keys.
          </p>
        )}
        {bsError ? <p className="text-sm text-danger">{bsError}</p> : null}
        {caps.canManageMembers ? (
          <Button
            type="button"
            size="sm"
            disabled={
              saveBrowserstack.isPending || !bsUser.trim() || !bsKey.trim()
            }
            onClick={() => saveBrowserstack.mutate()}
          >
            {saveBrowserstack.isPending ? 'Saving…' : 'Save keys'}
          </Button>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted">Jira</div>
        <p className="text-xs text-muted">
          Dual-write defects to Jira Cloud. QAForge TCMS stays the canonical
          record; connected Jira projects receive matching issues.
        </p>
        <div className="text-xs">
          Status:{' '}
          {orgQuery.data?.jiraConfigured ? (
            <span className="text-success">Connected</span>
          ) : (
            <span className="text-muted">Not connected</span>
          )}
          {orgQuery.data?.jira ? (
            <span className="text-muted">
              {' '}
              · {orgQuery.data.jira.projectKey} @ {orgQuery.data.jira.baseUrl}
            </span>
          ) : null}
        </div>
        {!canJira ? (
          <ProFeatureNotice feature="Jira dual-write" planName="Enterprise">
            Connect Jira after upgrading to sync defects outward.
          </ProFeatureNotice>
        ) : null}
        {caps.canManageMembers && canJira ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="https://your-domain.atlassian.net"
              value={jiraBaseUrl}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
              autoComplete="off"
            />
            <Input
              placeholder="Atlassian email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              autoComplete="off"
            />
            <Input
              type="password"
              placeholder="API token"
              value={jiraToken}
              onChange={(e) => setJiraToken(e.target.value)}
              autoComplete="off"
            />
            <Input
              placeholder="Project key (e.g. QA)"
              value={jiraProjectKey}
              onChange={(e) => setJiraProjectKey(e.target.value)}
              autoComplete="off"
            />
            <Input
              placeholder="Issue type (Bug)"
              value={jiraIssueType}
              onChange={(e) => setJiraIssueType(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : caps.canManageMembers && !canJira ? null : (
          <p className="text-xs text-muted">
            Administrators can connect Jira on Enterprise.
          </p>
        )}
        {jiraError ? <p className="text-sm text-danger">{jiraError}</p> : null}
        {caps.canManageMembers && canJira ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                saveJira.isPending ||
                !jiraBaseUrl.trim() ||
                !jiraEmail.trim() ||
                !jiraToken.trim() ||
                !jiraProjectKey.trim()
              }
              onClick={() => saveJira.mutate()}
            >
              {saveJira.isPending ? 'Connecting…' : 'Connect Jira'}
            </Button>
            {orgQuery.data?.jiraConfigured ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={clearJira.isPending}
                onClick={() => clearJira.mutate()}
              >
                {clearJira.isPending ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Custom fields</h2>
            <p className="mt-1 text-xs text-muted">
              Apply to all projects or a single project. Cases pick them up on
              the case form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={listingSearchClass}
              placeholder="Search fields"
              value={fieldSearch}
              onChange={(e) => setFieldSearch(e.target.value)}
            />
            <select
              className={listingFilterClass}
              value={fieldTypeFilter}
              onChange={(e) => setFieldTypeFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="">All types</option>
              <option value="TEXT">TEXT</option>
              <option value="TEXTAREA">TEXTAREA</option>
              <option value="DROPDOWN">DROPDOWN</option>
              <option value="CHECKBOX">CHECKBOX</option>
              <option value="NUMBER">NUMBER</option>
            </select>
            <select
              className={listingFilterClass}
              value={fieldScopeFilter}
              onChange={(e) => setFieldScopeFilter(e.target.value)}
              aria-label="Filter by scope"
            >
              <option value="">All scopes</option>
              <option value="all">All projects</option>
              {(projectsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {caps.canDesign ? (
              <Button
                type="button"
                size="sm"
                onClick={() => resetFieldForm()}
              >
                Add field
              </Button>
            ) : (
              <p className="text-xs text-muted">
                Leads and Administrators can add custom fields.
              </p>
            )}
          </div>
        </div>
        <ListingTable
          rows={fieldListing.pageRows}
          loading={fieldsQuery.isLoading}
          columnKey="settings-fields"
          lockedColumnId="label"
          empty={
            <ListingEmpty>
              {fieldFiltersActive
                ? 'No rows match these filters.'
                : 'No custom fields yet.'}
            </ListingEmpty>
          }
          columns={[
            {
              id: 'label',
              header: 'Label',
              className: 'font-medium',
              cell: (f) => f.label,
            },
            {
              id: 'key',
              header: 'Key',
              className: 'font-mono text-xs text-muted',
              cell: (f) => f.key,
            },
            {
              id: 'type',
              header: 'Type',
              className: 'text-xs text-muted',
              cell: (f) => f.type,
            },
            {
              id: 'scope',
              header: 'Applies to',
              cell: (f) => f.project?.name ?? 'All projects',
            },
          ]}
          actions={(f) =>
            caps.canDesign
              ? [
                  {
                    label: 'Edit',
                    onClick: () => resetFieldForm(f),
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    onClick: () => setDeleteFieldId(f.id),
                  },
                ]
              : []
          }
        />
        <ListingPager
          page={fieldListing.page}
          totalPages={fieldListing.totalPages}
          from={fieldListing.from}
          to={fieldListing.to}
          total={fieldListing.total}
          pageSize={fieldListing.pageSize}
          onPage={fieldListing.setPage}
          onPageSize={fieldListing.setPageSize}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Team</h2>
            <p className="mt-1 text-xs text-muted">
              Administrator · Lead · Tester · Viewer. People must already have
              an account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={listingSearchClass}
              placeholder="Search members"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            <select
              className={listingFilterClass}
              value={memberRoleFilter}
              onChange={(e) => setMemberRoleFilter(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              <option value="OWNER">Owner</option>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            {caps.canManageMembers ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEmail('');
                  setInviteRole('TESTER');
                  setFormError(null);
                  setInviteOpen(true);
                }}
              >
                Add member
              </Button>
            ) : (
              <p className="text-xs text-muted">
                Only Administrators can add or change team members.
              </p>
            )}
          </div>
        </div>

        <ListingTable
          rows={memberListing.pageRows}
          loading={orgQuery.isLoading}
          columnKey="settings-team"
          lockedColumnId="name"
          empty={
            <ListingEmpty>
              {memberFiltersActive
                ? 'No rows match these filters.'
                : 'No members yet.'}
            </ListingEmpty>
          }
          columns={[
            {
              id: 'name',
              header: 'Name',
              className: 'font-medium',
              cell: (m) => m.user.name || m.user.email,
            },
            {
              id: 'email',
              header: 'Email',
              className: 'text-xs text-muted',
              cell: (m) => m.user.email,
            },
            {
              id: 'role',
              header: 'Role',
              cell: (m) => <Badge>{roleLabel(m.role)}</Badge>,
            },
          ]}
          actions={(m) =>
            caps.canManageMembers && m.role !== 'OWNER'
              ? [
                  {
                    label: 'Change role',
                    onClick: () => {
                      setRoleEdit(m);
                      setNextRole(
                        (m.role === 'MEMBER' ? 'LEAD' : m.role) as
                          (typeof ASSIGNABLE_ROLES)[number],
                      );
                    },
                  },
                  {
                    label: 'Remove',
                    danger: true,
                    onClick: () => setRemoveId(m.id),
                  },
                ]
              : []
          }
        />
        <ListingPager
          page={memberListing.page}
          totalPages={memberListing.totalPages}
          from={memberListing.from}
          to={memberListing.to}
          total={memberListing.total}
          pageSize={memberListing.pageSize}
          onPage={memberListing.setPage}
          onPageSize={memberListing.setPageSize}
        />
      </div>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">What each role can do</h2>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>
            <span className="font-medium text-fg">Owner</span> —{' '}
            {roleBlurb('OWNER')}
          </li>
          <li>
            <span className="font-medium text-fg">Administrator</span> —{' '}
            {roleBlurb('ADMIN')}
          </li>
          <li>
            <span className="font-medium text-fg">Lead</span> — {roleBlurb('LEAD')}
          </li>
          <li>
            <span className="font-medium text-fg">Tester</span> —{' '}
            {roleBlurb('TESTER')}
          </li>
          <li>
            <span className="font-medium text-fg">Viewer</span> —{' '}
            {roleBlurb('VIEWER')}
          </li>
        </ul>
        <p className="pt-1 text-xs text-muted">
          Your access: {caps.canDesign ? 'design cases' : 'no case edits'} ·{' '}
          {caps.canExecute ? 'execute runs' : 'no execution'} ·{' '}
          {caps.canManageMembers ? 'manage team' : 'cannot manage team'}
        </p>
      </Card>

      <Modal
        open={inviteOpen}
        title="Add member"
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!email.trim() || invite.isPending}
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? 'Adding…' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tester@company.com"
          />
          <label className="space-y-1 text-sm">
            <span className="text-muted">Role</span>
            <select
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as (typeof ASSIGNABLE_ROLES)[number])
              }
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(roleEdit)}
        title="Change role"
        onClose={() => setRoleEdit(null)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRoleEdit(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={changeRole.isPending}
              onClick={() => {
                if (roleEdit) {
                  changeRole.mutate({ id: roleEdit.id, role: nextRole });
                }
              }}
            >
              {changeRole.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          {roleEdit?.user.email}
        </p>
        <select
          className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm"
          value={nextRole}
          onChange={(e) =>
            setNextRole(e.target.value as (typeof ASSIGNABLE_ROLES)[number])
          }
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </Modal>

      <Modal
        open={fieldOpen}
        title={editingField ? 'Edit custom field' : 'Add custom field'}
        onClose={() => setFieldOpen(false)}
        footer={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFieldOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!fieldLabel.trim() || saveField.isPending}
              onClick={() => saveField.mutate()}
            >
              {saveField.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Label"
            value={fieldLabel}
            onChange={(e) => setFieldLabel(e.target.value)}
            placeholder="Component"
          />
          <label className="space-y-1 text-sm">
            <span className="text-muted">Type</span>
            <select
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm"
              value={fieldType}
              onChange={(e) =>
                setFieldType(
                  e.target.value as
                    | 'TEXT'
                    | 'TEXTAREA'
                    | 'DROPDOWN'
                    | 'CHECKBOX'
                    | 'NUMBER',
                )
              }
            >
              <option value="TEXT">Text</option>
              <option value="TEXTAREA">Long text</option>
              <option value="DROPDOWN">Dropdown</option>
              <option value="CHECKBOX">Checkbox</option>
              <option value="NUMBER">Number</option>
            </select>
          </label>
          {fieldType === 'DROPDOWN' ? (
            <Input
              label="Options (comma separated)"
              value={fieldOptions}
              onChange={(e) => setFieldOptions(e.target.value)}
              placeholder="Web, API, Mobile"
            />
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="text-muted">Applies to</span>
            <select
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm"
              value={fieldScope}
              onChange={(e) => setFieldScope(e.target.value)}
            >
              <option value="">All projects</option>
              {(projectsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {fieldError ? <p className="text-sm text-danger">{fieldError}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteFieldId)}
        title="Delete custom field?"
        danger
        confirmLabel="Delete"
        busy={deleteField.isPending}
        onCancel={() => setDeleteFieldId(null)}
        onConfirm={() => {
          if (deleteFieldId) deleteField.mutate(deleteFieldId);
        }}
      >
        <p>This field will be removed from case forms. Existing values stay on cases until edited.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(removeId)}
        title="Remove team member?"
        danger
        confirmLabel="Remove"
        busy={remove.isPending}
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          if (removeId) remove.mutate(removeId);
        }}
      >
        <p>{removing?.user.email} will lose access to this organization.</p>
      </ConfirmDialog>

      <UpgradeModal
        open={Boolean(upgradeError)}
        error={upgradeError}
        onClose={() => setUpgradeError(null)}
      />
    </div>
  );
}
