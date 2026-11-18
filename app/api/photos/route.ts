import {
  database,
  identity,
  files,
  failure,
  safeWrite,
  ApiError,
} from '@/lib/server';
export async function POST(request: Request) {
  try {
    safeWrite(request);
    const owner = await identity();
    if (Number(request.headers.get('content-length')) > 6500000)
      throw new ApiError(413, '照片不能超过6MB');
    const data = await request.formData();
    const file = data.get('photo');
    if (!(file instanceof File) || file.size > 6000000 || file.size === 0)
      throw new ApiError(400, '请选择6MB以内的照片');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let mime = '';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = 'image/jpeg';
    if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    )
      mime = 'image/png';
    if (
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    )
      mime = 'image/webp';
    if (!mime) throw new ApiError(400, '请选择JPEG、PNG或WebP照片');
    const id = crypto.randomUUID(),
      key = owner + '/' + id;
    await files().put(key, buffer, { httpMetadata: { contentType: mime } });
    try {
      await database()
        .prepare(
          'INSERT INTO photos(owner,id,object_key,mime,created) VALUES(?,?,?,?,?)',
        )
        .bind(owner, id, key, mime, Date.now())
        .run();
    } catch (e) {
      await files().delete(key);
      throw e;
    }
    return Response.json({ id });
  } catch (e) {
    return failure(e);
  }
}
