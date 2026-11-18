import { database, identity, files, failure, ApiError } from '@/lib/server';

type PhotoRow = {
  object_key: string;
  mime: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await identity();
    const { id } = await params;
    const photo = await database()
      .prepare('SELECT object_key,mime FROM photos WHERE owner=? AND id=?')
      .bind(owner, id)
      .first<PhotoRow>();
    if (!photo) throw new ApiError(404, '照片不存在');
    const file = await files().get(photo.object_key);
    if (!file) throw new ApiError(404, '照片不存在');
    return new Response(file.body, {
      headers: {
        'Content-Type': photo.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
