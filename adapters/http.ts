// Rutas de subida comunes: POST /uploads y POST /uploads/:id/confirm. `authorize` decide quién puede subir.
import { z } from 'zod';
import { confirmUpload, createUpload, MediaError } from '../index.ts';

export type Authorize = (req: Request) => Promise<{ userId: string } | null>;

const Body = z.object({ filename: z.string().min(1).max(200), mime: z.string().max(100), size: z.number().int().positive(), folder: z.string().optional(), alt: z.string().optional() });

const fail = (e: unknown) => {
  if (e instanceof MediaError) return Response.json({ error: e.code, message: e.message }, { status: e.code === 'not_found' ? 404 : 400 });
  if (e instanceof z.ZodError) return Response.json({ error: 'invalid_input' }, { status: 400 });
  throw e;
};

export async function handleCreateUpload(req: Request, authorize: Authorize): Promise<Response> {
  const who = await authorize(req);
  if (!who) return Response.json({ error: 'forbidden' }, { status: 403 });
  try {
    const body = Body.parse(await req.json());
    const { media, upload } = await createUpload({ ...body, uploadedBy: who.userId });
    return Response.json({ id: media.id, upload }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function handleConfirmUpload(req: Request, id: string, authorize: Authorize): Promise<Response> {
  if (!(await authorize(req))) return Response.json({ error: 'forbidden' }, { status: 403 });
  try {
    return Response.json(await confirmUpload(id));
  } catch (e) {
    return fail(e);
  }
}
