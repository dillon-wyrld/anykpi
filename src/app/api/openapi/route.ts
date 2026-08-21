import { NextRequest, NextResponse } from 'next/server';
import { publicBaseUrl } from '@/core/view-state';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  OverviewResponseSchema,
  UsersListResponseSchema,
  DeleteUserResponseSchema,
  CohortsResponseSchema,
  WBRResponseSchema,
  CalendarResponseSchema,
  SyncResponseSchema,
  SyncTriggerRequestSchema,
  SyncTriggerResponseSchema,
  FreshnessResponseSchema,
  QueryUsersRequestSchema,
  ConnectSourceRequestSchema,
  ConnectSourceResponseSchema,
  ImportRequestSchema,
  ImportPreviewResponseSchema,
  ImportResponseSchema,
  ExportResponseSchema,
  APIKeyCreateRequestSchema,
  APIKeyResponseSchema,
  APIKeyDowngradeRequestSchema,
  APIKeyDowngradeResponseSchema,
  SessionCreateRequestSchema,
  SessionStatusResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceArchiveRequestSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceDeleteResponseSchema,
  WorkspaceRecordSchema,
  CompanyProfileSchema,
  CompanyProfileUpdateSchema,
  AuditListResponseSchema,
  OutreachQueueRequestSchema,
  OutreachIdRequestSchema,
  OutreachOutcomeRequestSchema,
  OutreachListResponseSchema,
  OutreachDraftResponseSchema,
  OutreachOutcomeResponseSchema,
  OutreachSendResponseSchema,
  ErrorResponseSchema,
  IngestIdentifyRequestSchema,
  IngestEventRequestSchema,
  IngestBatchRequestSchema,
  IngestBatchResponseSchema,
  IngestWebhookRequestSchema,
  IngestWebhookResponseSchema,
} from '@/core/contracts';

/**
 * GET /api/openapi
 * 
 * OpenAPI 3.0 spec generated from Zod contracts
 */
export async function GET(request: NextRequest) {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'ANYKPI API',
      version: '1.0.0',
      description: 'The growth stack for modern builders. Same resources humans see in the dashboard.',
      contact: {
        name: 'ANYKPI',
        url: 'https://github.com/dillon-wyrld/anykpi'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: publicBaseUrl(request),
        description: 'Self-hosted instance'
      }
    ],
    tags: [
      { name: 'Overview', description: 'Company snapshot' },
      { name: 'Users', description: 'Query and filter users' },
      { name: 'Cohorts', description: 'Retention analysis with PMF signals' },
      { name: 'WBR', description: 'Weekly Business Review metrics' },
      { name: 'Calendar', description: 'Multi-source event timeline' },
      { name: 'Sync', description: 'Connected source status' },
      { name: 'Freshness', description: 'Last ingest and per-source last-sync stamps' },
      { name: 'Connect', description: 'Store per-source credentials' },
      { name: 'Import', description: 'CSV import for users and events' },
      { name: 'Export', description: 'Full export of users, events, and read models' },
      { name: 'Ingest', description: 'Direct event collection' },
      { name: 'Keys', description: 'API key management' },
      { name: 'Session', description: 'Browser session cookie for live dashboard reads' },
      { name: 'Workspaces', description: 'Named workspaces with isolated users, accounts, metrics, and config' },
      { name: 'Config', description: 'Per-workspace company profile (name, founded date, home city)' },
      { name: 'Audit', description: 'Action audit log' },
      { name: 'Outreach', description: 'Persisted PMF+ outreach drafts with per-send approval and outcome tags' }
    ],
    paths: {
      '/api/v1/overview': {
        get: {
          tags: ['Overview'],
          summary: 'Get company overview',
          description: 'Returns key metrics: users, activity, retention, PMF signal, exceptions, connector sync health',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' },
              description: 'Workspace ID'
            }
          ],
          responses: {
            200: {
              description: 'Overview data with view_url',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OverviewResponseSchema)
                }
              }
            },
            500: {
              description: 'Server error',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/users': {
        get: {
          tags: ['Users'],
          summary: 'Query users',
          description: 'Filter users by cluster, platform, signup dates. `total` is the full match count; page with `hasMore` / `nextOffset`.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            },
            {
              name: 'cluster',
              in: 'query',
              schema: { type: 'string' },
              description: 'Behavior cluster (e.g., "🔥 Power daily")'
            },
            {
              name: 'platform',
              in: 'query',
              schema: { type: 'string' },
              description: 'Platform (ios, android, web)'
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 100 }
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 }
            }
          ],
          responses: {
            200: {
              description: 'List of users with view_url',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(UsersListResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid parameters',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/users/{id}': {
        delete: {
          tags: ['Users'],
          summary: 'Delete a person',
          description:
            'Purge a person and their events, cascade through person-level read models, and write a tombstone so a later connector sync, CSV import, or batch ingest cannot resurrect them. Key-only: a browser session is refused with 403 so the audit row names the deleting actor.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'personId'
            },
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'live' }
            }
          ],
          responses: {
            200: {
              description: 'Person deleted and tombstoned',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(DeleteUserResponseSchema)
                }
              }
            },
            403: {
              description: 'Browser session or read-only key cannot delete',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            404: {
              description: 'Person not found in the workspace'
            }
          }
        }
      },
      '/api/v1/cohorts': {
        get: {
          tags: ['Cohorts'],
          summary: 'Get cohort retention',
          description: 'Returns retention curves with smile detection (PMF signal). Optional split by platform, country, or cluster is capped at 3 series.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            },
            {
              name: 'payers',
              in: 'query',
              schema: { type: 'string', enum: ['1', 'true'] },
              description: 'When set, keep only paying people'
            },
            {
              name: 'split',
              in: 'query',
              schema: { type: 'string', enum: ['platform', 'country', 'cluster'] },
              description: 'Compare mode: draw one series per value of this field'
            },
            {
              name: 'series',
              in: 'query',
              schema: { type: 'string' },
              description: 'Comma-separated split values, max 3. A fourth series is refused.'
            }
          ],
          responses: {
            200: {
              description: 'Cohort retention data with PMF verdict',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(CohortsResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid split or more than 3 series',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/wbr': {
        get: {
          tags: ['WBR'],
          summary: 'Get WBR metrics',
          description: 'Weekly Business Review: 6 weeks, 12 months YOY, exceptions auto-surfaced',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            }
          ],
          responses: {
            200: {
              description: 'WBR metrics with status (ok/watch/off)',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(WBRResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/calendar': {
        get: {
          tags: ['Calendar'],
          summary: 'Get calendar events',
          description: 'Multi-source timeline: launches, milestones, rituals, comms',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            }
          ],
          responses: {
            200: {
              description: 'Calendar events from all sources',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(CalendarResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/sync': {
        get: {
          tags: ['Sync'],
          summary: 'Get sync state',
          description:
            'Status of all connected sources with last sync time and syncIntervalMinutes (SYNC_INTERVAL_MINUTES; 0 means the in-process scheduler is off)',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            }
          ],
          responses: {
            200: {
              description: 'Sync states for connected sources',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(SyncResponseSchema)
                }
              }
            }
          }
        },
        post: {
          tags: ['Sync'],
          summary: 'Trigger a sync',
          description: 'Run one registered source or all sources. Requires an API key.',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: zodToJsonSchema(SyncTriggerRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Per-source results and updated sync states',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(SyncTriggerResponseSchema)
                }
              }
            },
            400: {
              description: 'Unknown source or invalid body',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/freshness': {
        get: {
          tags: ['Freshness'],
          summary: 'Get freshness stamps',
          description:
            'Last ingest plus per-source last-sync stamps. Dashboard views poll this and refetch only when a watched stamp moves.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' },
              description: 'Workspace ID'
            }
          ],
          responses: {
            200: {
              description: 'Freshness stamps',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(FreshnessResponseSchema)
                }
              }
            },
            401: {
              description: 'Live workspace requires an API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/audit': {
        get: {
          tags: ['Audit'],
          summary: 'Query the action audit log',
          description:
            'Every write records actor (key id, env, or session), action, subject, and timestamp. Filter by actor and since/until to answer what an agent did in a window.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            },
            {
              name: 'actor',
              in: 'query',
              schema: { type: 'string' },
              description: 'Key id, env, session, or webhook'
            },
            {
              name: 'action',
              in: 'query',
              schema: { type: 'string' }
            },
            {
              name: 'since',
              in: 'query',
              schema: { type: 'string', format: 'date-time' }
            },
            {
              name: 'until',
              in: 'query',
              schema: { type: 'string', format: 'date-time' }
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 100 }
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 }
            }
          ],
          responses: {
            200: {
              description: 'Audit entries, newest first',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(AuditListResponseSchema)
                }
              }
            },
            401: {
              description: 'Live workspace requires an API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/outreach': {
        get: {
          tags: ['Outreach'],
          summary: 'List outreach drafts',
          description:
            'Persisted drafts (waiting / approved / sent) for the workspace, including outcome tags and conversion by cluster.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
            }
          ],
          responses: {
            200: {
              description: 'Drafts with view_url',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OutreachListResponseSchema)
                }
              }
            }
          }
        },
        post: {
          tags: ['Outreach'],
          summary: 'Queue an outreach draft',
          description:
            'Persist a waiting draft. Write scope can queue. Approval is a separate action (session or admin only).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(OutreachQueueRequestSchema)
              }
            }
          },
          responses: {
            201: {
              description: 'Draft queued',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OutreachDraftResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/outreach/approve': {
        post: {
          tags: ['Outreach'],
          summary: 'Approve an outreach draft',
          description:
            'Mark a persisted draft approved. Browser session or admin-scoped key only. A write key that queued the draft cannot approve it.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(OutreachIdRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Draft approved',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OutreachDraftResponseSchema)
                }
              }
            },
            403: {
              description: 'Write-scoped key cannot approve',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/outreach/outcome': {
        post: {
          tags: ['Outreach'],
          summary: 'Tag an outreach outcome',
          description:
            'Mark a persisted draft replied, interviewed, or converted. Tags are stored in config keyed by outreach id. The PMF+ view rolls conversion by cluster.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(OutreachOutcomeRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Draft tagged; conversion by cluster included',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OutreachOutcomeResponseSchema)
                }
              }
            },
            404: {
              description: 'Outreach draft not found',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/outreach/send': {
        post: {
          tags: ['Outreach'],
          summary: 'Send an approved outreach draft',
          description:
            'Calls the single delivery function with the persisted row. Unapproved drafts are refused. Every send is logged with timestamp, recipient, and the approving actor.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(OutreachIdRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Draft sent and logged',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(OutreachSendResponseSchema)
                }
              }
            },
            403: {
              description: 'Draft is not approved',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/connect': {
        post: {
          tags: ['Connect'],
          summary: 'Store source credentials',
          description:
            'Persist per-source config encrypted at rest with ANYKPI_SECRET. Requires an API key. Credentials are never returned. Source `csv` stores import kind and column mapping.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(ConnectSourceRequestSchema)
              }
            }
          },
          responses: {
            201: {
              description: 'Source connected',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ConnectSourceResponseSchema)
                }
              }
            },
            200: {
              description: 'Credentials rotated',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ConnectSourceResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            503: {
              description: 'ANYKPI_SECRET is not set',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/import': {
        post: {
          tags: ['Import'],
          summary: 'Import users or events from CSV',
          description:
            'Write-gated. Mapping is stored in the encrypted sources store (same as POST /api/v1/connect). Send `preview: true` for column-mapping preview. Re-running the same file is idempotent on activity.externalId.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(ImportRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Imported rows, or a mapping preview when preview=true',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      zodToJsonSchema(ImportResponseSchema),
                      zodToJsonSchema(ImportPreviewResponseSchema)
                    ]
                  }
                }
              }
            },
            400: {
              description: 'Invalid CSV or mapped rows (errors include line numbers)',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            503: {
              description: 'ANYKPI_SECRET is not set',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/export': {
        get: {
          tags: ['Export'],
          summary: 'Export users, events, and read models',
          description:
            'Read-gated dump of users, events, and connector read models as JSON or CSV files. Users and events re-import via POST /api/v1/import. Connector-backed read models restore by re-syncing the source — CSV import does not write those tables.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' },
              description: 'Workspace ID'
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
              description: 'json rows or csv file map'
            }
          ],
          responses: {
            200: {
              description: 'Workspace export with restore notes',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ExportResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid format',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Live workspace requires an API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/ingest/identify': {
        post: {
          tags: ['Ingest'],
          summary: 'Identify user',
          description: 'Create or update user properties',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(IngestIdentifyRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'User identified',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { success: { type: 'boolean' } } }
                }
              }
            },
            400: {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/ingest/webhook/{source}': {
        post: {
          security: [],
          tags: ['Ingest'],
          summary: 'Ingest a signed webhook event',
          description:
            'Realtime push path. HMAC-SHA256 of the raw body with the per-source secret stored via POST /api/v1/connect. Re-submitting rotates the secret. Bad signature returns 401. No API key.',
          parameters: [
            {
              name: 'source',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Source slug matching the stored HMAC row'
            },
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'live' }
            },
            {
              name: 'X-Webhook-Signature',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'sha256=<hex> HMAC of the raw JSON body'
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(IngestWebhookRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Event accepted',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(IngestWebhookResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid body',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid HMAC signature',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/ingest/batch': {
        post: {
          tags: ['Ingest'],
          summary: 'Batch track events',
          description:
            'Write-gated. Up to 1000 events in one transaction. Duplicates no-op on activity (workspaceId, externalId) via idempotencyKey or externalId.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(IngestBatchRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Batch accepted',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(IngestBatchResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/ingest/event': {
        post: {
          tags: ['Ingest'],
          summary: 'Track event',
          description: 'Send activity event',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(IngestEventRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Event tracked',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { success: { type: 'boolean' } } }
                }
              }
            },
            400: {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/session': {
        get: {
          tags: ['Session'],
          summary: 'Session status',
          description:
            'Whether the signed browser cookie is valid, and which live workspaces it has unlocked. Demo stays public-read without a session. Never returns the API key.',
          security: [],
          responses: {
            200: {
              description: 'Session status',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(SessionStatusResponseSchema)
                }
              }
            }
          }
        },
        post: {
          tags: ['Session'],
          summary: 'Start a browser session',
          description:
            'Verify the API key once and set a signed httpOnly SameSite cookie. A second POST with another workspace key merges that unlock onto the same cookie. Writes still require the key.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(SessionCreateRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Cookie set',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(SessionStatusResponseSchema)
                }
              }
            },
            401: {
              description: 'Missing or invalid API key',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            503: {
              description: 'No signing secret (set ANYKPI_SECRET)',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        },
        delete: {
          tags: ['Session'],
          summary: 'End the browser session',
          description: 'Clear the signed cookie. Demo stays public-read.',
          security: [],
          responses: {
            200: {
              description: 'Cookie cleared',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(SessionStatusResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/config': {
        get: {
          tags: ['Config'],
          summary: 'Get company profile',
          description:
            'Name, founded date, home city (IANA timezone + label), and the Day of YourCo shown-city set for a workspace. Demo stays public-read. `dayLabel` is the "Day of <name>" copy.',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' },
              description: 'Workspace ID'
            }
          ],
          responses: {
            200: {
              description: 'Company profile',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(CompanyProfileSchema)
                }
              }
            }
          }
        },
        patch: {
          tags: ['Config'],
          summary: 'Update company profile',
          description:
            'Company name, founded date, and home city are write-gated. Shown-city and celebration-claim fields are display prefs a browser session may save. A founded date in the future is refused. Keys live in the existing config table per workspace.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(CompanyProfileUpdateSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Updated company profile',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(CompanyProfileSchema)
                }
              }
            },
            400: {
              description: 'Invalid profile (including a future founded date)',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/workspaces': {
        get: {
          tags: ['Workspaces'],
          summary: 'List workspaces',
          description:
            'Catalog for the dashboard switcher (id, name, archivedAt). Live data still requires a key or a session unlock.',
          security: [],
          responses: {
            200: {
              description: 'Workspace catalog',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(WorkspaceListResponseSchema)
                }
              }
            }
          }
        },
        post: {
          tags: ['Workspaces'],
          summary: 'Create a workspace',
          description: 'Admin / env key only. Id must be a lowercase slug.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(WorkspaceCreateRequestSchema)
              }
            }
          },
          responses: {
            201: {
              description: 'Workspace created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      workspace: zodToJsonSchema(WorkspaceRecordSchema)
                    }
                  }
                }
              }
            },
            400: {
              description: 'Invalid or duplicate id',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        },
        patch: {
          tags: ['Workspaces'],
          summary: 'Archive a workspace',
          description: 'Admin / env key only. Demo cannot be archived.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(WorkspaceArchiveRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Workspace archived',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      workspace: zodToJsonSchema(WorkspaceRecordSchema)
                    }
                  }
                }
              }
            },
            400: {
              description: 'Demo cannot be archived',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            404: {
              description: 'Workspace not found',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        },
        delete: {
          tags: ['Workspaces'],
          summary: 'Delete a workspace',
          description:
            'Typed-name-confirmed delete. Cascades users, activity, read models, credentials, sync state, annotations, keys, and config for that workspace only. Write or admin key, or a signed browser session. There is no MCP tool for this.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(WorkspaceDeleteRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Workspace deleted',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(WorkspaceDeleteResponseSchema)
                }
              }
            },
            400: {
              description: 'Name confirmation did not match',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            401: {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            403: {
              description: 'Read-only key cannot delete a workspace',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            404: {
              description: 'Workspace not found',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        }
      },
      '/api/v1/keys': {
        post: {
          tags: ['Keys'],
          summary: 'Create API key',
          description: 'Generate new API key for agent access (key returned only once)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(APIKeyCreateRequestSchema)
              }
            }
          },
          responses: {
            201: {
              description: 'API key created',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(APIKeyResponseSchema)
                }
              }
            },
            400: {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            403: {
              description: 'Read-only key cannot mint keys',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            }
          }
        },
        get: {
          tags: ['Keys'],
          summary: 'List API keys',
          description: 'Get all API keys (actual keys not included). Includes scope, lastUsedAt, and legacy.',
          responses: {
            200: {
              description: 'List of API keys',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      keys: {
                        type: 'array',
                        items: zodToJsonSchema(APIKeyResponseSchema)
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/v1/keys/downgrade': {
        post: {
          tags: ['Keys'],
          summary: 'Downgrade legacy keys',
          description:
            'Convert migrated (legacy) write keys to read. Omit id to downgrade every visible legacy key. CLI: anykpi keys downgrade.',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: zodToJsonSchema(APIKeyDowngradeRequestSchema)
              }
            }
          },
          responses: {
            200: {
              description: 'Legacy keys downgraded to read',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(APIKeyDowngradeResponseSchema)
                }
              }
            },
            403: {
              description: 'Read-only key cannot downgrade',
              content: {
                'application/json': {
                  schema: zodToJsonSchema(ErrorResponseSchema)
                }
              }
            },
            404: {
              description: 'Key id not found or not legacy'
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'API key in format: Bearer ak_...'
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  };
  
  return NextResponse.json(spec);
}
