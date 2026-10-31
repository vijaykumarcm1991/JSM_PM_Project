import { z } from 'zod';

export const FieldTransformSchema = z.enum([
  'none',
  'trim',
  'uppercase',
  'lowercase',
  'split-list',
  'date-normalize',
]);

export type FieldTransform = z.infer<typeof FieldTransformSchema>;

export const FieldMappingSchema = z.object({
  fieldId: z.string(),
  columnName: z.string().nullable().optional(),
  constantValue: z.string().nullable().optional(),
  transform: FieldTransformSchema.default('none'),
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const AttachmentMappingSchema = z.object({
  columnName: z.string().nullable().optional(),
});

export type AttachmentMapping = z.infer<typeof AttachmentMappingSchema>;

export const MappingConfigSchema = z.object({
  projectKey: z.string(),
  issueTypeId: z.string(),
  fields: z.array(FieldMappingSchema),
  attachment: AttachmentMappingSchema.optional().default({ columnName: null }),
});

export type MappingConfig = z.infer<typeof MappingConfigSchema>;
