// Adaptador Next.js:
//   app/api/media/uploads/route.ts              → export const POST = createUploadRoute(authorize);
//   app/api/media/uploads/[id]/confirm/route.ts → export const POST = confirmUploadRoute(authorize);
import { type Authorize, handleConfirmUpload, handleCreateUpload } from './http.ts';

export const createUploadRoute = (authorize: Authorize) => (req: Request) => handleCreateUpload(req, authorize);

export const confirmUploadRoute = (authorize: Authorize) => async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handleConfirmUpload(req, (await ctx.params).id, authorize);
