import type React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaskMonitor from './TaskMonitor'
import { LanguageProvider } from '../i18n/LanguageContext'
import { useProjectTaskFeed } from '../hooks/useProjectTaskFeed'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

vi.mock('../hooks/useProjectTaskFeed', () => ({
  PROJECT_TASK_PAGE_SIZE: 20,
  useProjectTaskFeed: vi.fn(),
}))

const mockUseProjectTaskFeed = vi.mocked(useProjectTaskFeed)

function renderTaskMonitor(props: React.ComponentProps<typeof TaskMonitor>) {
  return render(
    <LanguageProvider>
      <TaskMonitor {...props} />
    </LanguageProvider>,
  )
}

describe('TaskMonitor', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()

    mockUseProjectTaskFeed.mockReturnValue({
      jobs: [],
      incidents: [
        {
          job_id: 'job-1',
          job_name: 'RNA-seq confirmation',
          job_status: 'awaiting_plan_confirmation',
          incident_type: 'execution_confirmation',
          severity: 'info',
          owner: 'user',
          summary: 'Execution graph is waiting for final confirmation.',
          next_action: 'confirm_or_edit_execution',
          age_seconds: 120,
        },
      ],
      incidentSummary: { total_open: 1, critical: 0, warning: 0, info: 1 },
      overview: { total: 1, active: 1, by_status: { awaiting_plan_confirmation: 1 } },
      eventVersion: 0,
      totalCount: 1,
      getJobsPage: () => [
        {
          id: 'job-1',
          name: 'RNA-seq confirmation',
          status: 'awaiting_plan_confirmation',
          goal: 'Analyze apple RNA-seq data',
          thread_id: 'thread-1',
          created_at: '2026-03-26T10:00:00Z',
        },
      ],
      getPageHasMore: () => false,
      patchJob: vi.fn(),
      locateJobPage: vi.fn().mockResolvedValue(1),
      refreshJobPage: vi.fn().mockResolvedValue([
        {
          id: 'job-1',
          name: 'RNA-seq confirmation',
          status: 'awaiting_plan_confirmation',
          goal: 'Analyze apple RNA-seq data',
          thread_id: 'thread-1',
          created_at: '2026-03-26T10:00:00Z',
        },
      ]),
      refreshJobs: vi.fn().mockResolvedValue([]),
      refreshIncidents: vi.fn().mockResolvedValue(undefined),
      refreshAll: vi.fn().mockResolvedValue(undefined),
    })

    vi.stubGlobal(
      'WebSocket',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null
        close() {}
      } as unknown as typeof WebSocket,
    )
  })

  it('renders layered confirmation details for execution confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/jobs/job-1/bindings?detailed=1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              job_status: 'awaiting_plan_confirmation',
              error_message: 'Execution graph is ready for final confirmation.',
              pending_interaction_type: 'execution_confirmation',
              pending_interaction_payload: {
                prompt_text: 'Execution graph is ready for final confirmation.',
              },
              runtime_diagnostics: [],
              auto_recovery_events: [],
              timeline: [],
              confirmation_phase: 'execution',
              confirmation_plan: [
                { step_key: 'align', display_name: 'HISAT2 align', step_type: 'align.hisat2' },
                { step_key: 'count', display_name: 'featureCounts', step_type: 'quant.featurecounts' },
              ],
              execution_plan_summary: {
                has_execution_ir: true,
                has_expanded_dag: true,
                group_count: 4,
                node_count: 9,
              },
              steps: [],
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        })
      }),
    )

    renderTaskMonitor({
      projectId: 'proj-1',
      onOpenThread: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: /logs/i }))

    expect(await screen.findByText('Layer readiness')).toBeInTheDocument()
    expect(screen.getByText('Abstract Plan')).toBeInTheDocument()
    expect(screen.getByText('Execution IR')).toBeInTheDocument()
    expect(screen.getByText('Expanded DAG')).toBeInTheDocument()
    expect(screen.getByText('4 groups · 9 executable nodes')).toBeInTheDocument()
    expect(screen.getByText('2 review items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Chat' })).toBeInTheDocument()
  })

  it('emits resource workspace navigation requests from supervisor review', async () => {
    const onOpenResourceWorkspace = vi.fn()

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/jobs/supervisor-review?project=proj-1')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              mode: 'heuristic',
              generated_at: '2026-03-26T12:00:00Z',
              overview: '1 open incident.',
              supervisor_message: 'Register the missing primary resource.',
              focus_summary: {
                primary_lane: 'resource_readiness',
                next_best_operator_move: 'register_primary_resource',
              },
              project_playbook: {
                goal: 'resource_readiness',
                next_move: 'register_primary_resource',
                step_codes: ['open_task', 'inspect_resource_blockers'],
              },
              recommendations: [
                {
                  priority: 1,
                  job_id: 'job-1',
                  job_name: 'RNA-seq confirmation',
                  incident_type: 'binding',
                  severity: 'warning',
                  owner: 'system',
                  diagnosis: 'Reference FASTA is missing.',
                  immediate_action: 'inspect_bindings_and_resume',
                  why_now: 'Alignment cannot start.',
                  rollback_target: 'align',
                },
              ],
              dossiers: [
                {
                  job_id: 'job-1',
                  resource_graph: {
                    blocking_nodes: [],
                    blocking_summary: [
                      {
                        id: 'ref',
                        label: 'GDDH13 reference',
                        status: 'missing',
                        cause: 'missing_primary_resource',
                        recommended_action: 'register_primary_resource',
                        registry_key: 'reference_fasta',
                        workspace_section: 'registry',
                      },
                    ],
                    dominant_blocker: {
                      id: 'ref',
                      label: 'GDDH13 reference',
                      status: 'missing',
                      cause: 'missing_primary_resource',
                      why_blocked: 'A required primary reference/annotation resource is missing.',
                      operator_hint: 'Register or select the matching reference FASTA / annotation GTF for this project.',
                      recommended_action: 'register_primary_resource',
                      registry_key: 'reference_fasta',
                      workspace_section: 'registry',
                    },
                  },
                },
              ],
            }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        })
      }),
    )

    renderTaskMonitor({
      projectId: 'proj-1',
      onOpenThread: vi.fn(),
      onOpenResourceWorkspace,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Supervisor Review' }))

    const button = await screen.findByRole('button', { name: 'Open Resource Registry' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(onOpenResourceWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          tab: 'project-info',
          focusSection: 'registry',
          key: 'reference_fasta',
          description: 'GDDH13 reference',
        }),
      )
    })
  })

  it('surfaces pending command authorization at the top of the task panel with a scrollable command box', async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined)
    const refreshJobPage = vi.fn().mockResolvedValue([
      {
        id: 'job-auth',
        name: 'DESeq2 run',
        status: 'waiting_for_authorization',
        goal: 'Run differential expression on apple RNA-seq data',
        thread_id: 'thread-auth',
        pending_interaction_type: 'authorization',
        created_at: '2026-03-27T08:00:00Z',
      },
    ])

    mockUseProjectTaskFeed.mockReturnValue({
      jobs: [
        {
          id: 'job-auth',
          name: 'DESeq2 run',
          status: 'waiting_for_authorization',
          goal: 'Run differential expression on apple RNA-seq data',
          thread_id: 'thread-auth',
          pending_interaction_type: 'authorization',
          created_at: '2026-03-27T08:00:00Z',
        },
      ],
      incidents: [],
      incidentSummary: { total_open: 0, critical: 0, warning: 0, info: 0 },
      overview: { total: 1, active: 1, by_status: { waiting_for_authorization: 1 } },
      eventVersion: 0,
      totalCount: 1,
      getJobsPage: () => [
        {
          id: 'job-auth',
          name: 'DESeq2 run',
          status: 'waiting_for_authorization',
          goal: 'Run differential expression on apple RNA-seq data',
          thread_id: 'thread-auth',
          pending_interaction_type: 'authorization',
          created_at: '2026-03-27T08:00:00Z',
        },
      ],
      getPageHasMore: () => false,
      patchJob: vi.fn(),
      locateJobPage: vi.fn().mockResolvedValue(1),
      refreshJobPage,
      refreshJobs: vi.fn().mockResolvedValue([]),
      refreshIncidents: vi.fn().mockResolvedValue(undefined),
      refreshAll,
    })

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/jobs/job-auth/bindings?detailed=1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            job_status: 'waiting_for_authorization',
            pending_interaction_type: 'authorization',
            pending_interaction_payload: {
              auth_request_id: 'auth-1',
              command_type: 'rscript',
              step_key: 'stats.deseq2',
              command: 'Rscript /tmp/run_deseq2.R\n# lots of code\nprint(\"hello\")',
            },
            steps: [],
          }),
        })
      }
      if (url.includes('/api/jobs/job-auth/authorization-requests/auth-1/resolve')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    renderTaskMonitor({
      projectId: 'proj-1',
      onOpenThread: vi.fn(),
    })

    expect(await screen.findByText('Pending Command Authorization')).toBeInTheDocument()
    expect(screen.getByText('1 task(s) are waiting for command authorization.')).toBeInTheDocument()
    const commandPreview = await screen.findByText(/Rscript \/tmp\/run_deseq2\.R/)
    const scrollBox = commandPreview.closest('[style]')
    expect(scrollBox).not.toBeNull()
    expect(scrollBox?.getAttribute('style')).toContain('max-height: 224px')
    expect(scrollBox?.getAttribute('style')).toContain('overflow-y: auto')

    fireEvent.click(screen.getByRole('button', { name: 'Authorize & Run' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job-auth/authorization-requests/auth-1/resolve',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })
    await waitFor(() => {
      expect(refreshAll).toHaveBeenCalled()
      expect(refreshJobPage).toHaveBeenCalledWith(1, { force: true })
    })
  })

  it('surfaces pending repair requests at the top of the task panel and submits repair actions', async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined)
    const refreshJobPage = vi.fn().mockResolvedValue([
      {
        id: 'job-repair',
        name: 'featureCounts repair',
        status: 'waiting_for_repair',
        goal: 'Repair featureCounts run on apple RNA-seq data',
        thread_id: 'thread-repair',
        pending_interaction_type: 'repair',
        created_at: '2026-03-27T09:00:00Z',
      },
    ])

    mockUseProjectTaskFeed.mockReturnValue({
      jobs: [
        {
          id: 'job-repair',
          name: 'featureCounts repair',
          status: 'waiting_for_repair',
          goal: 'Repair featureCounts run on apple RNA-seq data',
          thread_id: 'thread-repair',
          pending_interaction_type: 'repair',
          created_at: '2026-03-27T09:00:00Z',
        },
      ],
      incidents: [],
      incidentSummary: { total_open: 0, critical: 0, warning: 0, info: 0 },
      overview: { total: 1, active: 1, by_status: { waiting_for_repair: 1 } },
      eventVersion: 0,
      totalCount: 1,
      getJobsPage: () => [
        {
          id: 'job-repair',
          name: 'featureCounts repair',
          status: 'waiting_for_repair',
          goal: 'Repair featureCounts run on apple RNA-seq data',
          thread_id: 'thread-repair',
          pending_interaction_type: 'repair',
          created_at: '2026-03-27T09:00:00Z',
        },
      ],
      getPageHasMore: () => false,
      patchJob: vi.fn(),
      locateJobPage: vi.fn().mockResolvedValue(1),
      refreshJobPage,
      refreshJobs: vi.fn().mockResolvedValue([]),
      refreshIncidents: vi.fn().mockResolvedValue(undefined),
      refreshAll,
    })

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/jobs/job-repair/bindings?detailed=1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            job_status: 'waiting_for_repair',
            pending_interaction_type: 'repair',
            pending_interaction_payload: {
              repair_request_id: 'repair-1',
              step_key: 'quant.featurecounts',
              failed_command: 'featureCounts -a genes.gtf -o counts.txt sample.bam',
              stderr_excerpt: 'featureCounts: failed to open annotation file',
            },
            steps: [],
          }),
        })
      }
      if (url.includes('/api/jobs/job-repair/repair-requests/repair-1/resolve')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    renderTaskMonitor({
      projectId: 'proj-1',
      onOpenThread: vi.fn(),
    })

    expect(await screen.findByText('Pending Repair Requests')).toBeInTheDocument()
    expect(screen.getByText('1 task(s) are waiting for repair input.')).toBeInTheDocument()
    const commandMatches = await screen.findAllByText(/featureCounts -a genes\.gtf/)
    expect(commandMatches.length).toBeGreaterThan(0)
    const repairInput = screen.getByDisplayValue('featureCounts -a genes.gtf -o counts.txt sample.bam')
    expect(repairInput.tagName).toBe('TEXTAREA')
    const previewScrollBox = commandMatches
      .map((node) => node.closest('[style]'))
      .find((node) => node?.getAttribute('style')?.includes('max-height: 224px'))
    expect(previewScrollBox).not.toBeNull()
    expect(screen.getByText(/featureCounts: failed to open annotation file/)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('e.g. "the index needs to be rebuilt with the correct GTF file"'), {
      target: { value: 'use the correct genes.gtf path' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send & Retry' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job-repair/repair-requests/repair-1/resolve',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })
    await waitFor(() => {
      expect(refreshAll).toHaveBeenCalled()
      expect(refreshJobPage).toHaveBeenCalledWith(1, { force: true })
    })
  })
})
