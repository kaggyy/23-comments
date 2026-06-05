import { z } from "zod";

export const reportStatusSchema = z.enum([
  "open",
  "in_progress",
  "resolved",
  "archived"
]);

export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const rectAnnotationSchema = z.object({
  id: z.string(),
  type: z.literal("rect"),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  stroke: z.string().default("#dd5b00"),
  strokeWidth: z.number().positive().default(3)
});

export const annotationSchema = rectAnnotationSchema;
export const annotationsSchema = z.array(annotationSchema);

export type RectAnnotation = z.infer<typeof rectAnnotationSchema>;
export type Annotation = RectAnnotation;

export const reportCreateSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional().default(""),
  pageUrl: z.string().url(),
  pageTitle: z.string().max(300).optional().default(""),
  screenshotDataUrl: z.string().startsWith("data:image/png;base64,"),
  annotatedScreenshotDataUrl: z.string().startsWith("data:image/png;base64,"),
  annotations: annotationsSchema,
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    devicePixelRatio: z.number().positive()
  }),
  userAgent: z.string().max(1000)
});

export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

export const invitationSchema = z.object({
  email: z.string().email(),
  organizationId: z.string().uuid(),
  token: z.string().min(16)
});

export const statuses: ReportStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "archived"
];

export const statusLabels: Record<ReportStatus, string> = {
  open: "未対応",
  in_progress: "対応中",
  resolved: "解決済み",
  archived: "アーカイブ"
};
