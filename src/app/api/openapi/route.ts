import { NextResponse } from 'next/server';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  OverviewResponseSchema,
  UsersListResponseSchema,
  CohortsResponseSchema,
  WBRResponseSchema,
  CalendarResponseSchema,
  SyncResponseSchema,
  QueryUsersRequestSchema,
  APIKeyCreateRequestSchema,
  APIKeyResponseSchema,
  ErrorResponseSchema,
  IngestIdentifyRequestSchema,
  IngestEventRequestSchema,
} from '@/core/contracts';

/**
 * GET /api/openapi
 * 
 * OpenAPI 3.0 spec generated from Zod contracts
 */
export async function GET() {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'ANYKPI API',
      version: '1.0.0',
      description: 'Unified insights API for modern day builders. Same resources humans see in the dashboard.',
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
        url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
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
      { name: 'Ingest', description: 'Direct event collection' },
      { name: 'Keys', description: 'API key management' }
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
          description: 'Filter users by cluster, platform, signup dates',
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
          description: 'Returns retention curves with smile detection (PMF signal)',
          parameters: [
            {
              name: 'workspace',
              in: 'query',
              schema: { type: 'string', default: 'demo' }
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
            }
          }
        },
        get: {
          tags: ['Keys'],
          summary: 'List API keys',
          description: 'Get all API keys (actual keys not included)',
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
