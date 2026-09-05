import type { z } from 'zod';

/**
 * Minimal Zod → JSON Schema conversion for tool definitions.
 *
 * Only the constructs the tool schemas actually use are handled. A general
 * converter is a dependency and a maintenance surface; this is forty lines that
 * fail loudly on anything unsupported, so an unhandled construct surfaces as a
 * thrown error at startup rather than a silently malformed tool definition the
 * model then misuses.
 */

export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [key: string]: unknown };
  const description = (schema as { description?: string }).description;

  const withDescription = (base: JsonSchema): JsonSchema =>
    description ? { ...base, description } : base;

  switch (def['typeName']) {
    case 'ZodObject': {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const field = value as z.ZodTypeAny;
        properties[key] = convert(field);
        if (!isOptional(field)) required.push(key);
      }

      return withDescription({
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      });
    }

    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return convert(def['innerType'] as z.ZodTypeAny);

    case 'ZodArray':
      return withDescription({ type: 'array', items: convert(def['type'] as z.ZodTypeAny) });

    case 'ZodEnum':
      return withDescription({ type: 'string', enum: def['values'] as readonly string[] });

    case 'ZodString':
      return withDescription({ type: 'string' });

    case 'ZodNumber': {
      const checks = (def['checks'] ?? []) as Array<{ kind: string; value: number }>;
      const min = checks.find((check) => check.kind === 'min')?.value;
      const max = checks.find((check) => check.kind === 'max')?.value;
      return withDescription({
        type: 'number',
        ...(min !== undefined ? { minimum: min } : {}),
        ...(max !== undefined ? { maximum: max } : {}),
      });
    }

    case 'ZodBoolean':
      return withDescription({ type: 'boolean' });

    default:
      // Failing loudly beats emitting a schema the model will silently misuse.
      throw new Error(
        `zodToJsonSchema: unsupported Zod type "${String(def['typeName'])}". ` +
          'Add a case for it rather than letting a malformed tool definition ship.',
      );
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string })['typeName'];
  return typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable';
}
