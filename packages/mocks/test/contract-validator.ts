/**
 * Validates mock responses against packages/contracts/bundled/openapi.v1.yaml (OpenAPI 3.1 =
 * JSON Schema 2020-12). Used by the conformance test so mocks can never drift from the contract.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const specPath = require.resolve('@homebell/contracts/openapi.v1.yaml');

type Spec = {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
      }
    >
  >;
  components: { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> };
};
const spec = yaml.load(readFileSync(specPath, 'utf8')) as Spec;

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
(addFormats as unknown as (a: unknown) => void)(ajv);
for (const f of ['binary', 'int64', 'double', 'int32']) ajv.addFormat(f, true);
ajv.addSchema(spec as object, 'openapi');

const routes = Object.entries(spec.paths).map(([path, item]) => ({
  path,
  regex: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
  literalSegments: path.split('/').filter((s) => s && !s.startsWith('{')).length,
  item,
}));

export interface ValidationFailure {
  operation: string;
  status: number;
  errors: string[];
}

export const coverage = new Set<string>();

export async function validateResponse(
  request: Request,
  response: Response,
): Promise<ValidationFailure | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
  const method = request.method.toLowerCase();
  const route = routes
    .filter((r) => r.regex.test(path) && r.item[method])
    .sort((a, b) => b.literalSegments - a.literalSegments)[0];
  if (!route)
    return {
      operation: `${method.toUpperCase()} ${path}`,
      status: response.status,
      errors: ['No matching operation in the contract'],
    };
  const op = route.item[method]!;
  coverage.add(op.operationId);
  let resp = op.responses[String(response.status)];
  if (resp && '$ref' in resp)
    resp =
      spec.components.responses[
        String((resp as { $ref: string }).$ref)
          .split('/')
          .pop()!
      ];
  if (!resp)
    return {
      operation: op.operationId,
      status: response.status,
      errors: [`Status ${response.status} is not documented`],
    };
  const contentType = response.headers.get('Content-Type')?.split(';')[0] ?? '';
  if (!resp.content)
    return response.status === 204 || !(await response.clone().text())
      ? null
      : {
          operation: op.operationId,
          status: response.status,
          errors: ['Body returned but contract declares none'],
        };
  const media =
    resp.content[contentType] ??
    (contentType === 'application/json' ? resp.content['application/problem+json'] : undefined);
  if (!media)
    return {
      operation: op.operationId,
      status: response.status,
      errors: [
        `Content-Type ${contentType} not documented (${Object.keys(resp.content).join(', ')})`,
      ],
    };
  if (contentType === 'text/csv') return null;
  const body = await response.clone().json();
  const schemaPointer = `openapi#/paths/${route.path.replace(/~/g, '~0').replace(/\//g, '~1')}/${method}/responses/${response.status}`;
  const inlineRef = (op.responses[String(response.status)] as { $ref?: string }).$ref;
  const validate = ajv.getSchema(
    inlineRef
      ? `openapi${inlineRef}/content/${encodePointer(contentType in resp.content ? contentType : 'application/problem+json')}/schema`
      : `${schemaPointer}/content/${encodePointer(contentType in resp.content ? contentType : 'application/problem+json')}/schema`,
  );
  if (!validate)
    return {
      operation: op.operationId,
      status: response.status,
      errors: ['Could not compile schema'],
    };
  if (validate(body)) return null;
  return {
    operation: op.operationId,
    status: response.status,
    errors: (validate.errors ?? [])
      .slice(0, 8)
      .map(
        (e: { instancePath: string; message?: string; params: unknown }) =>
          `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`,
      ),
  };
}

const encodePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

export const allOperationIds = (): string[] =>
  Object.values(spec.paths).flatMap((item) =>
    Object.values(item)
      .map((o) => (o as { operationId?: string }).operationId)
      .filter((x): x is string => !!x),
  );
