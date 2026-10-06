// Tablas de @core/media. Las recoge drizzle-kit vía src/lib/db/drizzle.config.ts.
import { index, integer, pgTable, real, text } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from '../db/index.ts';

export const media = pgTable(
  'media',
  {
    id: primaryId('med'),
    /** Clave en @core/storage (`public/media/2026/10/<id>.jpg`). */
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Texto alternativo; obligatorio para mostrar imágenes que no sean decorativas. */
    alt: text('alt').notNull().default(''),
    /** Punto focal 0–1 para recortes (`object-position`). */
    focalX: real('focal_x').notNull().default(0.5),
    focalY: real('focal_y').notNull().default(0.5),
    folder: text('folder').notNull().default(''),
    status: text('status', { enum: ['pending', 'ready', 'rejected'] })
      .notNull()
      .default('pending'),
    uploadedBy: text('uploaded_by'),
    ...timestamps,
  },
  (t) => [index('media_folder_idx').on(t.folder, t.status)],
);

export type Media = typeof media.$inferSelect;
