import { NextRequest, NextResponse } from 'next/server';
import { publicBaseUrl } from '@/core/view-state';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  OverviewResponseSchema,
  UsersListResponseSchema,
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
  APIKeyCreateRequestSchema,
  APIKeyResponseSchema,
  APIKeyDowngradeRequestSchema,
  APIKeyDowngradeResponseSchema,
  SessionCreateRequestSchema,
  SessionStatusResponseSchema,
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
      { name: 'Ingest', description: 'Direct event collection' },
      { name: 'Keys', description: 'API key management' },
      { name: 'Session', description: 'Browser session cookie for live dashboard reads' }
    ],
    paths: {
      '/api/v1/overview': {
        get: {
          tags: ['Overview'],
          summary: 'Get company overview',
          description: 'Returns key metrics: users, activity, retention, PMF signal, exceptions',
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
          description: 'Status of all connected sources with last sync time',
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
            'Whether the signed browser cookie is valid. Demo stays public-read without a session. Never returns the API key.',
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
            'Verify the API key once and set a signed httpOnly SameSite cookie. Live views then load without putting the key in a URL. Writes still require the key.',
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
